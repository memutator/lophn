import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventClient, EventMessage } from "../../../shell/renderer/desktop/connection/events/client.ts";
import type { AppEvent } from "./guest/mod.ts";
import { linkView, STALE_AFTER_MS, type ViewState } from "./view.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5f001";

test("a view's app events go to its guest only; another view's AppViewEvent is dropped", async () => {
  let deliver: (message: EventMessage) => void = () => {};
  const client = {
    core: {
      subscribe: () => () => {},
      call: async () => ({
        ok: true,
        value: { view: "view-mine-1", release: null, bundle_hash: "a".repeat(64), process_nonce: "n", params: null },
      }),
    },
    subscribe: (_condition: unknown, onMessage: (message: EventMessage) => void) => {
      deliver = onMessage;
      return () => {};
    },
  } as unknown as EventClient;
  const rebound: string[] = [];
  const link = linkView({
    client,
    input: { view: "view-mine-1", mode: "live", app: APP, release: null, screen: "orders", place: "phone", params: {} },
    now: () => 0,
    onState: () => {},
    onRebound: () => rebound.push("rebound"),
  });
  const got: AppEvent[] = [];
  link.subscribe((event) => got.push(event));

  const event = (view: string, kind: "event" | "rebound") =>
    deliver({
      kind: "event",
      event: {
        type: "AppViewEvent",
        subject: APP,
        at: new Date().toISOString(),
        payload:
          kind === "event"
            ? { owner: "dev", view, kind, source: "orders", event: "changed", payload: { n: view } }
            : { owner: "dev", view, kind, release: null, bundle_hash: "b".repeat(64), process_nonce: "m" },
      },
    } as EventMessage);
  event("view-other-1", "event");
  event("view-other-1", "rebound");
  event("view-mine-1", "event");
  event("view-mine-1", "rebound");

  assert.deepEqual(got, [{ source: "orders", event: "changed", payload: { n: "view-mine-1" } }]);
  assert.deepEqual(rebound, ["rebound"]);
  link.close();
});

