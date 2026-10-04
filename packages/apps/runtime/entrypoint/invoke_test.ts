import { assert, assertEquals } from "@std/assert";
import { handleInvoke } from "./invoke.ts";
import { startRuntime } from "./startup.ts";
import { verifyConnection } from "./verify.ts";
import {
  blueprint,
  clockAt,
  connection,
  installHandlers,
  REL,
  shaKey,
  sign,
  startLine,
} from "./testing.ts";
import { COMMAND_BODY_MAX_BYTES } from "./limits.ts";
import type { AppConnection } from "./wire.ts";

let saves = 0;
installHandlers([
  {
    command: "usage.save",
    handle: () => {
      saves += 1;
      return { saved: true };
    },
  },
  { command: "usage.read", handle: () => ({ rows: [] }) },
  { command: "undo", handle: () => undefined },
]);

Deno.test("apps/runtime#R12 apps/invocations#R4 apps/blueprint#R12 apps/runtime#R10: one invocation survives a dropped response", async () => {
  let brokerCalls = 0;
  let releaseBroker: (() => void) | undefined;
  const started = startRuntime({
    line: startLine(),
    blueprint: blueprint(),
    key: shaKey(),
    clock: clockAt(),
    ids: { newId: (prefix) => `${prefix}_01h455vb4pex5v6nkc6gd5fdw1` },
    broker: () => {
      brokerCalls += 1;
      return new Promise((resolve) => {
        releaseBroker = () =>
          resolve({ status: 503, body: { accepted: false } });
      });
    },
    dataSchema: 0,
  });
  started.state.accepting = true;
  const user = connection() as AppConnection;
  const body = JSON.stringify({
    request_key: "once",
    release: REL,
    command: "usage.save",
  });
  const first = await handleInvoke(
    started.state,
    "/_lophn/commands/invoke",
    new TextEncoder().encode(body),
    user,
  );
  assertEquals(first.status, 200);
  assertEquals(saves, 1);
  const again = await handleInvoke(
    started.state,
    "/_lophn/commands/invoke",
    new TextEncoder().encode(body),
    user,
  );
  assertEquals(again.status, 200);
  assertEquals(saves, 1);
  assertEquals(started.state.invocations.size, 1);

  const huge = new Uint8Array(COMMAND_BODY_MAX_BYTES + 1);
  const limited = await handleInvoke(
    started.state,
    "/_lophn/commands/invoke",
    huge,
    user,
  );
  assertEquals(limited.status, 400);
  assertEquals(limited.error?.code, "invalid_input");
  assert(String(limited.error?.details?.hint).includes("blob"));
  assert(brokerCalls >= 1);
  assertEquals(started.state.invocations.size, 1);
  releaseBroker?.();
});

Deno.test("apps/invocations#R4: ten internal helpers stay one invocation", async () => {
  let helpers = 0;
  installHandlers([{
    command: "usage.batch",
    handle: async () => {
      for (let index = 0; index < 10; index += 1) {
        helpers += 1;
        await Promise.resolve();
      }
      return { saved: true, helpers };
    },
  }]);
  const started = startRuntime({
    line: startLine({ mode: "test", release: null }),
    blueprint: blueprint(),
    key: shaKey(),
    clock: clockAt(),
    ids: { newId: (prefix) => `${prefix}_01h455vb4pex5v6nkc6gd5fdw2` },
    broker: () => Promise.resolve({ status: 503, body: null }),
    dataSchema: 0,
  });
  started.state.accepting = true;
  const user = connection({ mode: "test", release: null }) as AppConnection;
  const outcome = await handleInvoke(
    started.state,
    "/_lophn/commands/invoke",
    new TextEncoder().encode(JSON.stringify({
      request_key: "helpers",
      command: "usage.batch",
    })),
    user,
  );
  assertEquals(outcome.status, 200);
  assertEquals(helpers, 10);
  assertEquals(started.state.invocations.size, 1);
  assertEquals(
    (outcome.body as { mode: string }).mode,
    "test",
  );
});

Deno.test("apps/runtime#R11: status is a GET of the same invocation", async () => {
  const started = startRuntime({
    line: startLine(),
    blueprint: blueprint(),
    key: shaKey(),
    clock: clockAt(),
    ids: { newId: (prefix) => `${prefix}_01h455vb4pex5v6nkc6gd5fdw3` },
    broker: () => Promise.resolve({ status: 200, body: { accepted: true } }),
    dataSchema: 0,
  });
  started.state.accepting = true;
  const user = connection() as AppConnection;
  const invoked = await handleInvoke(
    started.state,
    "/_lophn/commands/invoke",
    new TextEncoder().encode(JSON.stringify({
      request_key: "status-1",
      release: REL,
      command: "usage.read",
    })),
    user,
  );
  assertEquals(invoked.status, 200);
  const id = started.state.byRequest.get("status-1");
  assert(id);
  const posted = await handleInvoke(
    started.state,
    "/_lophn/commands/status",
    new TextEncoder().encode("{}"),
    user,
  );
  assertEquals(posted.status, 400);
  const query = new URLSearchParams({
    request_key: "status-1",
    invocation: id,
  });
  const status = await handleInvoke(
    started.state,
    "/_lophn/commands/status",
    query,
    user,
  );
  assertEquals(status.status, 200);
  assertEquals((status.body as { progress: string }).progress, "succeeded");
  assertEquals(started.state.invocations.size, 1);
});

Deno.test("apps/runtime#R11: test mode does not pretend to be preview", async () => {
  const started = startRuntime({
    line: startLine({ mode: "test", release: null }),
    blueprint: blueprint(),
    key: shaKey(),
    clock: clockAt(),
    ids: { newId: (prefix) => `${prefix}_01h455vb4pex5v6nkc6gd5fdw4` },
    broker: () => Promise.resolve({ status: 200, body: { accepted: true } }),
    dataSchema: 0,
  });
  started.state.accepting = true;
  const preview = connection({
    mode: "preview",
    release: null,
  }) as AppConnection;
  const mismatch = await verifyConnection(
    started.state.key,
    await sign(preview),
    started.state.identity,
    started.state.clock,
  );
  // shaKey는 서명을 통과시킨다. mode가 달라도 test를 preview로 바꾸지 않고 거절한다.
  assertEquals(mismatch.ok, false);
  if (!mismatch.ok) assertEquals(mismatch.error.code, "conflict");
  const honest = connection({ mode: "test", release: null }) as AppConnection;
  const matched = await handleInvoke(
    started.state,
    "/_lophn/commands/invoke",
    new TextEncoder().encode(JSON.stringify({
      request_key: "mode-ok",
      command: "usage.read",
    })),
    honest,
  );
  assertEquals(matched.status, 200);
  assertEquals((matched.body as { mode: string }).mode, "test");
});
