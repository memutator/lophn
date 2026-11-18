import assert from "node:assert/strict";
import { test } from "node:test";

import type { Id } from "../../../../protocol/base/ids.ts";
import { CORE_CALL_CHANNEL } from "../../../ipc/core.ts";
import { FILE_READ_CHANNEL } from "../../../ipc/files.ts";
import {
  MACHINES_CLONE_HERE_CHANNEL,
  MACHINES_OPEN_CHANNEL,
  MACHINES_THIS_READ_CHANNEL,
} from "../../../ipc/machines.ts";
import { SECRET_INPUT_OPEN_CHANNEL } from "../../../ipc/secret-input.ts";
import { TERMINAL_OPEN_CHANNEL } from "../../../ipc/terminal.ts";
import { WORKSPACE_LAYOUT_SAVE_CHANNEL } from "../../../ipc/workspace.ts";
import { createMachineRoute, type MachineLink } from "./machine-route.ts";

const HOST = "mch_01jx0000000000000000000000" as Id<"mch">;
const REMOTE_WINDOW = 7;
const LOCAL_WINDOW = 3;

type Sent = Parameters<MachineLink["call"]>[0];

function readyLink(sent: Sent[]): MachineLink {
  return {
    current: () => ({ state: "ready", confirmedAt: 1 }),
    call: (input) => {
      sent.push(input);
      return Promise.resolve({ ok: true, value: { from: "host" } });
    },
    watch: () => {},
  };
}

test("a window of another machine reaches only that machine's core; this computer's own channels refuse it", async () => {
  const route = createMachineRoute();
  const sent: Sent[] = [];
  route.bind(REMOTE_WINDOW, HOST, readyLink(sent));
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

test("only a window of another machine reaches this computer's core, and only for this computer's project, agent and session lists", async () => {
  const route = createMachineRoute();
  route.bind(REMOTE_WINDOW, HOST, readyLink([]));
  const cases: {
    channel: string;
    window: number;
    input: unknown;
    passes: boolean;
  }[] = [
    {
      channel: MACHINES_THIS_READ_CHANNEL,
      window: REMOTE_WINDOW,
      input: { route: "project.list", input: {} },
      passes: true,
    },
    {
      channel: MACHINES_THIS_READ_CHANNEL,
      window: REMOTE_WINDOW,
      input: { route: "ListSessions", input: {} },
      passes: true,
    },
    {
      channel: MACHINES_THIS_READ_CHANNEL,
      window: REMOTE_WINDOW,
      input: { route: "ListAgents", input: {} },
      passes: true,
    },
    {
      channel: MACHINES_THIS_READ_CHANNEL,
      window: REMOTE_WINDOW,
      input: { route: "project.get", input: {} },
      passes: false,
    },
    {
      channel: MACHINES_THIS_READ_CHANNEL,
      window: REMOTE_WINDOW,
      input: { route: "settings/list", input: {} },
      passes: false,
    },
    {
      channel: MACHINES_THIS_READ_CHANNEL,
      window: REMOTE_WINDOW,
      input: { input: {} },
      passes: false,
    },
    {
      channel: MACHINES_THIS_READ_CHANNEL,
      window: LOCAL_WINDOW,
      input: { route: "project.list", input: {} },
      passes: false,
    },
    {
      channel: MACHINES_CLONE_HERE_CHANNEL,
      window: REMOTE_WINDOW,
      input: { url: "u", identity: "i", title: "t" },
      passes: true,
    },
    // Opening one of this computer's sessions only brings this computer's window forward; main refuses a session for
    // another machine.
    {
      channel: MACHINES_OPEN_CHANNEL,
      window: REMOTE_WINDOW,
      input: { machine: HOST, session: "ses_01jx0000000000000000000000" },
      passes: true,
    },
    {
      channel: MACHINES_CLONE_HERE_CHANNEL,
      window: LOCAL_WINDOW,
      input: { url: "u", identity: "i", title: "t" },
      passes: false,
    },
  ];
  for (const each of cases) {
    let ran = false;
    const reply = (await route.handle(
      each.channel,
      each.window,
      each.input,
      () => {
        ran = true;
        return { ok: true, value: "this computer" };
      },
    )) as { ok: boolean; error?: { code: string } };
    const label = `${each.channel} ${JSON.stringify(each.input)} from ${each.window}`;
    assert.equal(ran, each.passes, label);
    if (!each.passes) assert.equal(reply.error?.code, "forbidden", label);
  }
});