test("logError sends app_views/log_error for live views and skips preview and closed views", async () => {
  const calls: { resource: string; method: string; body: unknown }[] = [];
  const client = {
    core: {
      subscribe: () => () => {},
      call: async (req: { resource: string; method: string; body: unknown }) => {
        calls.push(req);
        if (req.method === "log_error") throw new Error("offline");
        return {
          ok: true,
          value: { view: "view-live-1", release: null, bundle_hash: "a".repeat(64), process_nonce: "n", params: null },
        };
      },
    },
    subscribe: () => () => {},
  } as unknown as EventClient;

  const live = linkView({
    client,
    input: { view: "view-live-1", mode: "live", app: APP, release: null, screen: "orders", place: "phone", params: {} },
    now: () => 0,
    onState: () => {},
    onRebound: () => {},
  });
  live.logError({ observation: "crashed", name: "GuestCrashed", message: "boom" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, [
    {
      kind: "memory",
      resource: "app_views",
      method: "log_error",
      body: { view: "view-live-1", observation: "crashed", name: "GuestCrashed", message: "boom" },
    },
  ]);

  live.close();
  calls.length = 0;
  live.logError({ observation: "fatal", message: "after close" });

  const preview = linkView({
    client,
    input: { view: "view-prev-1", mode: "preview", app: APP, release: null, screen: "orders", place: "phone", params: {} },
    now: () => 0,
    onState: () => {},
    onRebound: () => {},
  });
  preview.logError({ observation: "did_not_start", message: "preview fail" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, []);
  preview.close();
});

const MINUTE = 60_000;

// A client whose connection the test drives: `connection` moves the state the link watches, `ready` is the event client's
// ready message, `clock` is the time the link reads.
function drivable(reply: () => unknown) {
  let deliver: (message: EventMessage) => void = () => {};
  let watch: (state: { state: string }) => void = () => {};
  const client = {
    core: {
      subscribe: (listener: typeof watch) => {
        watch = listener;
        return () => {};
      },
      call: async () => reply(),
    },
    subscribe: (_condition: unknown, onMessage: (message: EventMessage) => void) => {
      deliver = onMessage;
      return () => {};
    },
  } as unknown as EventClient;
  const clock = { at: 0 };
  const states: ViewState[] = [];
  const link = linkView({
    client,
    input: { view: "view-mine-1", mode: "live", app: APP, release: null, screen: "orders", place: "phone", params: {} },
    now: () => clock.at,
    onState: (next) => states.push(next),
    onRebound: () => {},
  });
  return {
    link,
    clock,
    states,
    connection: (state: "ready" | "stale") => watch({ state }),
    ready: async () => {
      deliver({ kind: "ready" });
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

const opened = () => ({
  ok: true,
  value: { view: "view-mine-1", release: null, bundle_hash: "a".repeat(64), process_nonce: "n", params: null },
});
const epochOf = (states: ViewState[]) => {
  const last = states.at(-1);
  return last?.kind === "open" ? last.epoch : null;
};

test("a screen starts again only after the computer was unreachable for longer than the limit", async () => {
  const h = drivable(opened);
  await h.ready();
  assert.equal(epochOf(h.states), 0);

  // The connection dropped and came back inside the limit.
  h.connection("stale");
  h.clock.at += STALE_AFTER_MS - MINUTE;
  h.connection("ready");
  await h.ready();
  assert.equal(epochOf(h.states), 0);

  // The phone went to the background and the connection answered again when it was back: it was never lost.
  h.link.background();
  h.clock.at += 20 * MINUTE;
  h.connection("ready");
  h.connection("stale");
  h.clock.at += MINUTE;
  h.connection("ready");
  await h.ready();
  assert.equal(epochOf(h.states), 0);

  // The phone went to the background, its socket was found dead on return, past the limit.
  h.link.background();
  h.clock.at += STALE_AFTER_MS + 1;
  h.connection("stale");
  h.connection("ready");
  await h.ready();
  assert.equal(epochOf(h.states), 1);
  h.link.close();
});

// The camera and the pickers are other activities: the phone app is in the background, its connection dies and a long stay
// there must not start the screen again, or the photo reaches a screen that is no longer there.
test("a stay in an interactive request of the screen does not make it stale; the count starts again from the return", async () => {
  const h = drivable(opened);
  await h.ready();

  // In the camera past the limit; the connection is found dead on return and the result comes back first.
  h.link.interactive(true);
  h.link.background();
  h.connection("stale");
  h.clock.at += STALE_AFTER_MS + MINUTE;
  h.link.interactive(false);
  h.connection("ready");
  await h.ready();
  assert.equal(epochOf(h.states), 0);

  // The connection is back first, then the result.
  h.link.interactive(true);
  h.link.background();
  h.connection("stale");
  h.clock.at += STALE_AFTER_MS + MINUTE;
  h.connection("ready");
  await h.ready();
  h.link.interactive(false);
  assert.equal(epochOf(h.states), 0);

  // Back from the camera with the connection still dead: the absence counts from the return.
  h.link.interactive(true);
  h.connection("stale");
  h.clock.at += STALE_AFTER_MS + MINUTE;
  h.link.interactive(false);
  h.clock.at += STALE_AFTER_MS + 1;
  h.connection("ready");
  await h.ready();
  assert.equal(epochOf(h.states), 1);

  // The same absence with no request of the screen open is stale, as before.
  h.link.background();
  h.clock.at += STALE_AFTER_MS + 1;
  h.connection("stale");
  h.connection("ready");
  await h.ready();
  assert.equal(epochOf(h.states), 2);
  h.link.close();
});

test("a call made while the computer is not reachable answers unavailable", async () => {
  const h = drivable(() => ({ ok: false, error: { code: "unavailable", message: "not connected" }, sent: false }));
  const outcome = await h.link.call("list_orders", {});
  assert.deepEqual(outcome, { ok: false, error: { code: "unavailable", message: "not connected" } });
  // The link failed, not the core's answer about the app: the view is not taken as stopped.
  await h.ready();
  assert.deepEqual(h.states, []);
  h.link.close();
});
