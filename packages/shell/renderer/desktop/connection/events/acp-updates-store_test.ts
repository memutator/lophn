import assert from "node:assert/strict";
import { test } from "node:test";

import type { AcpUpdate } from "../../../../../protocol/acp/mod.ts";
import type { BusEvent } from "../../../../../protocol/events/mod.ts";
import {
  createAcpUpdatesStore,
  type Pacer,
  STREAM_PUBLISH_MS,
} from "./acp-updates-store.ts";
import type { EventClient, EventMessage } from "./client.ts";

const SES = "ses_01h455vb4pex5v6nkc6gd5fd01";

function createHarness() {
  let time = 1000;
  const timers: { at: number; run: () => void }[] = [];
  const frames: { run: () => void }[] = [];
  const pacer: Pacer = {
    now: () => time,
    after(ms, run) {
      const timer = { at: time + ms, run };
      timers.push(timer);
      return () => {
        const index = timers.indexOf(timer);
        if (index >= 0) timers.splice(index, 1);
      };
    },
    frame(run) {
      const entry = { run };
      frames.push(entry);
      return () => {
        const index = frames.indexOf(entry);
        if (index >= 0) frames.splice(index, 1);
      };
    },
  };
  let send: (message: EventMessage) => void = () => {};
  const client = {
    subscribe: (_condition, onMessage) => {
      send = onMessage;
      return () => {};
    },
  } as EventClient;
  const store = createAcpUpdatesStore(client, pacer);
  let notifications = 0;
  store.subscribe(() => {
    notifications += 1;
  });
  store.open(SES);
  notifications = 0;
  const emit = (update: AcpUpdate) =>
    send({
      kind: "event",
      event: {
        type: "AcpUpdated",
        session: SES,
        payload: { session: SES, update },
      } as unknown as BusEvent,
    });
  const delta = (offset: number): AcpUpdate => ({
    type: "writing_streamed",
    turn: "trn_1",
    model_call: "mcl_1",
    kind: "text",
    offset,
    text: "a",
    at: "2026-11-05T09:00:00.000Z",
  });
  return {
    store,
    timers,
    frames,
    send: (msg: EventMessage) => send(msg),
    emit,
    delta,
    seen: () => store.get().get(SES)!,
    advance: (ms: number) => {
      time += ms;
    },
    flushFrame: () => {
      time += 16;
      const next = frames.shift();
      assert.ok(next, "expected a scheduled frame");
      next.run();
    },
    notifications: () => notifications,
    resetNotifications: () => {
      notifications = 0;
    },
  };
}

test("stream deltas respect STREAM_PUBLISH_MS and non-streamed updates coalesce on a frame boundary in order", () => {
  const h = createHarness();

  // Leading-edge streamed burst coalesces onto a single frame.
  h.emit(h.delta(0));
  assert.equal(h.seen().count, 0);
  assert.equal(h.frames.length, 1);
  h.flushFrame();
  assert.equal(h.seen().count, 1);
  assert.equal(h.notifications(), 1);

  // Subsequent deltas inside STREAM_PUBLISH_MS are held on the stream timer.
  h.resetNotifications();
  h.emit(h.delta(1));
  h.emit(h.delta(2));
  assert.equal(h.seen().count, 1);
  assert.equal(h.timers.length, 1);
  assert.equal(h.frames.length, 0);
  h.advance(STREAM_PUBLISH_MS);
  h.timers.shift()!.run();
  assert.equal(h.seen().count, 3);
  assert.equal(h.notifications(), 1);

  // A non-streamed burst upgrades the held stream timer to a single frame flush.
  h.resetNotifications();
  h.emit(h.delta(3));
  assert.equal(h.timers.length, 1);
  h.emit({ type: "tool_call_started" } as unknown as AcpUpdate);
  h.emit({ type: "tool_call_updated" } as unknown as AcpUpdate);
  h.emit({ type: "turn_ended" } as unknown as AcpUpdate);
  assert.equal(h.timers.length, 0);
  assert.equal(h.frames.length, 1);
  assert.equal(h.seen().count, 3);
  assert.equal(h.notifications(), 0);

  h.flushFrame();
  assert.equal(h.seen().count, 7);
  assert.equal(h.notifications(), 1);
  assert.deepEqual(
    h
      .seen()
      .since(3)
      .map((update) => update.type),
    [
      "writing_streamed",
      "tool_call_started",
      "tool_call_updated",
      "turn_ended",
    ],
  );
  assert.equal(h.timers.length, 0);
  assert.equal(h.frames.length, 0);
});

test("ready cancels pending frame batch and drops stale buffered updates", () => {
  const h = createHarness();

  h.emit({ type: "tool_call_started" } as unknown as AcpUpdate);
  h.emit({ type: "tool_call_updated" } as unknown as AcpUpdate);
  assert.equal(h.frames.length, 1);
  assert.equal(h.seen().count, 0);

  h.send({ kind: "ready" });
  assert.equal(h.frames.length, 0);
  assert.equal(h.seen().status, "live");
  assert.equal(h.seen().synced, 1);
  assert.equal(h.seen().count, 2);
  assert.deepEqual(h.seen().since(0), []);
});
