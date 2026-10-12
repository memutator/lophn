import { type LophnError, ok, type Result } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import type { SnapshotInput } from "../../../protocol/problems/mod.ts";

const SNAP_COLS = `id, captured_at,
  invocation, invocation_binding, invocation_record_missing_reason, invocation_missing_reason,
  error_name, error_missing_reason, error_message, error_message_missing_reason, error_frames, error_source_missing_reason, error_stack, error_stack_missing_reason, error_truncation_notes,
  logs_blob, logs_line_count, logs_truncated, logs_scope, logs_from_at, logs_to_at, logs_collected_at, logs_missing_reason,
  screen_name, screen_observed_at, screen_state, screen_state_missing_reason, screen_screenshot, screen_screenshot_missing_reason, screen_missing_reason`;

// snapshot 항목은 값 또는 공백 아닌 이유 하나로 평평한 열에 남는다.
// 부분 수집 실패도 나머지 자료와 함께 확정한다(domain-model problems/snapshots).
// paired check는 표가 거절하므로 값과 이유의 짝은 input schema가 이미 검증한다.
export function insertSnapshot(
  tx: Tx,
  snapshot: SnapshotInput,
): Result<true, LophnError> {
  const invocation = snapshot.invocation;
  const error = snapshot.error;
  const logs = snapshot.logs;
  const screen = snapshot.screen;
  tx.sql.run(
    `insert into snapshots (${SNAP_COLS}) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      snapshot.id,
      snapshot.captured_at,
      invocation?.id ?? null,
      invocation?.binding ?? null,
      invocation?.record_missing_reason?.reason ?? null,
      snapshot.invocation_missing_reason?.reason ?? null,
      error?.name ?? null,
      snapshot.error_missing_reason?.reason ?? null,
      error?.message ?? null,
      error?.message_missing_reason?.reason ?? null,
      error === null || error === undefined
        ? null
        : JSON.stringify(error.frames),
      error?.source_missing_reason?.reason ?? null,
      error?.stack ?? null,
      error?.stack_missing_reason?.reason ?? null,
      error == null ? "[]" : JSON.stringify(error.truncation_notes),
      logs?.blob ?? null,
      logs?.line_count ?? null,
      logs == null ? null : logs.truncated ? 1 : 0,
      logs?.scope ?? null,
      logs?.from_at ?? null,
      logs?.to_at ?? null,
      logs?.collected_at ?? null,
      snapshot.logs_missing_reason?.reason ?? null,
      screen?.name ?? null,
      screen?.observed_at ?? null,
      screen?.state ?? null,
      screen?.state_missing_reason?.reason ?? null,
      screen?.screenshot ?? null,
      screen?.screenshot_missing_reason?.reason ?? null,
      snapshot.screen_missing_reason?.reason ?? null,
    ],
  );
  return ok(true);
}
