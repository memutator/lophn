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

test("stream deltas are published on a timer and any other update flushes them in order", () => {
  let time = 1000;
  const timers: { at: number; run: () => void }[] = [];
  const pacer: Pacer = {
    now: () => time,
    after(ms, run) {
      const timer = { at: time + ms, run };
      timers.push(timer);
      return () => void timers.splice(timers.indexOf(timer), 1);
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
  store.open(SES);
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
  const seen = () => store.get().get(SES)!;

  emit(delta(0)); // leading edge: published at once
  assert.equal(seen().count, 1);
  emit(delta(1));
  emit(delta(2)); // inside the window: held
  assert.equal(seen().count, 1);
  time += STREAM_PUBLISH_MS;
  timers.shift()!.run();
  assert.equal(seen().count, 3);

  emit(delta(3));
  emit({ type: "turn_ended" } as unknown as AcpUpdate); // not a delta: flushes the held one too
  assert.equal(seen().count, 5);
  assert.deepEqual(
    seen()
      .since(3)
      .map((update) => update.type),
    ["writing_streamed", "turn_ended"],
  );
  assert.equal(timers.length, 0);
});
