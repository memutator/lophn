import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PHONE_CALL_INPUT_MAX_BYTES,
  PHONE_MESSAGE_MAX_BYTES,
  type PhoneHostMessage,
} from "../../../../protocol/apps/phone-screen.ts";
import type { JsonValue } from "../../../../protocol/base/json-values.ts";
import { ok } from "../../../../base/mod.ts";
import {
  APP_FILE_SAMPLE_IMAGE as SAMPLE_IMAGE,
  APP_FILE_SAMPLE_TEXT as SAMPLE_TEXT,
} from "../../../../protocol/apps/app-file-values.ts";
import { createUpdateCoalescer } from "./coalesce.ts";
import { GUEST_BLOCKED_VIEWS, GUEST_MODULES, guestReactNative, guestSvg } from "./modules.ts";
import { createPhoneHost } from "./phone-host.ts";
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
    phone: noPhone(),
    locate: noLocate,
    post: (message) => posted.push(message),
    onState: (state) => states.push(state),
    onLocalChange: () => {},
    log: () => {},
  });
  return { session, posted, states, sent };
}

// A phone host that grants nothing and has no handler (a guest that never asks the phone).
const noPhone = () =>
  createPhoneHost({
    granted: () => [],
    standIn: false,
    isActive: () => true,
    handlers: {},
    ctx: {} as never,
    wait: () => () => {},
    dismiss: () => {},
  });

