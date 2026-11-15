// Joins the page's bridge messages to one computer's connection.
import type { CoreSource } from "../connection/connection.ts";
import type { PageMessage, ShellMessage } from "../webview/bridge.ts";

/**
 * The page can only hear us after its first message (it sends `state` at document start), so state and
 * events start flowing from that `state` request; anything earlier would be dropped by the native view.
 */
export function linkPage(
  source: CoreSource,
  send: (message: ShellMessage) => void,
): { receive(message: PageMessage): void; close(): void } {
  let stop: (() => void) | undefined;

  function listen() {
    if (stop) return;
    const offState = source.subscribe((state) => send({ type: "state", state }));
    const offEvent = source.onEvent((message) => send({ type: "event", message }));
    stop = () => {
      offState();
      offEvent();
    };
  }

  return {
    receive(message) {
      if (message.type === "state") {
        send({ type: "state", state: source.current() });
        listen();
      } else if (message.type === "watch") {
        void source.watch(message.conditions).then(() =>
          send({ type: "reply", id: message.id, reply: { ok: true } }),
        );
      } else {
        const { base64, ...call } = message.call;
        // The core takes upload bytes as `{input, base64}` (core/remote/call.ts).
        const body =
          call.kind === "upload" ? { input: call.body, base64 } : call.body;
        void source
          .call({ ...call, body })
          .then((reply) => send({ type: "reply", id: message.id, reply }));
      }
    },
    close() {
      stop?.();
      stop = undefined;
    },
  };
}
