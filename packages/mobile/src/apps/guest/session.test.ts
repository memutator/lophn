import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PHONE_CALL_INPUT_MAX_BYTES,
  PHONE_MESSAGE_MAX_BYTES,
  type PhoneHostMessage,
} from "../../../../protocol/apps/phone-screen.ts";
import type { JsonValue } from "../../../../protocol/base/json-values.ts";
import { createGuestSession, type GuestState } from "./session.ts";

const init = {
  place: { place: "phone" as const, params: {}, workspace: null },
  scheme: "light" as const,
  locale: "en",
};

function setup() {
  const posted: PhoneHostMessage[] = [];
  const states: GuestState[] = [];
  // The host binds the call to its own view before it gives it to the guest screen.
  const sent: { view: string; operation: string; input: JsonValue }[] = [];
  const session = createGuestSession({
    init,
    call: async (operation, input) => {
      sent.push({ view: "view-1", operation, input });
      return { ok: true, value: operation };
    },
    post: (message) => posted.push(message),
    onState: (state) => states.push(state),
    log: () => {},
  });
  return { session, posted, states, sent };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("guest 메시지가 내세우는 앱·release·view는 신원이 아니고, 모르는 모양과 상한을 넘는 메시지는 버려지며, call은 host의 view로만 간다", async () => {
  const { session, posted, states, sent } = setup();
  const dropped = [
    // identity claims are not part of any message: the whole message is dropped
    { type: "call", id: 1, operation: "tasks.list", input: null, view: "view-2" },
    { type: "call", id: 2, operation: "tasks.list", input: null, app: "other" },
    { type: "call", id: 3, operation: "tasks.list", input: null, release: "r9" },
    { type: "ready", view: "view-2" },
    { type: "subscribe", source: "x", event: "y" },
    { type: "call", id: 4, operation: "tasks.add", input: "x".repeat(PHONE_CALL_INPUT_MAX_BYTES) },
  ];
  for (const message of dropped) session.receive(JSON.stringify(message));
  session.receive("not json");
  session.receive({ type: "ready" });
  session.receive(
    JSON.stringify({ type: "fatal", message: "x".repeat(PHONE_MESSAGE_MAX_BYTES) }),
  );
  await settle();
  assert.deepEqual(posted, []);
  assert.deepEqual(sent, []);
  assert.deepEqual(states, []);

  session.receive(JSON.stringify({ type: "ready" }));
  session.receive(JSON.stringify({ type: "ready" }));
  session.receive(
    JSON.stringify({ type: "call", id: 7, operation: "tasks.add", input: { title: "a" } }),
  );
  await settle();
  assert.deepEqual(states, ["running"]);
  assert.deepEqual(sent, [{ view: "view-1", operation: "tasks.add", input: { title: "a" } }]);
  assert.deepEqual(posted, [
    { type: "init", ...init },
    { type: "init", ...init },
    { type: "reply", id: 7, outcome: { ok: true, value: "tasks.add" } },
  ]);

  // a failed guest gets nothing more
  session.receive(JSON.stringify({ type: "fatal", message: "boom" }));
  session.receive(JSON.stringify({ type: "call", id: 8, operation: "tasks.list", input: null }));
  session.event({ source: "a", event: "b", payload: null });
  await settle();
  assert.deepEqual(states, ["running", { failed: "fatal" }]);
  assert.equal(sent.length, 1);
  assert.equal(posted.length, 3);
});
