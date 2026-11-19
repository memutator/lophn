import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventClient, EventMessage } from "../../../shell/renderer/desktop/connection/events/client.ts";
import type { AppEvent } from "./guest/mod.ts";
import { linkView } from "./view.ts";

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
    onState: () => {},
    onRebound: () => {},
  });
  preview.logError({ observation: "did_not_start", message: "preview fail" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(calls, []);
  preview.close();
});
