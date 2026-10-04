import { asInternalError } from "../../base/mod.ts";
import {
  type AuthenticatedContext,
  EVENT_SUBSCRIBE_SUBPROTOCOL,
  parseClientEventFrame,
} from "../../contracts/platform/mod.ts";
import {
  createEventSession,
  type EventBackend,
  type EventSession,
  type EventSink,
} from "../ledger/mod.ts";
import type { SubscriptionStore } from "../ledger/mod.ts";
import { errorBody, failure } from "./request.ts";

export type SocketDeps = {
  backend: EventBackend;
  store?: SubscriptionStore;
};

// upgrade는 GET /v1/events/subscribe, subprotocol lophn.events.1만 받는다.
// Host·Origin·Bearer는 HTTP와 같은 gate를 이미 통과한 뒤다.
export function acceptSocket(
  request: Request,
): { ok: true; response: Response; socket: WebSocket } | {
  ok: false;
  status: number;
  body: unknown;
} {
  if (request.method !== "GET") {
    const error = failure({
      code: "invalid_input",
      message: "method not allowed",
    });
    return { ok: false, status: error.status, body: errorBody(error.error) };
  }
  const offered = request.headers.get("sec-websocket-protocol");
  if (
    offered !== null && !offered.split(",").map((part) => part.trim()).includes(
      EVENT_SUBSCRIBE_SUBPROTOCOL,
    )
  ) {
    const error = failure({
      code: "invalid_input",
      message: "subprotocol not allowed",
    });
    return { ok: false, status: error.status, body: errorBody(error.error) };
  }
  const upgrade = Deno.upgradeWebSocket(request, {
    protocol: offered === null ? undefined : EVENT_SUBSCRIBE_SUBPROTOCOL,
  });
  return { ok: true, response: upgrade.response, socket: upgrade.socket };
}

export function attachSession(
  socket: WebSocket,
  ctx: AuthenticatedContext,
  deps: SocketDeps,
): void {
  let session: EventSession | undefined;
  const sink: EventSink = {
    send: (text) => {
      if (socket.readyState !== WebSocket.OPEN) {
        return Promise.reject(new Error("socket closed"));
      }
      socket.send(text);
      return Promise.resolve();
    },
    close: (code) => {
      try {
        socket.close(code);
      } catch { /* already closed */ }
    },
  };
  socket.onmessage = (event) => {
    void onMessage(String(event.data));
  };
  socket.onclose = () => {
    session?.close();
  };
  socket.onerror = () => {
    session?.close();
  };

  async function onMessage(text: string) {
    try {
      const frame = parseClientEventFrame(text);
      if (!frame.ok) {
        sink.close(1008);
        return;
      }
      if (frame.value.type === "subscribe") {
        if (session) {
          sink.close(1008);
          return;
        }
        const opened = await createEventSession(
          ctx,
          frame.value,
          deps.backend,
          sink,
          deps.store,
        );
        if (!opened.ok) {
          try {
            socket.send(JSON.stringify({
              type: "unavailable",
              message: opened.error.message,
            }));
          } catch { /* close follows */ }
          sink.close(opened.error.code === "unauthorized" ? 1008 : 1013);
          return;
        }
        session = opened.value;
        return;
      }
      if (!session) {
        sink.close(1008);
        return;
      }
      const acked = await session.ack(ctx, frame.value);
      if (!acked.ok) {
        try {
          socket.send(JSON.stringify({
            type: "unavailable",
            message: acked.error.message,
          }));
        } catch { /* close follows */ }
        sink.close(1011);
      }
    } catch (thrown) {
      asInternalError(thrown);
      sink.close(1011);
    }
  }
}
