import { err, internalError, ok, type Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import {
  type AgentCallRow,
  callCanMove,
  callFromOfRow,
  callFromRef,
  type CallFailReason,
  type CallFrom,
  type CallState,
  callTargetSchema,
} from "../../protocol/lophn-agent/calls.ts";
import type { PortKey } from "../../protocol/base/mod.ts";
import type { Sql, Tx } from "../../protocol/server/mod.ts";
import type { CallStore } from "./ports.ts";

// Tx와 ReadSnapshot이 둘 다 맞는 읽기 모양이다.
export type SqlView = {
  readonly sql: Pick<Sql, "get" | "all">;
  port<T>(key: PortKey<T>): T;
};

const COLUMNS = `call, from_session, from_app, from_machine, "to", receiver_session, reply, state, fail_reason, dedup,
   unattended, ask, created_at, state_at, result, delivery, remote_session`;

function senderOf(row: Record<string, unknown>): CallFrom {
  if (row["from_session"] !== null && row["from_session"] !== undefined) {
    return { kind: "agent", session: row["from_session"] as Id<"ses"> };
  }
  if (row["from_app"] !== null && row["from_app"] !== undefined) {
    return callFromOfRow("app", String(row["from_app"]));
  }
  if (row["from_machine"] !== null && row["from_machine"] !== undefined) {
    return callFromOfRow("remote", String(row["from_machine"]));
  }
  // workflow가 다른 컴퓨터로 넘긴 step(보낸 쪽 칸이 셋 다 비었다).
  return { kind: "program" };
}

function recordOf(row: Record<string, unknown>): Result<AgentCallRow> {
  let to: unknown;
  try {
    to = JSON.parse(String(row["to"]));
  } catch {
    return err(internalError());
  }
  const parsed = callTargetSchema.safeParse(to);
  if (!parsed.success) return err(internalError());
  return ok({
    call: row["call"] as Id<"cal">,
    // 보낸 쪽은 session, 앱, 다른 컴퓨터다. 앱과 다른 컴퓨터는 message의 from_ref와 같은 꼴로 남아 있다.
    from: senderOf(row),
    to: parsed.data,
    receiver_session: (row["receiver_session"] ?? null) as Id<"ses"> | null,
    reply: row["reply"] as AgentCallRow["reply"],
    state: row["state"] as CallState,
    fail_reason: (row["fail_reason"] ?? null) as CallFailReason | null,
    dedup: (row["dedup"] ?? null) as string | null,
    unattended: Number(row["unattended"]) === 1,
    ask: (row["ask"] ?? null) as AgentCallRow["ask"],
    created_at: String(row["created_at"]),
    state_changed_at: String(row["state_at"]),
    result: (row["result"] ?? null) as string | null,
    // 끝난 call은 배달 중이 아니다(이 판 앞에 끝난 행에는 값이 남아 있을 수 있다).
    delivery:
      row["state"] === "accepted"
        ? ((row["delivery"] ?? null) as AgentCallRow["delivery"])
        : null,
    remote_session: (row["remote_session"] ?? null) as Id<"ses"> | null,
  });
}

export function readCall(
  view: Pick<SqlView, "sql">,
  call: Id<"cal">,
): Result<AgentCallRow | null> {
  const row = view.sql.get(
    `select ${COLUMNS} from agent_calls where call = ?`,
    [call],
  );
  return row === undefined ? ok(null) : recordOf(row);
}

function many(
  rows: readonly Record<string, unknown>[],
): readonly AgentCallRow[] {
  const records: AgentCallRow[] = [];
  for (const row of rows) {
    const record = recordOf(row);
    if (record.ok) records.push(record.value);
  }
  return records;
}

// 다른 컴퓨터에 연 팀원(`team spawn --on`)의 첫 call: 연 기계에서는 그 자리로 보낸 spawn call, 팀원이 도는 기계에서는 그 session을 연
// call이다. 두 기계 사이의 팀원 mail(끝, 끝남 알림)이 이 call id를 쓰고, 상대 컴퓨터의 이름도 여기 얼어 있다.
export function memberCallOf(
  view: Pick<SqlView, "sql">,
  session: Id<"ses">,
): AgentCallRow | null {
  const row = view.sql.get(
    `select ${COLUMNS} from agent_calls
     where (remote_session = ? and json_extract("to", '$.kind') = 'remote')
        or (receiver_session = ? and from_machine is not null)
     order by created_at, call limit 1`,
    [session, session],
  );
  if (row === undefined) return null;
  const record = recordOf(row);
  return record.ok ? record.value : null;
}

// 다른 컴퓨터에 연 팀원의 자리가 어디까지 갔는지: 그 컴퓨터 이름과, spawn call의 배달 상태(닿지 않음·모름은 pending, 그 컴퓨터의 대기
// 목록이면 held, 받았거나 spawn call이 끝났으면 running). 자리가 끝났는지(ended)는 session 행이 안다.
export function memberDeliveryOf(
  view: Pick<SqlView, "sql">,
  session: Id<"ses">,
): { computer: string; state: "pending" | "held" | "running" } | null {
  const spawn = memberCallOf(view, session);
  if (spawn === null || spawn.to.kind !== "remote") return null;
  return {
    computer: spawn.to.computer,
    state:
      spawn.delivery === "pending" || spawn.delivery === "unknown"
        ? "pending"
        : spawn.delivery === "held"
          ? "held"
          : "running",
  };
}

// 하나라도 읽지 못하는 행이 있으면 건너뛴다. 닫는 일이 나머지를 막지 않게 한다.
export function createCallStore(): CallStore {
  return {
    insert(tx, record) {
      const kind = record.from.kind;
      // program이 보낸 행은 workflow가 다른 컴퓨터로 넘긴 step뿐이다.
      const remoteStep = kind === "program" && record.to.kind === "remote";
      if (
        kind !== "agent" &&
        kind !== "app" &&
        kind !== "remote" &&
        !remoteStep
      ) {
        return err({
          code: "invalid_input",
          message: "only an agent-, app- or remote-sent call has a row",
        });
      }
      tx.sql.run(
        `insert into agent_calls (call, from_session, from_app, from_machine, "to", receiver_session,
           reply, state, fail_reason, dedup, consumed, unattended, ask,
           created_at, state_at, delivery, remote_session)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)`,
        [
          record.call,
          record.from.kind === "agent" ? record.from.session : null,
          kind === "app" ? callFromRef(record.from) : null,
          kind === "remote" ? callFromRef(record.from) : null,
          JSON.stringify(record.to),
          record.receiver_session,
          record.reply,
          record.state,
          record.fail_reason,
          record.dedup,
          record.unattended ? 1 : 0,
          record.ask,
          record.created_at,
          record.state_changed_at,
          record.delivery,
          record.remote_session,
        ],
      );
      return ok(undefined);
    },
    setDelivery(tx, call, delivery, session) {
      tx.sql.run(
        `update agent_calls set delivery = ?, remote_session = coalesce(?, remote_session)
         where call = ? and state = 'accepted' and delivery is not null`,
        [delivery, session ?? null, call],
      );
      return ok(undefined);
    },
    byDedup(tx, sender, dedup) {
      // 앱은 slug가 보낼 때의 것으로 얼어 있어 앱 id(`<id>|`)로 앞을 맞춘다. 앱 id에는 `like`의 와일드카드가 없는 substr를 쓴다.
      const row =
        sender.kind === "agent"
          ? tx.sql.get(
              `select ${COLUMNS} from agent_calls
               where from_session = ? and dedup = ?`,
              [sender.session, dedup],
            )
          : sender.kind === "app"
            ? tx.sql.get(
                `select ${COLUMNS} from agent_calls
                 where substr(from_app, 1, ?) = ? and dedup = ?`,
                [sender.app.length + 1, `${sender.app}|`, dedup],
              )
            : undefined;
      if (row === undefined) return null;
      const record = recordOf(row);
      return record.ok ? record.value : null;
    },
    read(tx, call) {
      const read = readCall(tx, call);
      return read.ok ? read.value : null;
    },
    memberCall: (tx, session) => memberCallOf(tx, session),
    move(tx, call, to, reason, result) {
      const current = readCall(tx, call);
      if (!current.ok) return current;
      if (current.value === null) {
        return err({ code: "not_found", message: "call not found" });
      }
      if (!callCanMove(current.value.state, to)) {
        return err({ code: "conflict", message: "the call already ended" });
      }
      const at = tx.now();
      // 끝난 행은 배달 중인 상태를 남기지 않는다(다른 컴퓨터로 보낸 행의 delivery).
      tx.sql.run(
        `update agent_calls set state = ?, fail_reason = ?, state_at = ?, result = ?, delivery = null
         where call = ?`,
        [to, reason, at, result ?? null, call],
      );
      return ok({
        ...current.value,
        state: to,
        fail_reason: reason,
        state_changed_at: at,
        result: result ?? null,
        delivery: null,
      });
    },
    // 답 없는 call은 받는 turn이 입력을 가져갈 때 끝난다. 배달할 때 끝내면 켤 때 queue와 함께 잃은 것을 가리지 못하고,
    // 가져간 뒤에도 열어 두면 받은 session을 닫을 때 끝난 일에 receiver_ended가 간다.
    markConsumed(tx, call) {
      tx.sql.run(
        `update agent_calls set consumed = 1,
           state = case when reply = 'none' then 'done' else state end,
           state_at = case when reply = 'none' then ? else state_at end
         where call = ? and state = 'accepted'`,
        [tx.now(), call],
      );
      return ok(undefined);
    },
    // ask call은 부모가 가져갔어도 닫는다: 자식의 request·질문이 메모리라 사라져 부모의 늦은 답이 갈 곳이 없다. 다른 컴퓨터의 부모에게
    // 보낸 ask call(팀원의 ask)도 같다. 그 밖의 다른 컴퓨터로 보낸 행(delivery가 있다)은 이 기계의 queue에 있지 않아 잃지 않는다. 답은
    // outbox와 그 기계가 맡는다. 다른 컴퓨터의 팀원이 이 기계의 부모에게 보낸 ask는 가져갔으면 그대로 둔다: 짝은 그 기계의 메모리에 살아 있다.
    lost(tx) {
      return many(
        tx.sql.all(
          `select ${COLUMNS} from agent_calls
         where state = 'accepted' and (consumed = 0 or (ask is not null and from_machine is null))
           and (delivery is null or ask is not null)
         order by created_at, call`,
          [],
        ),
      );
    },
    openReceivedBy(tx, session) {
      return many(
        tx.sql.all(
          `select ${COLUMNS} from agent_calls
         where state = 'accepted' and receiver_session = ?
         order by created_at, call`,
          [session],
        ),
      );
    },
    openAsksSentBy(tx, session) {
      return many(
        tx.sql.all(
          `select ${COLUMNS} from agent_calls
         where state = 'accepted' and from_session = ? and ask is not null
         order by created_at, call`,
          [session],
        ),
      );
    },
    openSentFromRemote(tx, machine, session) {
      return many(
        tx.sql.all(
          `select ${COLUMNS} from agent_calls
         where state = 'accepted' and from_machine is not null
           and json_extract(from_machine, '$.machine') = ? and json_extract(from_machine, '$.session') = ?
         order by created_at, call`,
          [machine, session],
        ),
      );
    },
  };
}

// 앱이 보낸 call 행은 답 글(`result`)을 담고 있어 받은 session을 지우면 같이 지운다(session 기록의 본문과 같은 수명). agent가 보낸 행은 글이 없다.
export function deleteAppCallsReceivedBy(
  tx: Tx,
  session: string,
): Result<void> {
  tx.sql.run(
    "delete from agent_calls where from_app is not null and receiver_session = ?",
    [session],
  );
  return ok(undefined);
}

// 앱을 지울 때 그 앱이 보낸 call 행을 지운다(앱 id로 맞춘다. from_app은 `<앱 id>|<slug>`다).
export function deleteCallsSentByApp(tx: Tx, app: string): Result<void> {
  tx.sql.run("delete from agent_calls where substr(from_app, 1, ?) = ?", [
    app.length + 1,
    `${app}|`,
  ]);
  return ok(undefined);
}

// 그 session이 받았거나 보낸 call들(끝난 것도, 새것부터). 앱이 보이는 session의 call을 읽는다.
export function callsOfSession(
  view: Pick<SqlView, "sql">,
  session: Id<"ses">,
  limit: number,
): readonly AgentCallRow[] {
  return many(
    view.sql.all(
      `select ${COLUMNS} from agent_calls
       where receiver_session = ? or from_session = ?
       order by created_at desc, call desc limit ?`,
      [session, session, limit],
    ),
  );
}

// 그 session이 보낸, 아직 답을 받지 못한 result·conversation call. 팀원마다 묶는 것은 읽는 쪽이 한다.
export function openCallsSentBy(
  view: SqlView,
  sender: Id<"ses">,
): readonly AgentCallRow[] {
  return many(
    view.sql.all(
      `select ${COLUMNS} from agent_calls
       where from_session = ? and state = 'accepted' and reply <> 'none'
       order by created_at, call`,
      [sender],
    ),
  );
}
