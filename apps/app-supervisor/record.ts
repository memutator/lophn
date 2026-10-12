// machine credential로 core의 record_* command를 부른다.
// record_*는 관측 사실이라 compare(base_revision)가 없다.
import type { Result } from "../../packages/base/mod.ts";
import type { RuntimeRecord } from "../../packages/core/apps/runtime/core-link.ts";

export type RecordResponse = { status: number; body: unknown };

export function recordInput(record: RuntimeRecord): Record<string, unknown> {
  if (record.method === "record_started") {
    return {
      app: record.app,
      process_nonce: record.process_nonce,
      started_at: record.started_at,
      attestation: record.attestation,
    };
  }
  if (record.method === "record_stopped") {
    return {
      app: record.app,
      release: record.release,
      process_nonce: record.process_nonce,
      started_at: record.started_at,
      termination_confirmed: true,
    };
  }
  return {
    app: record.app,
    release: record.release,
    ...(record.process_nonce ? { process_nonce: record.process_nonce } : {}),
    ...(record.started_at ? { started_at: record.started_at } : {}),
    reason: record.reason,
  };
}

// 성공 본문은 command 출력 그대로 { app, state }다(실제 core 응답 모양).
export function readRecordState(
  response: RecordResponse,
): Result<{ state: string }> {
  if (response.status < 200 || response.status >= 300) {
    return {
      ok: false,
      error: { code: "unavailable", message: "core record failed" },
    };
  }
  const body = response.body as { state?: { state?: unknown } } | null;
  const state = body?.state?.state;
  if (typeof state !== "string") {
    return {
      ok: false,
      error: {
        code: "unavailable",
        message: "core record response is not valid",
      },
    };
  }
  return { ok: true, value: { state } };
}
