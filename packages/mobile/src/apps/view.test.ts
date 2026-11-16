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
