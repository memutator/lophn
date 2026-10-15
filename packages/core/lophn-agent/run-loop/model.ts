import type { TurnRecord } from "../../../protocol/lophn-agent/mod.ts";
import type { SqlParams, SqlRow } from "../../../protocol/server/mod.ts";

// row를 화면 값으로 바꾸는 도움. 순수 함수와 읽기 조회만 있다.

export const TURN_COLUMNS = `id, session, input_message, state, basis,
  started_at, limits, elapsed_active_ms, elapsed_stall_ms,
  elapsed_checkpoint_at, finished_at, outcome_kind, outcome_reason, result,
  stop_request_key, result_facts, state_seq`;

export type TurnRow = {
  id: string;
  session: string;
  input_message: string;
  state: "running" | "finished";
  basis: string;
  started_at: string;
  limits: string;
  elapsed_active_ms: number;
  elapsed_stall_ms: number;
  elapsed_checkpoint_at: string | null;
  finished_at: string | null;
  outcome_kind: string | null;
  outcome_reason: string | null;
  result: string | null;
  stop_request_key: string | null;
  result_facts: string | null;
  state_seq: string;
};

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function turnRowOf(row: SqlRow): TurnRow {
  return {
    id: String(row["id"]),
    session: String(row["session"]),
    input_message: String(row["input_message"]),
    state: String(row["state"]) as TurnRow["state"],
    basis: String(row["basis"]),
    started_at: String(row["started_at"]),
    limits: String(row["limits"]),
    elapsed_active_ms: Number(row["elapsed_active_ms"]),
    elapsed_stall_ms: Number(row["elapsed_stall_ms"]),
    elapsed_checkpoint_at: text(row["elapsed_checkpoint_at"]),
    finished_at: text(row["finished_at"]),
    outcome_kind: text(row["outcome_kind"]),
    outcome_reason: text(row["outcome_reason"]),
    result: text(row["result"]),
    stop_request_key: text(row["stop_request_key"]),
    result_facts: text(row["result_facts"]),
    state_seq: String(row["state_seq"]),
  };
}

type Lookup = {
  sql: { get: (query: string, params: SqlParams) => SqlRow | undefined };
};

export function loadTurn(lookup: Lookup, id: string): TurnRow | undefined {
  const row = lookup.sql.get(
    `select ${TURN_COLUMNS} from turns where id = ?`,
    [id],
  );
  return row === undefined ? undefined : turnRowOf(row);
}

export function turnRecordOf(row: TurnRow): TurnRecord {
  const finished = row.state === "finished";
  return {
    id: row.id,
    session: row.session,
    input_message: row.input_message,
    state: row.state,
    basis: row.basis,
    started_at: row.started_at,
    limits: JSON.parse(row.limits) as TurnRecord["limits"],
    elapsed: {
      active_ms: row.elapsed_active_ms,
      stall_ms: row.elapsed_stall_ms,
      checkpoint_at: row.elapsed_checkpoint_at,
    },
    finished_at: row.finished_at,
    outcome: finished
      ? {
        kind: row.outcome_kind,
        reason: row.outcome_reason,
      } as TurnRecord["outcome"]
      : null,
    result: row.result,
    state_seq: row.state_seq,
  } as TurnRecord;
}
