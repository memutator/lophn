import assert from "node:assert/strict";
import { test } from "node:test";

import type { Id } from "../../../../protocol/base/ids.ts";
import { CORE_CALL_CHANNEL } from "../../../ipc/core.ts";
import { createMachineRoute, type MachineLink } from "./machine-route.ts";

const HOST = "mch_01jx0000000000000000000000" as Id<"mch">;
const OTHER = "mch_01jy0000000000000000000000" as Id<"mch">;
const SELF = "mch_01jz0000000000000000000000" as Id<"mch">;
const LOCAL_WINDOW = 3;

type Sent = Parameters<MachineLink["call"]>[0];

function readyLink(sent: Sent[]): MachineLink {
  return {
    call: (input) => {
      sent.push(input);
      return Promise.resolve({ ok: true, value: { from: "host" } });
    },
    watch: () => {},
  };
}

// A call that names machine A must never reach this computer or machine B: a send, an approval or a terminal key would act on
// the wrong machine.
test("a core call naming machine A reaches only A's link; one without a machine or naming this computer reaches only this computer", async () => {
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
  assert.deepEqual(sent.get(OTHER), []);
});
