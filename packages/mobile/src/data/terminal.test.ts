import assert from "node:assert/strict";
import { test } from "node:test";
import {
  terminalViewSnapshot,
  terminalViewWatch,
} from "../../../protocol/coding-agent/terminal-view.ts";
import { terminalsInput } from "../../../protocol/coding-agent/terminals.ts";
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

test("retrying failed terminal input reuses the same key until it succeeds, then mints a new key", async () => {
  const sent: { text: string; key: string | undefined }[] = [];
  let failNext = true;
  const fake = createFakeSource({
    snapshots: [],
    consents: [],
    answers: [
      fakeAnswer(terminalViewWatch, () => ({})),
      fakeAnswer(terminalViewSnapshot, () => screen(1)),
      fakeAnswer(terminalsInput, (input) => {
        sent.push({ text: input.text, key: input.key });
        return {};
      }),
    ],
  });
  const baseClient = createEventClient(fake);
  const client = {
    ...baseClient,
    core: {
      ...baseClient.core,
      async call(req: Parameters<typeof baseClient.core.call>[0]) {
        if (req.resource === "terminals" && req.method === "input" && failNext) {
          const body = req.body as { text: string; key?: string };
          sent.push({ text: body.text, key: body.key });
          return { ok: false as const, error: { code: "unavailable", message: "lost reply" } };
        }
        return baseClient.core.call(req);
      },
    },
  };
  const feed = terminalFeed(client, TERMINAL, () => () => {}, () => {});
  await settle();

  // First attempt fails (reply lost after disconnect); retry sends the exact same key.
  const first = await feed.send("git push\n");
  assert.equal(first.ok, false);
  failNext = false;
  const retry = await feed.send("git push\n");
  assert.equal(retry.ok, true);
  assert.equal(sent.length, 2);
  assert.ok(sent[0]!.key);
  assert.equal(sent[1]!.key, sent[0]!.key);

  // After success, sending the same text again is a new logical input with a fresh key.
  const second = await feed.send("git push\n");
  assert.equal(second.ok, true);
  assert.equal(sent.length, 3);
  assert.notEqual(sent[2]!.key, sent[0]!.key);

  // After a failed attempt, sending different text mints a fresh key.
  failNext = true;
  assert.equal((await feed.send("rm -rf tmp\n")).ok, false);
  failNext = false;
  assert.equal((await feed.send("ls\n")).ok, true);
  assert.equal(sent.length, 5);
  assert.notEqual(sent[4]!.key, sent[3]!.key);

  feed.stop();
});
