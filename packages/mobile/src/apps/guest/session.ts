// The host half of one guest screen, without React Native: reads guest messages, answers `ready` with `init`, forwards
// calls and app events, answers phone capability requests (`phone-host.ts`), passes on `local_change`, and decides the
// guest's state. Who the guest is comes from the host
// (the `call` it was given is already bound to the host's view); nothing a message says about an app, release or view
// is read.
import {
  type PhoneHostMessage,
  type PhoneLocal,
  type PhonePlace,
  type PhoneReplyError,
  parsePhoneGuestMessage,
} from "../../../../protocol/apps/phone-screen.ts";
import type { JsonValue } from "../../../../protocol/base/json-values.ts";
import type { PhoneHost } from "./phone-host.ts";

export type GuestFailure = "did_not_start" | "fatal" | "crashed";
export type GuestState =
  | "starting"
  | "running"
  | { failed: GuestFailure; message?: string; name?: string };

// `app_views/call`'s outcome. App error codes pass through as they are. A phone capability's failure may also say why
// (`reason`) and, for a missing grant, which one (`permission`, `scope`).
export type CallOutcome =
  | { ok: true; value: JsonValue }
  | { ok: false; error: PhoneReplyError };

export type GuestCall = (
  operation: string,
  input: JsonValue,
) => Promise<CallOutcome>;

export type AppEvent = { source: string; event: string; payload: JsonValue };

// What `init` says besides the capabilities, which the phone host decides when it answers.
export type GuestInit = {
  place: PhonePlace;
  scheme: "light" | "dark";
  locale: string;
  // The app's backend runs in this guest (an app that runs on the phone); null sends every call to the host.
  local: PhoneLocal | null;
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

// What the host does for `lophnApp.files.locate`: the URI of a file in this guest's place, or why not (the codes of the
// place's errors pass through).
export type GuestLocate = (
  file: string,
) => Promise<{ ok: true; value: { uri: string } } | { ok: false; error: { code: string; message: string } }>;

export function createGuestSession(options: {
  init: GuestInit;
  call: GuestCall;
  phone: PhoneHost;
  locate: GuestLocate;
  post: (message: PhoneHostMessage) => void;
  onState: (state: GuestState) => void;
  // A local call in the guest committed a change (it is in the outbox).
  onLocalChange: () => void;
  // A line for the developer when the guest fails (its fatal message, a runtime error).
  log: (line: string) => void;
}): GuestSession {
  let state: GuestState = "starting";
  let closed = false;
  let init = options.init;
  // Cleared on close so in-flight call promises cannot retain the unmounted GuestScreen's callbacks or refs.
  let liveOptions: typeof options | null = options;
  const live = () => !closed && liveOptions !== null && typeof state !== "object";
  const move = (next: GuestState) => {
    if (!live()) return;
    state = next;
    liveOptions!.onState(next);
  };
  const reply = (id: number, outcome: CallOutcome) => {
    if (live()) liveOptions!.post({ type: "reply", id, outcome });
  };
  return {
    receive(raw) {
      if (!live() || typeof raw !== "string") return;
      const parsed = parsePhoneGuestMessage(raw);
      if (!parsed.ok) return;
      const message = parsed.value;
      const current = liveOptions!;
      switch (message.type) {
        case "ready":
          current.post({
            type: "init",
            ...init,
            phone: { capabilities: current.phone.capabilities(), stand_in: current.phone.standIn },
          });
          if (state === "starting") move("running");
          return;
        case "call":
          current.call(message.operation, message.input).then(
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
        case "phone":
          current.phone.request(message.capability, message.input).then(
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
        case "locate":
          current.locate(message.file).then(
            (located) =>
              reply(
                message.id,
                located.ok ? { ok: true, value: located.value } : { ok: false, error: located.error },
              ),
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
        case "local_change":
          current.onLocalChange();
          return;
        case "fatal":
          current.log(`fatal: ${message.message}`);
          move({ failed: "fatal", message: message.message });
          return;
      }
    },
    event(event) {
      if (state === "running" && !closed && liveOptions !== null) {
        liveOptions.post({ type: "event", ...event });
      }
    },
    appearance(scheme) {
      init = { ...init, scheme };
      if (state === "running" && !closed && liveOptions !== null) {
        liveOptions.post({ type: "appearance", scheme });
      }
    },
    error(error) {
      liveOptions?.log(`${error.name}: ${error.message}`);
      if (!error.isFatal) return;
      const crashed = error.name === "GuestCrashed" || error.name === "LoadError";
      move({
        failed: crashed ? "crashed" : "fatal",
        name: error.name,
        message: error.message,
      });
    },
    timeout() {
      if (state === "starting") {
        move({
          failed: "did_not_start",
          message: "guest screen did not start before timeout",
        });
      }
    },
    close() {
      closed = true;
      liveOptions?.phone.close();
      liveOptions = null;
    },
  };
}
