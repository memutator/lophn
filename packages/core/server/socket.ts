import { asInternalError } from "../../base/mod.ts";
import {
  type AuthenticatedContext,
  EVENT_SUBSCRIBE_SUBPROTOCOL,
  parseClientEventFrame,
} from "../../protocol/platform/mod.ts";
import {
  createEventSession,
  type EventBackend,
  type EventSession,
  type EventSink,
} from "../storage/ledger/mod.ts";
import type { SubscriptionStore } from "../storage/ledger/mod.ts";
import { errorBody, failure } from "./request.ts";

export type SocketDeps = {
  backend: EventBackend;
  store?: SubscriptionStore;
  // 연결이 끝날 때 부르는 hook. admission의 연결 자리를 돌려준다.
  onClose?: () => void;
  // 열린 session을 event dispatcher에 올려 구독 뒤 새로 확정된 event를 따라잡게 한다.
  // 돌려받은 함수로 뺀다. 연결이 닫히면 이 모듈이 부른다(session을 남기지 않는다).
  track?: (session: EventSession) => () => void;
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
  let untrack: (() => void) | undefined;
  let ended = false;
  // 닫힘·오류는 session을 끝내고 dispatcher에서 빼며 연결 자리를 한 번만 돌려준다.
  function finish() {
    if (ended) return;
    ended = true;
    untrack?.();
    untrack = undefined;
    session?.close();
    deps.onClose?.();
  }
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
  socket.onclose = finish;
  socket.onerror = finish;

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
        // 열리는 동안 연결이 닫혔으면 session을 dispatcher에 올리지 않고 끝낸다.
        if (ended) {
          session.close();
          return;
        }
        untrack = deps.track?.(session);
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
