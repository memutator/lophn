import assert from "node:assert/strict";
import { test } from "node:test";
import {
  terminalViewSnapshot,
  terminalViewWatch,
} from "../../../protocol/coding-agent/terminal-view.ts";
import { createEventClient } from "../../../shell/renderer/desktop/connection/events/client.ts";
import {
  createFakeSource,
  fakeAnswer,
} from "../../../shell/renderer/desktop/connection/events/fake-source.ts";
import {
  type Every,
  LEASE_EVERY_MS,
  type TerminalSnapshot,
  type TerminalState,
  terminalFeed,
} from "./terminal.ts";

const TERMINAL = "trm_01h455vb4pex5v6nkc6gd5f001";

function screen(seq: number): TerminalSnapshot {
  return {
    terminal: TERMINAL,
    generation: 1,
    seq,
    columns: 80,
    rows: 2,
    cursor: { x: 0, y: 0, hidden: false },
    scrollback: [],
    lines: [{ runs: [{ text: `screen ${seq}` }], wrapped: false }],
    input: false,
  };
}

function setup() {
  const watches: { on: boolean }[] = [];
  let reads = 0;
  const fake = createFakeSource({
    snapshots: [],
    consents: [],
    answers: [
      fakeAnswer(terminalViewWatch, (input) => {
        watches.push({ on: input.on });
        return {};
      }),
      fakeAnswer(terminalViewSnapshot, () => screen(++reads)),
    ],
  });
  const timers: { ms: number; run: () => void; cancelled: boolean }[] = [];
  const every: Every = (ms, run) => {
    const timer = { ms, run, cancelled: false };
    timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  };
  const states: TerminalState[] = [];
  const feed = terminalFeed(createEventClient(fake), TERMINAL, every, (state) =>
    states.push(state),
  );
  return { fake, feed, watches, timers, states, reads: () => reads };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("watching a terminal takes the lease, renews it every 10 seconds, and drops it when closed", async () => {
  const { feed, watches, timers, states } = setup();
  await settle();
  assert.deepEqual(watches, [{ on: true }]);
  assert.equal(states.at(-1)?.screen?.seq, 1);

  assert.equal(timers.length, 1);
  assert.equal(timers[0]!.ms, LEASE_EVERY_MS);
  timers[0]!.run();
  await settle();
  assert.deepEqual(watches, [{ on: true }, { on: true }]);

  feed.stop();
  await settle();
  assert.deepEqual(watches, [{ on: true }, { on: true }, { on: false }]);
  assert.equal(timers[0]!.cancelled, true);
});

test("changes that arrive while a snapshot is read make one more read, and other terminals' changes none", async () => {
  const { fake, feed, reads, states } = setup();
  await settle();
  assert.equal(reads(), 1);

  const changed = (terminal: string, seq: number) =>
    fake.emitEvent({
      type: "TerminalScreenChanged",
      subject: `terminal:${terminal}`,
      at: new Date().toISOString(),
      payload: { terminal, seq },
    });
  changed(TERMINAL, 2);
  changed(TERMINAL, 3);
  changed(TERMINAL, 4);
  changed("trm_01h455vb4pex5v6nkc6gd5f002", 9);
  await settle();
  assert.equal(reads(), 3);
  assert.equal(states.at(-1)?.screen?.seq, 3);
  feed.stop();
});
