import { type LophnError, ok, type Result } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import type {
  ProblemSnapshot,
  SnapshotInput,
} from "../../../protocol/problems/mod.ts";

const SNAP_COLS =
  `id, captured_at, invocation, invocation_record_missing_reason,
  error_name, error_message, error_frames, error_stack, error_truncation_notes,
  logs_blob, logs_line_count, logs_truncated, logs_scope, logs_from_at, logs_to_at, logs_collected_at`;

// 발생 근거를 평평한 열에 남긴다. 없는 덩어리(invocation, error, logs)는 열이 null이다.
// `problem.record_report` handler가 같은 tx 안에서 부른다.
export function insertProblemSnapshot(
  tx: Tx,
  snapshot: ProblemSnapshot,
): Result<true, LophnError> {
  const { invocation, error, logs } = snapshot;
  tx.sql.run(
    `insert into snapshots (${SNAP_COLS}) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      snapshot.id,
      snapshot.captured_at,
      invocation?.id ?? null,
      invocation?.record_missing_reason?.reason ?? null,
      error?.name ?? null,
      error?.message ?? null,
      error === null ? null : JSON.stringify(error.frames),
      error?.stack ?? null,
      error === null ? null : JSON.stringify(error.truncation_notes),
      logs?.blob ?? null,
      logs?.line_count ?? null,
      logs == null ? null : logs.truncated ? 1 : 0,
      logs?.scope ?? null,
      logs?.from_at ?? null,
      logs?.to_at ?? null,
      logs?.collected_at ?? null,
    ],
  );
  return ok(true);
}

// 옛 `reporting/commands.ts`가 아직 쓴다. 화면 증거와 값·이유 짝은 새 표에 없으므로 버린다.
export function insertSnapshot(
  tx: Tx,
  snapshot: SnapshotInput,
): Result<true, LophnError> {
  const error = snapshot.error;
  return insertProblemSnapshot(tx, {
    id: snapshot.id,
    captured_at: snapshot.captured_at,
    invocation: snapshot.invocation,
    error: error === null ? null : {
      name: error.name,
      message: error.message,
      frames: error.frames,
      stack: error.stack,
      truncation_notes: error.truncation_notes,
    },
    logs: snapshot.logs,
  });
}

type Row = Record<string, unknown>;
const text = (value: unknown) =>
  value === null || value === undefined ? null : String(value);

// snapshots 표 한 행을 ProblemSnapshot으로 읽는다. 없는 snapshot은 undefined다.
export function readProblemSnapshot(
  sql: { get(query: string, params: string[]): Row | undefined },
  id: string,
): ProblemSnapshot | undefined {
  const row = sql.get(`select ${SNAP_COLS} from snapshots where id = ?`, [id]);
  if (row === undefined) return undefined;
  const recordMissing = text(row["invocation_record_missing_reason"]);
  return {
    id: String(row["id"]),
    captured_at: String(row["captured_at"]),
    invocation: row["invocation"] === null ? null : {
      id: String(row["invocation"]),
      record_missing_reason: recordMissing === null
        ? null
        : { reason: recordMissing },
    },
    error: row["error_name"] === null ? null : {
      name: String(row["error_name"]),
      message: text(row["error_message"]),
      frames: JSON.parse(String(row["error_frames"])),
      stack: text(row["error_stack"]),
      truncation_notes: JSON.parse(String(row["error_truncation_notes"])),
    },
    logs: row["logs_blob"] === null ? null : {
      blob: String(row["logs_blob"]),
      line_count: Number(row["logs_line_count"]),
      truncated: Number(row["logs_truncated"]) === 1,
      scope: String(row["logs_scope"]),
      from_at: text(row["logs_from_at"]),
      to_at: text(row["logs_to_at"]),
      collected_at: String(row["logs_collected_at"]),
    },
  } as ProblemSnapshot;
}
