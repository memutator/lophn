import { assert, assertEquals } from "@std/assert";
import { handleInvoke } from "./invoke.ts";
import { startRuntime } from "./startup.ts";
import {
  blueprint,
  clockAt,
  connection,
  installHandlers,
  REL,
  shaKey,
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
