import { assert, assertEquals } from "@std/assert";
import {
  commandInvokeInputSchema,
  commandInvokeOutputSchema,
  commandRevertResultSchema,
  commandStatusOutputSchema,
  controlProbeInputSchema,
  controlShutdownInputSchema,
  DIRECT_SOCKET_PATHS,
  readSourceStateSchema,
  screenAssetPathSchema,
  screenGetInputSchema,
} from "./direct-socket.ts";
import { SHUTDOWN_GRACE_MS } from "./channel-values.ts";

const REL = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const INV = "inv_01h455vb4pex5v6nkc6gd5fdw1";
const HASH = "ab".repeat(32);
const AT = "2026-10-04T00:00:00.000Z";

Deno.test("apps/runtime#R10, apps/runtime#R11, apps/runtime#R12: direct socket 경로는 core API가 아니다", () => {
  assertEquals(
    Object.values(DIRECT_SOCKET_PATHS).some((path) => path.startsWith("/v1/")),
    false,
  );
  assertEquals(DIRECT_SOCKET_PATHS.invoke, "/_lophn/commands/invoke");
  assertEquals(DIRECT_SOCKET_PATHS.cancel, "/_lophn/commands/cancel");
  assertEquals(DIRECT_SOCKET_PATHS.status, "/_lophn/commands/status");
  assertEquals(DIRECT_SOCKET_PATHS.probe, "/_lophn/control/probe");
  assertEquals(DIRECT_SOCKET_PATHS.open, "/_lophn/control/open");
  assertEquals(DIRECT_SOCKET_PATHS.close, "/_lophn/control/close");
  assertEquals(DIRECT_SOCKET_PATHS.shutdown, "/_lophn/control/shutdown");
  assert(DIRECT_SOCKET_PATHS.screen.startsWith("/screens"));
});

Deno.test("apps/runtime#R11, apps/invocations#R7, apps/invocations#R8: invoke 입력·출력과 revert 결과", () => {
  const invoke = commandInvokeInputSchema.parse({
    request_key: "call-1",
    release: REL,
    command: "usage.save",
    input: { day: "2026-10-04" },
    proof: {
      payload: {
        invocation: INV,
        process_nonce: "nonce-1",
        release: REL,
        command: "usage.save",
        input_hash: HASH,
        caller: { kind: "direct" },
        expires_at: AT,
      },
      signature: "A".repeat(86),
    },
  });
  assertEquals(invoke.proof?.payload.invocation, INV);
  // 서명 없는 proof payload는 받지 않는다.
  assertEquals(
    commandInvokeInputSchema.safeParse({
      request_key: "call-1",
      command: "usage.save",
      proof: {
        invocation: INV,
        process_nonce: "nonce-1",
        release: REL,
        command: "usage.save",
        input_hash: HASH,
        caller: { kind: "direct" },
        expires_at: AT,
      },
    }).success,
    false,
  );
  const output = commandInvokeOutputSchema.parse({
    result: {
      result: { saved: true },
      revert: { invocation: INV, receipt: "before-1", expected_revision: "4" },
    },
    invocation: INV,
    mode: "live",
  });
  assertEquals(output.result.revert?.receipt, "before-1");
  assert(
    commandRevertResultSchema.safeParse({
      invocation: INV,
      receipt: "before-1",
      expected_revision: "0",
    }).success === false,
  );
  assert(commandStatusOutputSchema.safeParse({ progress: "unknown" }).success);
  assert(
    commandStatusOutputSchema.safeParse({ progress: "accepted" }).success ===
      false,
  );
});

Deno.test("apps/invocations#R14: read 결과는 원천 상태·coverage·freshness·이어 읽기 기준을 구분한다", () => {
  const empty = readSourceStateSchema.parse({
    coverage: "complete",
    freshness: "fresh",
    continuation: null,
  });
  const missing = readSourceStateSchema.parse({
    coverage: "uncollected",
    freshness: "unknown",
    continuation: null,
  });
  assert(empty.coverage !== missing.coverage);
  assert(
    readSourceStateSchema.safeParse({
      coverage: "none",
      freshness: "fresh",
      continuation: null,
    }).success === false,
  );
  const page = readSourceStateSchema.parse({
    coverage: "partial",
    freshness: "stale",
    continuation: "page-1",
  });
  assertEquals(page.continuation, "page-1");
});

Deno.test("apps/runtime#R15, apps/runtime#R31, apps/preview#R3: 화면 path와 종료 유예", () => {
  assert(screenAssetPathSchema.safeParse("assets/app.js").success);
  assert(screenAssetPathSchema.safeParse("../secret").success === false);
  assert(
    screenAssetPathSchema.safeParse("https://example.test/a").success === false,
  );
  assert(
    screenGetInputSchema.safeParse({
      screen: { screen: "usage", size: "panel", view_session: "view-1" },
      path: "index.html",
    }).success,
  );
  assertEquals(
    controlShutdownInputSchema.safeParse({
      process_nonce: "nonce-1",
      grace_ms: SHUTDOWN_GRACE_MS,
    }).success,
    true,
  );
  assertEquals(
    controlShutdownInputSchema.safeParse({
      process_nonce: "nonce-1",
      grace_ms: 0,
    }).success,
    false,
  );
});

Deno.test("apps/runtime#R11, apps/invocations#R7: 모르는 field와 틀린 ID 접두사를 거절한다", () => {
  assert(
    commandInvokeInputSchema.safeParse({
      request_key: "call-1",
      release: REL,
      command: "usage.save",
      actor: "user",
    }).success === false,
  );
  assert(
    commandInvokeInputSchema.safeParse({
      request_key: "call-1",
      release: "app_01h455vb4pex5v6nkc6gd5fdw1",
      command: "usage.save",
    }).success === false,
  );
  assert(
    controlProbeInputSchema.safeParse({
      process_nonce: "nonce-1",
      extra: 1,
    }).success === false,
  );
});
