import assert from "node:assert/strict";
import { test } from "node:test";

import type { Id } from "../../../protocol/base/ids.ts";
import { CORE_CALL_CHANNEL } from "../../ipc/core.ts";
import { FILE_READ_CHANNEL } from "../../ipc/files.ts";
import { SECRET_INPUT_OPEN_CHANNEL } from "../../ipc/secret-input.ts";
import { TERMINAL_OPEN_CHANNEL } from "../../ipc/terminal.ts";
import { WORKSPACE_LAYOUT_SAVE_CHANNEL } from "../../ipc/workspace.ts";
import { createMachineRoute, type MachineConnection } from "./machine-route.ts";

const HOST = "mch_01jx0000000000000000000000" as Id<"mch">;
const REMOTE_WINDOW = 7;
const LOCAL_WINDOW = 3;

type Sent = Parameters<MachineConnection["call"]>[0];

function readyConnection(sent: Sent[]): MachineConnection {
  return {
    current: () => ({ state: "ready", confirmedAt: 1 }),
    call: (input) => {
      sent.push(input);
      return Promise.resolve({ ok: true, value: { from: "host" } });
    },
    watch: () => Promise.resolve(),
    resume: () => {},
  };
}

test("a window of another machine reaches only that machine's connection; this computer's own channels refuse it", async () => {
  const route = createMachineRoute();
  const sent: Sent[] = [];
  route.bind(REMOTE_WINDOW, HOST, () => readyConnection(sent));
  const local: string[] = [];
  const handler = (channel: string) => () => {
    local.push(channel);
    return { ok: true, value: { from: "this computer" } };
  };
  const call = {
    kind: "read",
    resource: "sessions",
    method: "list",
    body: {},
  };

  const remote = await route.handle(
    CORE_CALL_CHANNEL,
    REMOTE_WINDOW,
    call,
    handler(CORE_CALL_CHANNEL),
  );
  assert.deepEqual(remote, { ok: true, value: { from: "host" } });
  assert.deepEqual(sent, [{ resource: "sessions", method: "list", body: {} }]);

  for (const channel of [
    TERMINAL_OPEN_CHANNEL,
    FILE_READ_CHANNEL,
    SECRET_INPUT_OPEN_CHANNEL,
    WORKSPACE_LAYOUT_SAVE_CHANNEL,
  ]) {
    const reply = (await route.handle(
      channel,
      REMOTE_WINDOW,
      {},
      handler(channel),
    )) as { ok: boolean; error?: { code: string } };
    assert.equal(reply.ok, false, channel);
    assert.equal(reply.error?.code, "forbidden", channel);
    assert.equal(route.passes(channel, REMOTE_WINDOW), false, channel);
  }
  assert.deepEqual(local, [], "no handler of this computer ran");

  const own = await route.handle(
    CORE_CALL_CHANNEL,
    LOCAL_WINDOW,
    call,
    handler(CORE_CALL_CHANNEL),
  );
  assert.deepEqual(own, { ok: true, value: { from: "this computer" } });
  assert.deepEqual(local, [CORE_CALL_CHANNEL]);
  assert.equal(
    sent.length,
    1,
    "the host got nothing from this computer's window",
  );
});
