import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PHONE_CALL_INPUT_MAX_BYTES,
  PHONE_MESSAGE_MAX_BYTES,
  type PhoneHostMessage,
} from "../../../../protocol/apps/phone-screen.ts";
import type { JsonValue } from "../../../../protocol/base/json-values.ts";
import { createUpdateCoalescer } from "./coalesce.ts";
import { GUEST_BLOCKED_VIEWS, GUEST_MODULES, guestReactNative } from "./modules.ts";
import { createGuestSession, type GuestState } from "./session.ts";

const init = {
  place: { place: "phone" as const, params: {}, workspace: null },
  scheme: "light" as const,
  locale: "en",
  local: null,
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
    onLocalChange: () => {},
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
  assert.deepEqual(states, ["running", { failed: "fatal", message: "boom" }]);
  assert.equal(sent.length, 1);
  assert.equal(posted.length, 3);
});

test("guestReactNative omits Modal without triggering lazy react-native getters", () => {
  let networkTouched = false;
  const fakeView = () => null;
  const fakeModal = () => null;
  const rn = {
    View: fakeView,
    get Modal() {
      return fakeModal;
    },
    get Networking() {
      networkTouched = true;
      throw new Error("network module is not available in a guest");
    },
  };
  const wrapped = guestReactNative(rn);

  assert.equal(wrapped.View, fakeView);
  assert.equal(wrapped.Modal, undefined);
  assert.equal("Modal" in wrapped, false);
  assert.equal(Object.getOwnPropertyDescriptor(wrapped, "Modal"), undefined);
  assert.deepEqual(Object.keys(wrapped), ["View", "Networking"]);
  assert.equal(networkTouched, false);
  assert.ok(GUEST_BLOCKED_VIEWS.includes("RCTModalHostView"));
  assert.equal(GUEST_MODULES.includes("StatusBarManager"), false);
  assert.equal(GUEST_MODULES.includes("Networking"), false);
});

test("createUpdateCoalescer commits first mount immediately, coalesces rapid release bursts, and cancels on unmount", () => {
  const committed: string[] = [];
  const timers = new Map<number, { fn: () => void; ms: number; cleared: boolean }>();
  let nextId = 1;
  const coalescer = createUpdateCoalescer<string>({
    delayMs: 300,
    onCommit: (value) => committed.push(value),
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, ms, cleared: false });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimer: (handle) => {
      const timer = timers.get(handle as unknown as number);
      if (timer) timer.cleared = true;
    },
  });

  // Initial mount applies immediately with no timer.
  coalescer.push("rel_1");
  assert.deepEqual(committed, ["rel_1"]);
  assert.equal(timers.size, 0);

  // Rapid consecutive release updates coalesce into a single remount of the latest release.
  coalescer.push("rel_2");
  coalescer.push("rel_3");
  coalescer.push("rel_4");
  assert.deepEqual(committed, ["rel_1"]);
  assert.equal(timers.get(1)?.cleared, true);
  assert.equal(timers.get(2)?.cleared, true);
  assert.equal(timers.get(3)?.cleared, false);
  timers.get(3)!.fn();
  assert.deepEqual(committed, ["rel_1", "rel_4"]);

  // Reverting back to the committed release before settle cancels without remounting.
  coalescer.push("rel_5");
  coalescer.push("rel_4");
  assert.equal(timers.get(4)?.cleared, true);
  assert.deepEqual(committed, ["rel_1", "rel_4"]);

  // Unmount cancels pending updates; reset allows an immediate remount (e.g. Retry).
  coalescer.push("rel_6");
  coalescer.cancel();
  assert.equal(timers.get(5)?.cleared, true);
  coalescer.reset();
  coalescer.push("rel_6");
  assert.deepEqual(committed, ["rel_1", "rel_4", "rel_6"]);
});

test("closing a guest session drops late replies from in-flight calls and ignores later events", async () => {
  let resolveCall!: (outcome: { ok: true; value: JsonValue }) => void;
  const posted: PhoneHostMessage[] = [];
  const session = createGuestSession({
    init,
    call: () =>
      new Promise((resolve) => {
        resolveCall = resolve;
      }),
    post: (message) => posted.push(message),
    onState: () => {},
    onLocalChange: () => {},
    log: () => {},
  });
  session.receive(JSON.stringify({ type: "ready" }));
  session.receive(JSON.stringify({ type: "call", id: 1, operation: "slow", input: null }));
  assert.equal(posted.length, 1);

  session.close();
  resolveCall({ ok: true, value: "late" });
  session.event({ source: "a", event: "b", payload: null });
  session.appearance("dark");
  await settle();
  assert.equal(posted.length, 1);
});
