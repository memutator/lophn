// machine credential로 core의 record_* route를 부른다. record_started·stopped·unavailable은 command이고
// 관측 사실이라 compare(base_revision)가 없다. record_preview는 memory route라 본문이 입력 그대로다.
import type { Result } from "../../../base/mod.ts";
import type { RuntimeRecord } from "../../apps/runtime/core-link.ts";

type RecordResponse = { status: number; body: unknown };

export function recordBody(record: RuntimeRecord): Record<string, unknown> {
  if (record.method === "record_preview") {
    return {
      app: record.app,
      process_nonce: record.process_nonce,
      state: record.state,
      ...(record.reason ? { reason: record.reason } : {}),
    };
  }
  return {
    input: recordInput(record),
    idempotency_key: crypto.randomUUID(),
    // record_*는 관측 사실이라 비교 기준이 없다. envelope는 빈 compare를 요구한다.
    compare: {},
    prepared: [],
  };
}

function recordInput(
  record: Exclude<RuntimeRecord, { method: "record_preview" }>,
): Record<string, unknown> {
  if (record.method === "record_started") {
    return {
      app: record.app,
      process_nonce: record.process_nonce,
      started_at: record.started_at,
      attestation: record.attestation,
      ...(record.start_changeset === undefined
        ? {}
        : { start_changeset: record.start_changeset }),
      ...(record.start_hlc === undefined
        ? {}
        : { start_hlc: record.start_hlc }),
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
  record: RuntimeRecord,
  response: RecordResponse,
): Result<{ state: string }> {
  if (response.status < 200 || response.status >= 300) {
    return {
      ok: false,
      error: { code: "unavailable", message: "core record failed" },
    };
  }
  if (record.method === "record_preview") {
    return { ok: true, value: { state: record.state } };
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
