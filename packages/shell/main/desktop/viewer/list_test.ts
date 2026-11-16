import assert from "node:assert/strict";
import { test } from "node:test";

import type { Id } from "../../../../protocol/base/ids.ts";
import type { Computer } from "../../../../remote-client/mod.ts";
import { afterRemove, machineList, startMachine } from "./list.ts";
import type { Saved } from "./store.ts";

const HERE = "mch_01hzzzzzzzzzzzzzzzzzzzzzzz" as Id<"mch">;
const HOST = "mch_01jzzzzzzzzzzzzzzzzzzzzzzz" as Id<"mch">;
const LAPTOP = "mch_01kzzzzzzzzzzzzzzzzzzzzzzz" as Id<"mch">;

const computer = (machine: Id<"mch">, revoked = false): Computer => ({
  addresses: ["10.0.0.1"],
  port: 47432,
  key: machine,
  machine,
  device: "dev_01hzzzzzzzzzzzzzzzzzzzzzzz",
  revoked,
});

const startOf = (saved: Saved) =>
  startMachine(
    machineList({
      state: "ready",
      self: { id: HERE, name: "here" },
      saved,
      items: [],
    }),
  );

test("the start machine falls back to the last used one, then to this machine; removing the start machine resets start to last", () => {
  const both: Saved = {
    computers: [computer(HOST), computer(LAPTOP)],
    start: { mode: "machine", machine: HOST },
    last: LAPTOP,
    seen: {},
  };
  assert.equal(startOf(both), HOST);

  // The chosen machine removed this desktop: the last used one.
  assert.equal(
    startOf({ ...both, computers: [computer(HOST, true), computer(LAPTOP)] }),
    LAPTOP,
  );
  // The chosen machine left the list and the last used one removed this desktop: this machine.
  assert.equal(startOf({ ...both, computers: [computer(LAPTOP, true)] }), HERE);

  // Removing the start machine: start goes back to "last used"; removing the last used one makes it this machine.
  const removed = afterRemove(
    { ...both, last: HOST, seen: { [HOST]: "2026-11-16T00:00:00.000Z" } },
    HOST,
    HERE,
  );
  assert.deepEqual(removed.start, { mode: "last" });
  assert.equal(removed.last, HERE);
  assert.deepEqual(removed.seen, {});
  assert.equal(startOf({ ...removed, computers: [computer(LAPTOP)] }), HERE);

  // Not known before this machine's id is.
  assert.equal(
    startMachine(
      machineList({ state: "starting", self: null, saved: both, items: [] }),
    ),
    null,
  );
});
