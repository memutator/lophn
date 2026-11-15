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

test("a coding conversation is the snapshot with the updates after it folded in", async () => {
  const fake = createFakeSource({
    snapshots: [],
    consents: [],
    answers: [fakeAnswer(acpSnapshot, { ...EMPTY_ACP_STATE, seq: 3 })],
  });
  const source = codingOf(createEventClient(fake)).source({
    session: SESSION,
    coding: { harness: "claude", project: PROJECT, cwd: "/work/phroner" },
  });
  const stop = source.changed!(() => {});

  const first = await source.acp(SESSION);
  assert.ok(first.ok && first.value.seq === 3 && first.value.draft === null);

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
        content: [{ type: "text", text: "hello" }],
      },
    },
  });
  const next = await source.acp(SESSION);
  assert.ok(next.ok && next.value.draft?.key === "k1");
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
  const done = await codingOf(createEventClient(fake)).switchView(SESSION, "gui");
  assert.deepEqual(done, { ok: true, value: undefined });
  assert.equal(seen.length, 1);
  assert.deepEqual({ ...(seen[0] as object), key: "" }, {
    session: SESSION,
    to: "gui",
    confirmed: true,
    key: "",
  });
  assert.ok((seen[0] as { key: string }).key.length > 0);
});
