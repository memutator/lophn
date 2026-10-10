import { assert, assertEquals } from "@std/assert";
import {
  APPS_CONFIRM_POLL_WAIT_MAX_MS,
  AUTOMATION_CONCURRENCY_LIMIT,
  BROKER_SOCKET_PATHS,
  brokerAppsConfirmPollInputSchema,
  brokerAppsConfirmPollOutputSchema,
  brokerAppsConfirmRequestInputSchema,
  brokerAppsConnectInputSchema,
  brokerAutomationReleaseInputSchema,
  brokerAutomationTryAcquireOutputSchema,
  brokerControlWatchOutputSchema,
  brokerDocumentSaveInputSchema,
  brokerInvocationSubmitInputSchema,
  brokerNetFetchInputSchema,
  brokerPermissionErrorSchema,
  brokerProblemReportInputSchema,
  brokerReadyInputSchema,
  brokerSecretUseInputSchema,
} from "./broker.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const HASH = "ab".repeat(32);

Deno.test("apps/runtime#R5, apps/runtime#R9, apps/runtime#R18, apps/connections#R6, apps/automations#R5, apps/automations#R6, apps/automations#R9, apps/automations#R12, apps/sdk#R23, apps/sdk#R27, apps/sdk#R28, apps/sdk#R30, apps/sdk#R31, apps/sdk#R40: broker 경로 13개의 입력·출력", () => {
  assertEquals(Object.keys(BROKER_SOCKET_PATHS).length, 13);
  assertEquals(new Set(Object.values(BROKER_SOCKET_PATHS)).size, 13);
  for (const path of Object.values(BROKER_SOCKET_PATHS)) {
    assert(path.startsWith("/_lophn/broker/"));
    assert(path.startsWith("/v1/") === false);
  }
  assert(
    brokerNetFetchInputSchema.safeParse({
      process_nonce: "nonce-1",
      mode: "live",
      invocation: null,
      command: "usage.sync",
      host: "api.example.test",
      port: 443,
      method: "GET",
      path: "/usage",
    }).success,
  );
  assert(
    brokerSecretUseInputSchema.safeParse({
      process_nonce: "nonce-1",
      mode: "live",
      release: REL,
      invocation: null,
      command: "usage.sync",
      input_hash: HASH,
      name: "vendor.token",
      destination: { scheme: "https", host: "api.example.test", port: 443 },
    }).success,
  );
  assert(
    brokerProblemReportInputSchema.safeParse({
      process_nonce: "nonce-1",
      mode: "preview",
      code: "usage_stale",
      trace: "a".repeat(65),
    }).success === false,
  );
  assert(
    brokerAppsConnectInputSchema.safeParse({
      process_nonce: "nonce-1",
      mode: "live",
      app: APP,
      commands: ["usage.list"],
      parent_invocation: null,
    }).success,
  );
  assert(
    brokerReadyInputSchema.safeParse({
      process_nonce: "nonce-1",
      mode: "live",
      attestation: {
        release: REL,
        bundle_hash: HASH,
        commands: ["usage.list"],
        data_schema: 1,
        process_nonce: "nonce-1",
        connection_ok: true,
      },
    }).success,
  );
  assert(
    brokerInvocationSubmitInputSchema.safeParse({
      process_nonce: "nonce-1",
      mode: "live",
      invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
      fact: "finish",
      summary: { code: "ok" },
    }).success,
  );
  assertEquals(
    brokerControlWatchOutputSchema.parse({ open: false }).open,
    false,
  );
  const INV = "inv_01h455vb4pex5v6nkc6gd5fdw1";
  assert(
    brokerAutomationReleaseInputSchema.safeParse({
      process_nonce: "nonce-1",
      mode: "preview",
      release: REL,
      key: "usage.sync",
      invocation: INV,
    }).success,
  );
  assert(
    brokerDocumentSaveInputSchema.safeParse({
      process_nonce: "nonce-1",
      mode: "live",
      key: "usage",
      base_version: null,
      idempotency_key: "save-1",
    }).success,
  );
  assert(
    brokerDocumentSaveInputSchema.safeParse({
      process_nonce: "nonce-1",
      mode: "live",
      key: "usage",
      base_version: "doc_01h455vb4pex5v6nkc6gd5fdw1",
      idempotency_key: "save-1",
    }).success === false,
  );
  assert(
    brokerProblemReportInputSchema.safeParse({
      process_nonce: "nonce-1",
      mode: "live",
      code: "usage_stale",
      unknown: true,
    }).success === false,
  );
  assert(
    brokerProblemReportInputSchema.safeParse({
      process_nonce: "nonce-1",
      mode: "live",
      code: "usage_stale",
      report_id: "rpt_01h455vb4pex5v6nkc6gd5fdw1",
      observed_at: "2026-10-04T01:02:03.004Z",
      details: { command: "read_settings" },
      invocation: {
        id: "inv_01h455vb4pex5v6nkc6gd5fdw1",
        binding: "sdk_context",
        record_missing_reason: null,
      },
    }).success,
  );
  const permit = brokerAutomationTryAcquireOutputSchema.parse({
    permit: false,
    limit: AUTOMATION_CONCURRENCY_LIMIT,
    timeout_ms: 600_000,
  });
  assertEquals(permit.limit, 4);
  assert(
    brokerPermissionErrorSchema.safeParse({
      error: { code: "forbidden", message: "permission required" },
    }).success === false,
  );
  assert(
    brokerPermissionErrorSchema.safeParse({
      error: {
        code: "forbidden",
        message: "permission required",
        details: {
          permission: "net.fetch",
          scope: { host: "api.example.test", port: 443 },
        },
      },
    }).success,
  );
});