const noLocate = async () => ({ ok: false as const, error: { code: "not_found", message: "no file place in this test" } });

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
  const initMessage = { type: "init", ...init, phone: { capabilities: [], stand_in: false } };
  assert.deepEqual(posted, [
    initMessage,
    initMessage,
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
  // The SVG image draws by URI through the pipeline directly, so a guest gets neither its view nor its component.
  assert.ok(GUEST_BLOCKED_VIEWS.includes("RNSVGImage"));
  const circle = () => "circle";
  const svg = guestSvg({ Svg: 1, Circle: circle, Image: () => "image", FeImage: () => "feimage" }) as Record<string, unknown>;
  assert.equal(svg.Circle, circle);
  assert.equal(svg.Svg, 1);
  assert.equal(svg.Image, undefined);
  assert.equal(svg.FeImage, undefined);
  assert.deepEqual(Object.keys(svg), ["Svg", "Circle"]);
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
    phone: noPhone(),
    locate: noLocate,
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

// The phone host's identity is its own view and app, and the grant list is the computer's: a guest cannot talk its way to a
// capability the app was not given, and a request the host refuses never reaches the phone.
test("a phone request for a capability the app is not granted is forbidden and its handler never runs; nothing in the message names another app or adds a grant", async () => {
  const ran: string[] = [];
  const handler = (name: string, value: unknown) => async () => {
    ran.push(name);
    return ok(value);
  };
  const posted: PhoneHostMessage[] = [];
  const session = createGuestSession({
    init,
    call: async () => ({ ok: true, value: null }),
    phone: createPhoneHost({
      granted: () => ["network.get"],
      standIn: false,
      isActive: () => true,
      handlers: {
        "network.get": handler("network.get", { online: true, type: "wifi" }),
        "clipboard.read": handler("clipboard.read", { text: "secret" }),
      } as never,
      ctx: {} as never,
      wait: () => () => {},
      dismiss: () => {},
    }),
    locate: noLocate,
    post: (message) => posted.push(message),
    onState: () => {},
    onLocalChange: () => {},
    log: () => {},
  });
  session.receive(JSON.stringify({ type: "ready" }));
  const phone = (id: number, capability: string, extra: object = {}) =>
    session.receive(JSON.stringify({ type: "phone", id, capability, input: {}, ...extra }));

  phone(1, "clipboard.read");
  // a message that names an app or carries a grant is not a message
  phone(2, "clipboard.read", { app: "other" });
  phone(3, "clipboard.read", { granted: ["clipboard.read"] });
  phone(4, "clipboard.read", { grant: { capability: "clipboard.read" } });
  phone(5, "network.get");
  phone(6, "camera.take");
  await settle();

  assert.deepEqual(ran, ["network.get"]);
  assert.deepEqual(posted.slice(1), [
    {
      type: "reply",
      id: 1,
      outcome: {
        ok: false,
        error: {
          code: "forbidden",
          message: 'phone.use {"capability":"clipboard.read"} is not permitted',
          permission: "phone.use",
          scope: { capability: "clipboard.read" },
        },
      },
    },
    {
      type: "reply",
      id: 6,
      outcome: { ok: false, error: { code: "invalid_input", message: "camera.take is not a phone capability" } },
    },
    { type: "reply", id: 5, outcome: { ok: true, value: { online: true, type: "wifi" } } },
  ]);
});

// A preview has no grants; what the previewed declaration declares is usable (with stand-in values) and the rest fails as it
// will live, so the app agent catches a capability it forgot to declare.
test("in stand-in mode a declared capability answers its stand-in value and an undeclared one is forbidden, and no handler runs", async () => {
  const ran: string[] = [];
  const posted: PhoneHostMessage[] = [];
  const handler = (name: string) => async () => {
    ran.push(name);
    return ok({});
  };
  const FILE_CAPABILITIES = ["camera.capture", "photos.pick", "files.pick", "share.file"];
  const session = createGuestSession({
    init,
    call: async () => ({ ok: true, value: null }),
    phone: createPhoneHost({
      granted: () => ["network.get", "code.scan", ...FILE_CAPABILITIES.slice(0, 3)],
      standIn: true,
      // a preview is usable with the phone app in the background too
      isActive: () => false,
      handlers: Object.fromEntries(
        ["network.get", "code.scan", ...FILE_CAPABILITIES].map((name) => [name, handler(name)]),
      ) as never,
      // a handler that reached for the camera, a picker or the file place would throw on this
      ctx: {} as never,
      wait: () => () => {},
      dismiss: () => {},
    }),
    locate: noLocate,
    post: (message) => posted.push(message),
    onState: () => {},
    onLocalChange: () => {},
    log: () => {},
  });
  session.receive(JSON.stringify({ type: "ready" }));
  const asked = [
    ["network.get", {}],
    ["code.scan", {}],
    ["haptics.play", {}],
    ["camera.capture", {}],
    ["photos.pick", { max: 3 }],
    ["files.pick", { types: ["application/pdf"] }],
    ["share.file", { file: SAMPLE_IMAGE.handle }],
  ] as const;
  asked.forEach(([capability, input], at) => {
    session.receive(JSON.stringify({ type: "phone", id: at + 1, capability, input }));
  });
  await settle();

  assert.deepEqual(ran, []);
  const init0 = posted[0];
  assert.ok(init0?.type === "init" && init0.phone.stand_in);
  assert.deepEqual(init0.phone.capabilities, ["network.get", "code.scan", ...FILE_CAPABILITIES.slice(0, 3)]);
  const [one, two, three, four, five, six, seven] = posted
    .slice(1)
    .map((message) => message.type === "reply" && message.outcome);
  assert.deepEqual(one, { ok: true, value: { online: true, type: "wifi" } });
  assert.deepEqual(two, { ok: true, value: { cancelled: false, format: "qr", text: "https://example.com" } });
  assert.ok(three && !three.ok && three.error.code === "forbidden");
  assert.deepEqual(three.error.scope, { capability: "haptics.play" });
  // The files the preview answers are the samples (the computer's preview area has them), never a file of the phone.
  assert.deepEqual(four, { ok: true, value: { cancelled: false, file: SAMPLE_IMAGE.handle } });
  assert.deepEqual(five, { ok: true, value: { cancelled: false, files: [SAMPLE_IMAGE.handle] } });
  assert.deepEqual(six, { ok: true, value: { cancelled: false, files: [SAMPLE_TEXT.handle] } });
  assert.ok(seven && !seven.ok && seven.error.code === "forbidden");
  assert.deepEqual(seven.error.scope, { capability: "share.file" });
});

// The phone is read only while lophn is in front (remote.md): a guest timer cannot reach the phone from the background.
test("a phone request while the phone app is not in front is unavailable (phone_in_background) and no handler runs", async () => {
  let active = false;
  const ran: string[] = [];
  const posted: PhoneHostMessage[] = [];
  const session = createGuestSession({
    init,
    call: async () => ({ ok: true, value: null }),
    phone: createPhoneHost({
      granted: () => ["network.get"],
      standIn: false,
      isActive: () => active,
      handlers: {
        "network.get": async () => {
          ran.push("network.get");
          return ok({ online: true, type: "wifi" });
        },
      } as never,
      ctx: {} as never,
      wait: () => () => {},
      dismiss: () => {},
    }),
    locate: noLocate,
    post: (message) => posted.push(message),
    onState: () => {},
    onLocalChange: () => {},
    log: () => {},
  });
  session.receive(JSON.stringify({ type: "ready" }));
  session.receive(JSON.stringify({ type: "phone", id: 1, capability: "network.get", input: {} }));
  await settle();
  assert.deepEqual(ran, []);
  const refused = posted[1];
  assert.ok(refused?.type === "reply" && !refused.outcome.ok);
  assert.equal(refused.outcome.error.code, "unavailable");
  assert.equal(refused.outcome.error.reason, "phone_in_background");

  active = true;
  session.receive(JSON.stringify({ type: "phone", id: 2, capability: "network.get", input: {} }));
  await settle();
  assert.deepEqual(ran, ["network.get"]);
});
