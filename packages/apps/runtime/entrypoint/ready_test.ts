import { assert, assertEquals } from "@std/assert";
import { handleControl } from "./control.ts";
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
import type { AppConnection } from "./wire.ts";

installHandlers([{ command: "usage.extra", handle: () => undefined }]);

Deno.test("apps/runtime#R3 apps/blueprint#R8: ready starts closed and rejects a handler list that differs", async () => {
  const started = startRuntime({
    line: startLine(),
    blueprint: blueprint(),
    key: shaKey(),
    clock: clockAt(),
    ids: { newId: () => "inv_01h455vb4pex5v6nkc6gd5fdw1" },
    broker: () => Promise.resolve({ status: 200, body: { accepted: true } }),
    dataSchema: 0,
  });
  assertEquals(started.state.ready, false);
  assertEquals(started.state.accepting, false);
  const machine = connection({ actor: "machine" }) as AppConnection;
  const probe = handleControl(
    started.state,
    "/_lophn/control/probe",
    { process_nonce: started.state.identity.processNonce },
    machine,
  );
  assertEquals(probe.status, 409);
  assert("error" in probe);
  assertEquals(probe.error.code, "conflict");

  const write = await import("./invoke.ts").then((mod) =>
    mod.handleInvoke(
      started.state,
      "/_lophn/commands/invoke",
      new TextEncoder().encode(JSON.stringify({
        request_key: "w",
        release: REL,
        command: "usage.save",
      })),
      connection() as AppConnection,
    )
  );
  assertEquals(write.status, 503);
  let clockClosed = false;
  try {
    started.state.businessClock.now();
  } catch {
    clockClosed = true;
  }
  assert(clockClosed);
  const opened = handleControl(
    started.state,
    "/_lophn/control/open",
    { process_nonce: started.state.identity.processNonce, release: REL },
    machine,
  );
  assertEquals(opened.status, 409);
  assert(started.state.accepting === false);
});
