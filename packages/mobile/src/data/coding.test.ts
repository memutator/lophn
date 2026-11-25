import assert from "node:assert/strict";
import { test } from "node:test";
import { acpSnapshot, EMPTY_ACP_STATE } from "../../../protocol/acp/mod.ts";
import { codingSessionsSwitch } from "../../../protocol/coding-agent/relay.ts";
import { createEventClient } from "../../../shell/renderer/desktop/connection/events/client.ts";
import {
  createFakeSource,
  fakeAnswer,
} from "../../../shell/renderer/desktop/connection/events/fake-source.ts";
import { codingOf } from "./coding.ts";

const SESSION = "ses_01h455vb4pex5v6nkc6gd5f001";
const PROJECT = "prj_01h455vb4pex5v6nkc6gd5f001";

test("a coding conversation coalesces live AcpUpdated bursts per frame and notifies listeners once", async () => {
  const fake = createFakeSource({
    snapshots: [],
    consents: [],
    answers: [fakeAnswer(acpSnapshot, { ...EMPTY_ACP_STATE, seq: 3 })],
  });
  const source = codingOf(createEventClient(fake)).source({
    session: SESSION,
    coding: { harness: "claude", project: PROJECT, cwd: "/work/phroner" },
  });
  let notifications = 0;
  let resolveFrame: (() => void) | null = null;
  const stop = source.changed!(() => {
    notifications += 1;
    resolveFrame?.();
    resolveFrame = null;
  });

  const first = await source.acp(SESSION);
  assert.ok(first.ok && first.value.seq === 3 && first.value.draft === null);
  notifications = 0;

  const nextFrame = new Promise<void>((resolve) => {
    resolveFrame = resolve;
  });
  fake.emitEvent({
    type: "AcpUpdated",
    session: SESSION,
    subject: null,
    at: new Date().toISOString(),
    payload: {
      session: SESSION,
      update: {
        type: "draft_set",
        key: "k1",
        content: [{ type: "text", text: "first" }],
      },
    },
  });
  fake.emitEvent({
    type: "AcpUpdated",
    session: SESSION,
    subject: null,
    at: new Date().toISOString(),
    payload: {
      session: SESSION,
      update: {
        type: "draft_set",
        key: "k2",
        content: [{ type: "text", text: "second" }],
      },
    },
  });
  // Still buffered before the frame flushes.
  assert.equal(notifications, 0);
  const before = await source.acp(SESSION);
  assert.ok(before.ok && before.value.draft === null);

  await nextFrame;
  assert.equal(notifications, 1);
  const next = await source.acp(SESSION);
  assert.ok(next.ok && next.value.draft?.key === "k2");
  stop();
});

test("StateChanged snapshot reload drops stale pending live updates before applying the new snapshot", async () => {
  let snapshotReads = 0;
  const fake = createFakeSource({
    snapshots: [],
    consents: [],
    answers: [
      fakeAnswer(acpSnapshot, () => {
        snapshotReads += 1;
        return {
          ...EMPTY_ACP_STATE,
          seq: snapshotReads === 1 ? 1 : 10,
        };
      }),
    ],
  });
  const source = codingOf(createEventClient(fake)).source({
    session: SESSION,
    coding: { harness: "claude", project: PROJECT, cwd: "/work/phroner" },
  });
  let resolveReload: (() => void) | null = null;
  const stop = source.changed!(() => {
    resolveReload?.();
    resolveReload = null;
  });

  const first = await source.acp(SESSION);
  assert.ok(first.ok && first.value.seq === 1);

  const reloaded = new Promise<void>((resolve) => {
    resolveReload = resolve;
  });
  // Queue a live update, then immediately trigger a snapshot reload before the frame fires.
  fake.emitEvent({
    type: "AcpUpdated",
    session: SESSION,
    subject: null,
    at: new Date().toISOString(),
    payload: {
      session: SESSION,
      update: {
        type: "draft_set",
        key: "stale",
        content: [{ type: "text", text: "stale" }],
      },
    },
  });
  fake.emitEvent({
    type: "StateChanged",
    subject: null,
    at: new Date().toISOString(),
    payload: {
      changes: [{ name: "coding_sessions", id: SESSION }],
    },
  });

  await reloaded;
  await new Promise((resolve) => setTimeout(resolve, 10));
  const after = await source.acp(SESSION);
  assert.ok(after.ok && after.value.seq === 10 && after.value.draft === null);
  stop();
});

test("switching a view always says the person confirmed", async () => {
  const seen: unknown[] = [];
  const fake = createFakeSource({
    snapshots: [],
    consents: [],
    answers: [
      fakeAnswer(codingSessionsSwitch, (input) => {
        seen.push(input);
        return { ok: true as const };
      }),
    ],
  });
  const stops = { turn: false, tasks: 0, queued: 1 };
  const done = await codingOf(createEventClient(fake)).switchView(SESSION, "gui", stops);
  assert.deepEqual(done, { ok: true, value: undefined });
  assert.equal(seen.length, 1);
  assert.deepEqual({ ...(seen[0] as object), key: "" }, {
    session: SESSION,
    to: "gui",
    confirmed: true,
    stops,
    key: "",
  });
  assert.ok((seen[0] as { key: string }).key.length > 0);
});
