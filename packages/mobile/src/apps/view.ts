// One app view on the computer, without React Native: opens it (`app_views/open`, and again as a resume after a
// reconnect, an eviction or a call to a view the core forgot), calls the screen's operations on it, hands the guest
// the app events of this view only, and says what the core did to its binding.
import {
  type AppViewEventPayload,
  type AppViewsOpenInput,
  appViewsCall,
  appViewsClose,
  appViewsOpen,
} from "../../../protocol/apps/views.ts";
import type { CoreCall } from "../../../shell/ipc/core.ts";
import type { CoreSource } from "../../../shell/renderer/desktop/connection/connection.ts";
import type { EventClient } from "../../../shell/renderer/desktop/connection/events/client.ts";
import type { AppEvent, CallOutcome, GuestCall } from "./guest/mod.ts";

export type ViewState =
  | { readonly kind: "opening" }
  | {
      readonly kind: "open";
      readonly release: string | null;
      readonly bundle_hash: string;
    }
  /** The app does not run on the computer (stopped, archived, gone). */
  | { readonly kind: "stopped" }
  | { readonly kind: "failed"; readonly code: string };

export interface ViewLink {
  /** Bound to this view: the guest's `call`. */
  readonly call: GuestCall;
  /** This view's app events: the guest's `subscribe`. */
  subscribe(listener: (event: AppEvent) => void): () => void;
  /** Opens it again (Try again). */
  reopen(): void;
  /** Leaves the view: stops listening and closes it on the core without waiting. */
  close(): void;
}

type Reply = Awaited<ReturnType<CoreSource["call"]>>;

export function linkView(options: {
  client: EventClient;
  input: AppViewsOpenInput;
  onState: (state: ViewState) => void;
  /** The core bound the view again (a release went live, a grant changed): its screen list may have a new bundle. */
  onRebound: () => void;
}): ViewLink {
  const { client, input } = options;
  const core = client.core;
  const listeners = new Set<(event: AppEvent) => void>();
  let closed = false;
  let opening = 0;

  const ask = (
    route: { kind: CoreCall["kind"]; resource: string; method: string },
    body: unknown,
  ): Promise<Reply> =>
    core
      .call({
        kind: route.kind,
        resource: route.resource,
        method: route.method,
        body,
      })
      .catch(
        (thrown: unknown): Reply => ({
          ok: false,
          error: { code: "unavailable", message: String(thrown) },
        }),
      );

  const state = (next: ViewState) => {
    if (!closed) options.onState(next);
  };

  async function open(): Promise<boolean> {
    const mine = ++opening;
    const reply = await ask(appViewsOpen, input);
    if (mine !== opening || closed) return reply.ok;
    if (reply.ok) {
      const value = reply.value as { release: string | null; bundle_hash: string };
      state({ kind: "open", release: value.release, bundle_hash: value.bundle_hash });
      return true;
    }
    const code = reply.error?.code ?? "internal";
    // not_found: no such app; unavailable: it is not running or not available.
    state(
      code === "not_found" || code === "unavailable"
        ? { kind: "stopped" }
        : { kind: "failed", code },
    );
    return false;
  }

  function received(payload: AppViewEventPayload) {
    if (payload.view !== input.view) return;
    switch (payload.kind) {
      case "event":
        for (const listener of [...listeners]) {
          listener({ source: payload.source, event: payload.event, payload: payload.payload });
        }
        return;
      case "rebound":
        state({ kind: "open", release: payload.release, bundle_hash: payload.bundle_hash });
        options.onRebound();
        return;
      case "lost":
        if (payload.reason === "app_stopped" || payload.reason === "app_archived") {
          state({ kind: "stopped" });
        } else {
          void open();
        }
        return;
    }
  }

  // The first ready opens the view; a ready after a drop is the connection back, and the view is opened again (the core
  // drops a device's views when its connection closes).
  const stop = client.subscribe({ types: ["AppViewEvent"] }, (message) => {
    if (message.kind === "ready") void open();
    else if (message.kind === "event" && message.event.type === "AppViewEvent") {
      received(message.event.payload as AppViewEventPayload);
    }
  });

  async function call(operation: string, value: unknown): Promise<CallOutcome> {
    const body = { view: input.view, operation, input: value };
    let reply = await ask(appViewsCall, body);
    if (!reply.ok && reply.error?.code === "not_found" && (await open())) {
      reply = await ask(appViewsCall, body);
    }
    if (reply.ok) return (reply.value as { outcome: CallOutcome }).outcome;
    return {
      ok: false,
      error: { code: "unavailable", message: reply.error?.message ?? "the computer did not answer" },
    };
  }

  return {
    call: (operation, value) => call(operation, value),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    reopen() {
      state({ kind: "opening" });
      void open();
    },
    close() {
      if (closed) return;
      closed = true;
      stop();
      listeners.clear();
      void ask(appViewsClose, { view: input.view });
    },
  };
}
