// One app view on the computer, without React Native: opens it (`app_views/open`, and again as a resume after a
// reconnect, an eviction or a call to a view the core forgot), calls the screen's operations on it, hands the guest
// the app events of this view only, and says what the core did to its binding.
import {
  type AppViewEventPayload,
  type AppViewsOpenInput,
  appViewsCall,
  appViewsClose,
  appViewsLogError,
  appViewsOpen,
} from "../../../protocol/apps/views.ts";
import type { CoreCall } from "../../../shell/ipc/core.ts";
import type { CoreSource } from "../../../shell/renderer/desktop/connection/connection.ts";
import type { EventClient } from "../../../shell/renderer/desktop/connection/events/client.ts";
import type { AppEvent, CallOutcome, GuestCall, GuestFailure } from "./guest/mod.ts";

/**
 * How long the computer may be unreachable for a view before the screen on it is started again. App events are not
 * stored or replayed (`event.md`), so a guest kept across a longer absence would show what it knew before the gap without
 * saying so, and a new guest reads the current data. A shorter gap is where a phone call, the browser or a photo picker
 * takes the person away and a lost event is unlikely to matter.
 *
 * Time spent in something this very screen opened for the person (the camera, a picker: a phone capability request that
 * shows something, `ViewLink.interactive`) is not an absence from the screen: the person did not leave it alone, and the
 * result of what they are doing has to reach it, so a long stay there does not count and returning does not start the screen
 * again. The count starts again from the return.
 */
export const STALE_AFTER_MS = 5 * 60_000;

export type ViewState =
  | { readonly kind: "opening" }
  | {
      readonly kind: "open";
      readonly release: string | null;
      readonly bundle_hash: string;
      /** Counts the times the screen must start again because the computer was away too long: part of the guest's key. */
      readonly epoch: number;
    }
  /** The app does not run on the computer (stopped, archived, gone). */
  | { readonly kind: "stopped" }
  | { readonly kind: "failed"; readonly code: string };

export interface ViewLink {
  /** Bound to this view: the guest's `call`. */
  readonly call: GuestCall;
  /** This view's app events: the guest's `subscribe`. */
  subscribe(listener: (event: AppEvent) => void): () => void;
  /** Best-effort reports a live screen failure to the computer's app log (`app_views/log_error`). */
  logError(error: { observation: GuestFailure; message: string; name?: string }): void;
  /** The phone app left the foreground: its connection may die unseen from here, so the absence counts from now. */
  background(): void;
  /** A capability request that shows something to the person (camera, picker, share sheet) of this screen opened (true) or ended (false). */
  interactive(open: boolean): void;
  /** Opens it again (Try again). */
  reopen(): void;
  /** Leaves the view: stops listening and closes it on the core without waiting. */
  close(): void;
}

// The phone's connection says `sent` on a failure of the link itself (the desktop's reply type does not name it).
type Reply = Awaited<ReturnType<CoreSource["call"]>> & { readonly sent?: boolean };

export function linkView(options: {
  client: EventClient;
  input: AppViewsOpenInput;
  onState: (state: ViewState) => void;
  now: () => number;
  /** The core bound the view again (a release went live, a grant changed): its screen list may have a new bundle. */
  onRebound: () => void;
}): ViewLink {
  const { client, input } = options;
  const core = client.core;
  const listeners = new Set<(event: AppEvent) => void>();
  let closed = false;
  let opening = 0;
  let epoch = 0;
  // Since when the computer was not reachable for this view, and whether the connection dropped since it was last up.
  // The phone leaving the foreground counts as away too, though a live socket on return shows it was not.
  let awaySince: number | null = null;
  let dropped = false;
  // How many interactive requests of this screen are open, and whether the connection was lost while one was (the absence
  // then counts from the return, not from when it began).
  let holds = 0;
  let lostWhileHeld = false;
  const away = () => {
    if (holds > 0) lostWhileHeld = true;
    else awaySince ??= options.now();
  };

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
          sent: false,
        }),
      );

  const state = (next: ViewState) => {
    if (!closed) options.onState(next);
  };

  async function open(): Promise<boolean> {
    const mine = ++opening;
    const reply = await ask(appViewsOpen, input);
    if (mine !== opening || closed) return reply.ok;
    // The link failed, not the core's answer: the next ready opens it again, and what is on screen stays.
    if (!reply.ok && reply.sent !== undefined) return false;
    if (awaySince !== null && options.now() - awaySince > STALE_AFTER_MS) epoch += 1;
    awaySince = null;
    dropped = false;
    lostWhileHeld = false;
    if (reply.ok) {
      const value = reply.value as { release: string | null; bundle_hash: string };
      state({ kind: "open", release: value.release, bundle_hash: value.bundle_hash, epoch });
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
        state({ kind: "open", release: payload.release, bundle_hash: payload.bundle_hash, epoch });
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

  // A resumed connection that answers again was never lost: nothing was missed. One that dropped is counted from when
  // the absence began, and the view is opened again on its ready.
  const stopState = core.subscribe((connection) => {
    if (connection.state === "stale") {
      dropped = true;
      away();
    } else if (connection.state === "ready" && !dropped) {
      awaySince = null;
      lostWhileHeld = false;
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
    logError(error) {
      if (closed || input.mode !== "live") return;
      const message = error.message.trim().slice(0, 16_384) || error.observation;
      const name = error.name?.trim().slice(0, 256);
      void ask(appViewsLogError, {
        view: input.view,
        observation: error.observation,
        ...(name ? { name } : {}),
        message,
      });
    },
    background() {
      away();
    },
    interactive(open) {
      if (open) {
        holds += 1;
        // An absence that began before is not counted while the person is in the camera.
        if (awaySince !== null) lostWhileHeld = true;
        awaySince = null;
        return;
      }
      holds = Math.max(0, holds - 1);
      // Back from it: if the connection was lost meanwhile, the count starts now.
      if (holds === 0 && lostWhileHeld) {
        awaySince = options.now();
        lostWhileHeld = false;
      }
    },
    reopen() {
      state({ kind: "opening" });
      void open();
    },
    close() {
      if (closed) return;
      closed = true;
      stop();
      stopState();
      listeners.clear();
      void ask(appViewsClose, { view: input.view });
    },
  };
}
