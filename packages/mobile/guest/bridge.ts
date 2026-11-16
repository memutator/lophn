// Guest side of the bridge over the sandbox's globalThis.postMessage / setOnMessage. The host is trusted: its messages
// are read as they come. `lophnApp` is the same shape as the desktop's (PhoneLophnApp) so @lophn/app-ui-native's hooks
// run unchanged.
import {
  PHONE_CALL_INPUT_MAX_BYTES,
  type PhoneGuestMessage,
  type PhoneHostMessage,
  type PhoneLophnApp,
} from "../../protocol/apps/phone-screen.ts";

type Init = Extract<PhoneHostMessage, { type: "init" }>;

const sandbox = globalThis as unknown as {
  postMessage: (message: PhoneGuestMessage) => void;
  setOnMessage: (listener: (message: PhoneHostMessage) => void) => void;
  lophnApp?: PhoneLophnApp;
};

export interface Bridge {
  send(message: PhoneGuestMessage): void;
  fatal(error: unknown): void;
  // Called on every init and appearance message; `init` is the last init.
  watch(listener: (init: Init) => void): () => void;
}

const describe = (error: unknown) =>
  (error instanceof Error ? (error.stack ?? `${error.name}: ${error.message}`) : String(error)).slice(0, 2000);

export function installBridge(): Bridge {
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const subscribers = new Set<{ source: string; event: string; listener: (payload: unknown) => void }>();
  const watchers = new Set<(init: Init) => void>();
  let last: Init | undefined;
  let nextId = 1;
  const send = (message: PhoneGuestMessage) => sandbox.postMessage(message);
  const update = (init: Init) => {
    last = init;
    if (sandbox.lophnApp) sandbox.lophnApp.place = init.place;
    for (const watcher of watchers) watcher(init);
  };

  sandbox.setOnMessage((message) => {
    switch (message.type) {
      case "init":
        update(message);
        return;
      case "appearance":
        if (last) update({ ...last, scheme: message.scheme });
        return;
      case "reply": {
        const call = pending.get(message.id);
        pending.delete(message.id);
        if (!call) return;
        if (message.outcome.ok) call.resolve(message.outcome.value);
        else call.reject(new Error(`${message.outcome.error.code}: ${message.outcome.error.message}`));
        return;
      }
      case "event":
        for (const s of subscribers) {
          if (s.source === message.source && s.event === message.event) s.listener(message.payload);
        }
        return;
    }
  });

  sandbox.lophnApp = {
    place: { place: "phone", params: {}, workspace: null },
    callOperation(operation, input) {
      const value = input === undefined ? null : input;
      let text: string;
      try {
        text = JSON.stringify(value);
      } catch {
        return Promise.reject(new Error("invalid_input: the input is not JSON"));
      }
      if (new TextEncoder().encode(text).byteLength > PHONE_CALL_INPUT_MAX_BYTES) {
        return Promise.reject(new Error("invalid_input: call input is over 64 KiB"));
      }
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        send({ type: "call", id, operation, input: JSON.parse(text) });
      });
    },
    events: {
      subscribe(source, event, listener) {
        const entry = { source, event, listener };
        subscribers.add(entry);
        return () => {
          subscribers.delete(entry);
        };
      },
    },
  };

  return {
    send,
    fatal: (error) => send({ type: "fatal", message: describe(error) }),
    watch(listener) {
      watchers.add(listener);
      if (last) listener(last);
      return () => {
        watchers.delete(listener);
      };
    },
  };
}
