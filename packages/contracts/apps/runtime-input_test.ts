import { assert } from "@std/assert";
import {
  appAutomations,
  appDisableExecution,
  appEnableExecution,
  appExport,
  appLogsInputSchema,
  appRecordStarted,
  appRecordStartedInputSchema,
  appRecordStopped,
  appRecordStoppedInputSchema,
  appRecordUnavailable,
  appRecordUnavailableInputSchema,
  appRuntime,
  readyAttestationSchema,
} from "./runtime.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const OTHER = "doc_01h455vb4pex5v6nkc6gd5fdw1";
const reason = {
  code: "ready_timeout",
  summary: "30초 안에 준비를 확인하지 못함",
};
const attestation = {
  release: REL,
  bundle_hash: "ab".repeat(32),
  commands: ["usage.list"],
  data_schema: 1,
  process_nonce: "nonce-1",
  connection_ok: true as const,
};

Deno.test("apps/runtime#R2, apps/runtime#R13, apps/runtime#R25: 모르는 field·틀린 값·틀린 ID를 거절한다", () => {
  assert(
    !appRecordStartedInputSchema.safeParse({
      app: OTHER,
      attestation,
    }).success,
  );
  assert(
    !appRecordStartedInputSchema.safeParse({
      app: APP,
      attestation: { ...attestation, connection_ok: false },
    }).success,
  );
  assert(
    !appRecordStartedInputSchema.safeParse({
      app: APP,
      attestation: { ...attestation, bundle_hash: "AB".repeat(32) },
    }).success,
  );
  // release 없는 preview는 부재를 허용한다. 가짜 rel ID를 만들지 않는다.
  readyAttestationSchema.parse({ ...attestation, release: null });
  // AppStarted는 live event다. preview 준비 값으로 운영 시작을 기록하지 않는다.
  assert(
    !appRecordStartedInputSchema.safeParse({
      app: APP,
      attestation: { ...attestation, release: null },
    }).success,
  );
  assert(
    !appRecordStartedInputSchema.safeParse({
      app: APP,
      attestation: { ...attestation, extra: true },
    }).success,
  );
  assert(
    !appRecordStartedInputSchema.safeParse({
      app: APP,
      attestation,
      extra: true,
    }).success,
  );
  assert(
    !appRecordUnavailableInputSchema.safeParse({
      app: APP,
      release: REL,
      reason: { ...reason, extra: true },
    }).success,
  );
  assert(
    !appLogsInputSchema.safeParse({ app: APP, invocation: OTHER }).success,
  );
  assert(
    !appRecordStoppedInputSchema.safeParse({
      app: APP,
      release: REL,
      process_nonce: "nonce-1",
      termination_confirmed: false,
    }).success,
  );
  assert(
    !appRecordUnavailableInputSchema.safeParse({
      app: APP,
      release: OTHER,
      reason,
      extra: true,
    }).success,
  );
  assert(!appLogsInputSchema.safeParse({ app: APP, lines: [] }).success);
  appRecordStoppedInputSchema.parse({
    app: APP,
    release: REL,
    process_nonce: "nonce-1",
    started_at: "2026-10-04T00:00:00.000Z",
    termination_confirmed: true,
  });
  appRecordUnavailableInputSchema.parse({ app: APP, release: REL, reason });
  for (
    const route of [
      appEnableExecution,
      appDisableExecution,
      appRuntime,
      appAutomations,
      appExport,
    ]
  ) {
    route.input.parse({ app: APP });
    assert(!route.input.safeParse({ app: OTHER }).success);
    assert(!route.input.safeParse({ app: APP, extra: true }).success);
  }
  for (
    const route of [appRecordStarted, appRecordStopped, appRecordUnavailable]
  ) {
    route.output.parse({
      app: APP,
      state: { state: "stopped", termination_pending: false },
    });
  }
});
