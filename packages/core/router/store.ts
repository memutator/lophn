import { err, internalError, ok, type Result } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import {
  type AgentCallRow,
  callCanMove,
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

const COLUMNS = `call, from_session, "to", receiver_session, reply, state, fail_reason, dedup,
   unattended, created_at, state_at`;

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
    from: { kind: "agent", session: row["from_session"] as Id<"ses"> },
    to: parsed.data,
    receiver_session: (row["receiver_session"] ?? null) as Id<"ses"> | null,
    reply: row["reply"] as AgentCallRow["reply"],
    state: row["state"] as CallState,
    fail_reason: (row["fail_reason"] ?? null) as CallFailReason | null,
    dedup: (row["dedup"] ?? null) as string | null,
    unattended: Number(row["unattended"]) === 1,
    created_at: String(row["created_at"]),
    state_changed_at: String(row["state_at"]),
  });
}

export function readCall(
  view: SqlView,
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
      if (record.from.kind !== "agent") {
        return err({
          code: "invalid_input",
          message: "only an agent-sent call has a row",
        });
      }
      tx.sql.run(
        `insert into agent_calls (call, from_session, "to", receiver_session,
           reply, state, fail_reason, dedup, consumed, unattended,
           created_at, state_at)
         values (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
        [
          record.call,
          record.from.session,
          JSON.stringify(record.to),
          record.receiver_session,
          record.reply,
          record.state,
          record.fail_reason,
          record.dedup,
          record.unattended ? 1 : 0,
          record.created_at,
          record.state_changed_at,
        ],
      );
      return ok(undefined);
    },
    byDedup(tx, sender, dedup) {
      const row = tx.sql.get(
        `select ${COLUMNS} from agent_calls
         where from_session = ? and dedup = ?`,
        [sender, dedup],
      );
      if (row === undefined) return null;
      const record = recordOf(row);
      return record.ok ? record.value : null;
    },
    read(tx, call) {
      const read = readCall(tx, call);
      return read.ok ? read.value : null;
    },
    move(tx, call, to, reason) {
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
        `update agent_calls set state = ?, fail_reason = ?, state_at = ?
         where call = ?`,
        [to, reason, at, call],
      );
      return ok({
        ...current.value,
        state: to,
        fail_reason: reason,
        state_changed_at: at,
      });
    },
    markConsumed(tx, call) {
      tx.sql.run(
        "update agent_calls set consumed = 1 where call = ? and state = 'accepted'",
        [call],
      );
      return ok(undefined);
    },
    lost(tx) {
      return many(
        tx.sql.all(
          `select ${COLUMNS} from agent_calls
         where state = 'accepted' and consumed = 0 order by created_at, call`,
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

// 받는 session의 turn이 call 입력을 가져갔다는 신호를 받는 쪽이다. run-loop가 turn을 시작하는 tx에서 부른다.
export const callSignals = {
  consumed: (tx: Tx, call: Id<"cal">) =>
    createCallStore().markConsumed(tx, call),
};
