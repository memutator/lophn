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
import { TERMINAL_INPUT_CHANNEL } from "../../../ipc/terminal.ts";
import { WORKSPACE_LAYOUT_SAVE_CHANNEL } from "../../../ipc/workspace.ts";
import { createMachineRoute, type MachineLink } from "./machine-route.ts";

const HOST = "mch_01jx0000000000000000000000" as Id<"mch">;
const OTHER = "mch_01jy0000000000000000000000" as Id<"mch">;
const SELF = "mch_01jz0000000000000000000000" as Id<"mch">;
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

// A call that names machine A must never reach this computer or machine B: a send, an approval or a terminal key would act on
// the wrong machine.
test("a core call naming machine A reaches only A's link; one without a machine reaches only this computer; a window bound to a machine that names another reaches nothing", async () => {
  const route = createMachineRoute();
  const sent = new Map<string, Sent[]>([
    [HOST, []],
    [OTHER, []],
  ]);
  route.attach({
    link: (machine) => readyLink(sent.get(machine)!),
    self: () => SELF,
    selfKnown: Promise.resolve(),
  });
  route.bind(REMOTE_WINDOW, OTHER, readyLink(sent.get(OTHER)!));
  const local: unknown[] = [];
  const here = (input: unknown) => () => {
    local.push(input);
    return { ok: true, value: { from: "this computer" } };
  };
  const writes = [
    { kind: "memory", resource: "acp", method: "send", body: { text: "hi" } },
    {
      kind: "memory",
      resource: "turn_requests",
      method: "decide",
      body: { choice: "once" },
    },
    {
      kind: "memory",
      resource: "terminals",
      method: "input",
      body: { data: "y" },
    },
  ];

  for (const call of writes) {
    const reply = await route.handle(
      CORE_CALL_CHANNEL,
      LOCAL_WINDOW,
      { ...call, machine: HOST },
      here(call),
      () => true,
    );
    assert.deepEqual(reply, { ok: true, value: { from: "host" } });
  }
  assert.deepEqual(
    sent.get(HOST),
    writes.map(({ resource, method, body }) => ({ resource, method, body })),
  );
  assert.deepEqual(sent.get(OTHER), []);
  assert.deepEqual(local, []);

  for (const call of [writes[0]!, { ...writes[1]!, machine: SELF }]) {
    const reply = await route.handle(
      CORE_CALL_CHANNEL,
      LOCAL_WINDOW,
      call,
      here(call),
      () => true,
    );
    assert.deepEqual(reply, { ok: true, value: { from: "this computer" } });
  }
  assert.equal(local.length, 2);
  assert.equal(sent.get(HOST)!.length, 3);

  for (const machine of [HOST, SELF]) {
    const reply = (await route.handle(
      CORE_CALL_CHANNEL,
      REMOTE_WINDOW,
      { ...writes[2]!, machine },
      here(machine),
      () => true,
    )) as { ok: boolean; error?: { code: string } };
    assert.equal(reply.error?.code, "forbidden", machine);
  }
  assert.equal(local.length, 2);
  assert.equal(sent.get(HOST)!.length, 3);
  assert.deepEqual(sent.get(OTHER), []);
});

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
    () => true,
  );
  assert.deepEqual(remote, { ok: true, value: { from: "host" } });
  assert.deepEqual(sent, [{ resource: "sessions", method: "list", body: {} }]);

  for (const channel of [
    TERMINAL_INPUT_CHANNEL,
    FILE_READ_CHANNEL,
    WORKSPACE_LAYOUT_SAVE_CHANNEL,
  ]) {
    const reply = (await route.handle(
      channel,
      REMOTE_WINDOW,
      {},
      handler(channel),
      () => true,
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
    () => true,
  );
  assert.deepEqual(own, { ok: true, value: { from: "this computer" } });
  assert.deepEqual(local, [CORE_CALL_CHANNEL]);
  assert.equal(
    sent.length,
    1,
    "the host got nothing from this computer's window",
  );
});

test("only a window of another machine reads this computer's project, agent and session lists; any window clones here; a machine window may open the secret window", async () => {
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
    // The protected secret window opens over a window of another machine; its handler sends the value to that machine.
    {
      channel: SECRET_INPUT_OPEN_CHANNEL,
      window: REMOTE_WINDOW,
      input: { name: "K", purpose: "app", subject: "s" },
      passes: true,
    },
    // The list's [Clone here] calls it from this computer's window too.
    {
      channel: MACHINES_CLONE_HERE_CHANNEL,
      window: LOCAL_WINDOW,
      input: { url: "u", identity: "i", title: "t" },
      passes: true,
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
      () => true,
    )) as { ok: boolean; error?: { code: string } };
    const label = `${each.channel} ${JSON.stringify(each.input)} from ${each.window}`;
    assert.equal(ran, each.passes, label);
    if (!each.passes) assert.equal(reply.error?.code, "forbidden", label);
  }
});
