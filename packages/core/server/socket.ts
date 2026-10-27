import { asInternalError } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import {
  GATEWAY_ACTORS,
  GATEWAY_SUBPROTOCOL,
} from "../../protocol/events/mod.ts";
import {
  type Bus,
  createGatewaySession,
  type GatewayFrames,
} from "../events/mod.ts";
import { errorBody, failure } from "./request.ts";

type SocketDeps = {
  bus: Bus;
  // Bus 밖 frame을 보낼 연결 목록. 연결 동안 session을 올린다.
  frames?: GatewayFrames;
  // 연결이 끝날 때 부르는 hook. admission의 연결 자리를 돌려준다.
  onClose?: () => void;
};

// 연결 자격은 upgrade 전에 한 번 본다. 연결 중 회수는 보지 않는다.
export function gatewayAllowed(ctx: AuthenticatedContext): boolean {
  return (GATEWAY_ACTORS as readonly string[]).includes(ctx.actor);
}

// upgrade는 GET /gateway, subprotocol lophn.gateway.1만 받는다.
// Host·Origin·Bearer는 HTTP와 같은 gate를 이미 통과한 뒤다.
export function acceptSocket(request: Request):
  | { ok: true; response: Response; socket: WebSocket }
  | {
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
    offered === null ||
    !offered
      .split(",")
      .map((part) => part.trim())
      .includes(GATEWAY_SUBPROTOCOL)
  ) {
    const error = failure({
      code: "invalid_input",
      message: "subprotocol not allowed",
    });
    return { ok: false, status: error.status, body: errorBody(error.error) };
  }
  const upgrade = Deno.upgradeWebSocket(request, {
    protocol: GATEWAY_SUBPROTOCOL,
  });
  return { ok: true, response: upgrade.response, socket: upgrade.socket };
}

export function attachSession(
  socket: WebSocket,
  _ctx: AuthenticatedContext,
  deps: SocketDeps,
): void {
  const session = createGatewaySession(
    {
      send: (text) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(text);
      },
      close: (code) => {
        try {
          socket.close(code);
        } catch {
          /* already closed */
        }
      },
      bufferedAmount: () => socket.bufferedAmount,
    },
    deps.bus,
  );
  const remove = deps.frames?.add(session);
  let ended = false;
  // 닫힘·오류는 구독을 풀고 연결 자리를 한 번만 돌려준다.
  function finish() {
    if (ended) return;
    ended = true;
    remove?.();
    session.closed();
    deps.onClose?.();
  }
  socket.onmessage = (event) => {
    try {
      session.receive(String(event.data));
    } catch (thrown) {
      asInternalError(thrown);
      socket.close(1011);
    }
  };
  socket.onclose = finish;
  socket.onerror = finish;
}
