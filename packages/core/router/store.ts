import { err, internalError, ok, type Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import {
  type AgentCallRow,
  callCanMove,
  callFromOfRow,
  callFromRef,
  type CallFailReason,
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

const COLUMNS = `call, from_session, from_app, "to", receiver_session, reply, state, fail_reason, dedup,
   unattended, ask, created_at, state_at, result`;

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
    // 보낸 쪽은 session이거나 앱이다. 앱은 `<앱 id>|<slug>`로 남아 있다(message의 from_ref와 같은 꼴).
    from:
      row["from_session"] === null || row["from_session"] === undefined
        ? callFromOfRow("app", String(row["from_app"]))
        : { kind: "agent", session: row["from_session"] as Id<"ses"> },
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

// 하나라도 읽지 못하는 행이 있으면 건너뛴다. 닫는 일이 나머지를 막지 않게 한다.
export function createCallStore(): CallStore {
  return {
    insert(tx, record) {
      if (record.from.kind !== "agent" && record.from.kind !== "app") {
        return err({
          code: "invalid_input",
          message: "only an agent- or app-sent call has a row",
        });
      }
      tx.sql.run(
        `insert into agent_calls (call, from_session, from_app, "to", receiver_session,
           reply, state, fail_reason, dedup, consumed, unattended, ask,
           created_at, state_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?)`,
        [
          record.call,
          record.from.kind === "agent" ? record.from.session : null,
          record.from.kind === "app" ? callFromRef(record.from) : null,
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
        ],
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
      tx.sql.run(
        `update agent_calls set state = ?, fail_reason = ?, state_at = ?, result = ?
         where call = ?`,
        [to, reason, at, result ?? null, call],
      );
      return ok({
        ...current.value,
        state: to,
        fail_reason: reason,
        state_changed_at: at,
        result: result ?? null,
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
    // ask call은 부모가 가져갔어도 닫는다: 자식의 request·질문이 메모리라 사라져 부모의 늦은 답이 갈 곳이 없다.
    lost(tx) {
      return many(
        tx.sql.all(
          `select ${COLUMNS} from agent_calls
         where state = 'accepted' and (consumed = 0 or ask is not null)
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

// 받는 session의 turn이 call 입력을 가져갔다는 신호를 받는 쪽이다. run-loop가 turn을 시작하는 tx에서 부른다.
export const callSignals = {
  consumed: (tx: Tx, call: Id<"cal">) =>
    createCallStore().markConsumed(tx, call),
};