Deno.test("apps/connections#R3, apps/connections#R7: confirm 요청·poll과 호출 출처 field의 입력·출력", () => {
  const child = { process_nonce: "nonce-1", mode: "live" };
  const request = {
    ...child,
    app: APP,
    command: "usage.purge",
    input: { amount: 1 },
    target_release: REL,
    target_process_nonce: "target-nonce",
    parent_invocation: null,
  };
  assert(brokerAppsConfirmRequestInputSchema.safeParse(request).success);
  // 신원·입력 지문·caller 주장은 본문에 없다.
  for (const claim of [{ caller: { kind: "app" } }, { input_hash: HASH }]) {
    assert(
      !brokerAppsConfirmRequestInputSchema.safeParse({ ...request, ...claim })
        .success,
    );
  }
  const poll = { ...child, approval: "apr_01h455vb4pex5v6nkc6gd5fdw1" };
  assert(brokerAppsConfirmPollInputSchema.safeParse(poll).success);
  assert(
    brokerAppsConfirmPollInputSchema.safeParse({
      ...poll,
      wait_ms: APPS_CONFIRM_POLL_WAIT_MAX_MS,
    }).success,
  );
  assert(
    !brokerAppsConfirmPollInputSchema.safeParse({
      ...poll,
      wait_ms: APPS_CONFIRM_POLL_WAIT_MAX_MS + 1,
    }).success,
  );
  for (const state of ["pending", "rejected", "expired"]) {
    assert(brokerAppsConfirmPollOutputSchema.safeParse({ state }).success);
  }
  // granted는 inv와 서명된 proof가 있어야 한다.
  assert(
    !brokerAppsConfirmPollOutputSchema.safeParse({ state: "granted" }).success,
  );
  const connect = {
    ...child,
    app: APP,
    commands: ["usage.list"],
    parent_invocation: null,
  };
  const incoming = { app: APP, release: REL, parent_invocation: null };
  assert(
    brokerAppsConnectInputSchema.safeParse({ ...connect, incoming }).success,
  );
  // path 주장은 받지 않는다.
  assert(
    !brokerAppsConnectInputSchema.safeParse({
      ...connect,
      incoming: { ...incoming, path: [APP] },
    }).success,
  );
});
