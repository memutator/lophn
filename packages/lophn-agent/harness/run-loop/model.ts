import { canonicalize } from "../../../base/mod.ts";
import {
  DEFAULT_RUN_LIMITS,
  type RunRecord,
  type RunSource,
} from "../../../contracts/lophn-agent/mod.ts";
import type { SqlParams, SqlRow } from "../../../contracts/platform/mod.ts";

// row를 화면 값으로 바꾸는 도움. 상태 전이 규칙은 domain-model
// lophn-agent/harness/run-loop의 표 그대로다. 순수 함수와 읽기 조회만 있다.

export const RUN_COLUMNS = `id, assignment, session, source, continued_from,
  start_after, start_confirmed_seq, state, basis, waiting_on, started_at, limits,
  elapsed_active_ms, elapsed_stall_ms, elapsed_checkpoint_at, finished_at,
  outcome_kind, outcome_reason, result, stop_request_key, result_facts,
  state_seq, accepted_seq`;

export type RunRow = {
  id: string;
  assignment: string;
  session: string | null;
  source: string;
  continued_from: string | null;
  start_after: string | null;
  start_confirmed_seq: string | null;
  state: "accepted" | "running" | "waiting_user" | "finished";
  basis: string | null;
  waiting_on: string | null;
  started_at: string | null;
  limits: string | null;
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
  accepted_seq: string;
};

function text(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

export function rowOf(row: SqlRow): RunRow {
  return {
    id: String(row["id"]),
    assignment: String(row["assignment"]),
    session: text(row["session"]),
    source: String(row["source"]),
    continued_from: text(row["continued_from"]),
    start_after: text(row["start_after"]),
    start_confirmed_seq: text(row["start_confirmed_seq"]),
    state: String(row["state"]) as RunRow["state"],
    basis: text(row["basis"]),
    waiting_on: text(row["waiting_on"]),
    started_at: text(row["started_at"]),
    limits: text(row["limits"]),
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
    accepted_seq: String(row["accepted_seq"]),
  };
}

type Lookup = {
  sql: { get: (query: string, params: SqlParams) => SqlRow | undefined };
};

export function loadRun(lookup: Lookup, id: string): RunRow | undefined {
  const row = lookup.sql.get(
    `select ${RUN_COLUMNS} from runs where id = ?`,
    [id],
  );
  return row === undefined ? undefined : rowOf(row);
}

export function recordOf(row: RunRow): RunRecord {
  const finished = row.state === "finished";
  return {
    id: row.id,
    assignment: row.assignment,
    session: row.session,
    source: JSON.parse(row.source) as RunRecord["source"],
    continued_from: row.continued_from,
    start_after: row.start_after,
    start_confirmed_seq: row.start_confirmed_seq,
    state: row.state,
    basis: row.basis,
    waiting_on: row.waiting_on as RunRecord["waiting_on"],
    started_at: row.started_at,
    limits: row.limits === null
      ? { ...DEFAULT_RUN_LIMITS }
      : JSON.parse(row.limits) as RunRecord["limits"],
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
      } as RunRecord["outcome"]
      : null,
    result: row.result,
    state_seq: row.state_seq,
    accepted_seq: row.accepted_seq,
  };
}

export function sourceColumns(source: RunSource): {
  message: string | null;
  sender: string | null;
  originalMessage: string | null;
  dedupKey: string | null;
} {
  return {
    message: source.kind === "message" ? source.message : null,
    sender: source.kind === "handoff" ? source.sender_run : null,
    originalMessage: source.kind === "handoff" ? source.original_message : null,
    dedupKey: source.kind === "handoff" ? source.dedup_key : null,
  };
}

// 같은 계기·같은 내용 판정(R2).
export function sameAcceptance(
  row: RunRow,
  input: {
    assignment: string;
    session: string | null;
    source: RunSource;
    continued_from: string | null;
    start_after: string | null;
  },
): boolean {
  return row.assignment === input.assignment &&
    row.session === input.session &&
    row.continued_from === input.continued_from &&
    row.start_after === input.start_after &&
    canonicalize(JSON.parse(row.source)) === canonicalize(input.source);
}

// 선행 정책(R6): completed는 접수 순서대로 시작하고 failed·stopped는 사람이
// 계속할 요청으로 확인(start_confirmed_seq)한 뒤에만 시작한다.
export function predecessorAllows(
  row: Pick<RunRow, "start_after" | "start_confirmed_seq">,
  predecessor: Pick<RunRow, "state" | "outcome_kind"> | undefined,
): boolean {
  if (row.start_after === null) return true;
  if (predecessor === undefined || predecessor.state !== "finished") {
    return false;
  }
  if (predecessor.outcome_kind === "completed") return true;
  return row.start_confirmed_seq !== null;
}
