// The host half of one guest screen, without React Native: reads guest messages, answers `ready` with `init`, forwards
// calls and app events, and decides the guest's state. Who the guest is comes from the host (the `call` it was given is
// already bound to the host's view); nothing a message says about an app, release or view is read.
import {
  type PhoneHostMessage,
  type PhonePlace,
  parsePhoneGuestMessage,
} from "../../../../protocol/apps/phone-screen.ts";
import type { JsonValue } from "../../../../protocol/base/json-values.ts";

export type GuestFailure = "did_not_start" | "fatal" | "crashed";
export type GuestState = "starting" | "running" | { failed: GuestFailure };

// `app_views/call`'s outcome. App error codes pass through as they are.
export type CallOutcome =
  | { ok: true; value: JsonValue }
  | { ok: false; error: { code: string; message: string } };

export type GuestCall = (
  operation: string,
  input: JsonValue,
) => Promise<CallOutcome>;

export type AppEvent = { source: string; event: string; payload: JsonValue };

export type GuestInit = {
  place: PhonePlace;
  scheme: "light" | "dark";
  locale: string;
};

// What the guest runtime reports through the view's onError. The patched sandbox names a failure of the runtime itself
// (an exception before the guest could catch it, a native error) GuestCrashed and a bundle that would not load LoadError.
export type GuestError = { name: string; message: string; isFatal?: boolean };

export interface GuestSession {
  // One message from the view's onMessage (a JSON string).
  receive(raw: unknown): void;
  event(event: AppEvent): void;
  appearance(scheme: "light" | "dark"): void;
  error(error: GuestError): void;
  // No `ready` within the start limit.
  timeout(): void;
  // The view is gone: replies of calls still running are dropped.
  close(): void;
}

export function createGuestSession(options: {
  init: GuestInit;
  call: GuestCall;
  post: (message: PhoneHostMessage) => void;
  onState: (state: GuestState) => void;
  // A line for the developer when the guest fails (its fatal message, a runtime error).
  log: (line: string) => void;
}): GuestSession {
  let state: GuestState = "starting";
  let closed = false;
  let init = options.init;
  const live = () => !closed && typeof state !== "object";
  const move = (next: GuestState) => {
    if (!live()) return;
    state = next;
    options.onState(next);
  };
  const reply = (id: number, outcome: CallOutcome) => {
    if (live()) options.post({ type: "reply", id, outcome });
  };
  return {
    receive(raw) {
      if (!live() || typeof raw !== "string") return;
      const parsed = parsePhoneGuestMessage(raw);
      if (!parsed.ok) return;
      const message = parsed.value;
      switch (message.type) {
        case "ready":
          options.post({ type: "init", ...init });
          if (state === "starting") move("running");
          return;
        case "call":
          options.call(message.operation, message.input).then(
            (outcome) => reply(message.id, outcome),
            (thrown: unknown) =>
              reply(message.id, {
                ok: false,
                error: {
                  code: "internal",
                  message: thrown instanceof Error ? thrown.message : String(thrown),
                },
              }),
          );
          return;
        case "fatal":
          options.log(`fatal: ${message.message}`);
          move({ failed: "fatal" });
          return;
      }
    },
    event(event) {
      if (state === "running" && !closed) options.post({ type: "event", ...event });
    },
    appearance(scheme) {
      init = { ...init, scheme };
      if (state === "running" && !closed) options.post({ type: "appearance", scheme });
    },
    error(error) {
      options.log(`${error.name}: ${error.message}`);
      if (!error.isFatal) return;
      const crashed = error.name === "GuestCrashed" || error.name === "LoadError";
      move({ failed: crashed ? "crashed" : "fatal" });
    },
    timeout() {
      if (state === "starting") move({ failed: "did_not_start" });
    },
    close() {
      closed = true;
    },
  };
}
