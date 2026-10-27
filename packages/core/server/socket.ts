// Gateway WebSocket. upgrade 요청은 adapter의 upgrade callback으로 오고 fetch handler는 거치지 않는다.
import { Buffer } from "node:buffer";
import { type IncomingMessage, STATUS_CODES } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
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
import { errorBody, failure, type RequestFailure } from "./request.ts";

export type SocketDeps = {
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
export function acceptSocket(
  request: IncomingMessage,
): { ok: true } | { ok: false; failure: RequestFailure } {
  if (request.method !== "GET") {
    return {
      ok: false,
      failure: failure({
        code: "invalid_input",
        message: "method not allowed",
      }),
    };
  }
  const offered = request.headers["sec-websocket-protocol"];
  const protocols = Array.isArray(offered) ? offered.join(",") : offered;
  if (
    protocols === undefined ||
    !protocols
      .split(",")
      .map((part) => part.trim())
      .includes(GATEWAY_SUBPROTOCOL)
  ) {
    return {
      ok: false,
      failure: failure({
        code: "invalid_input",
        message: "subprotocol not allowed",
      }),
    };
  }
  return { ok: true };
}

// upgrade를 ws server로 넘기고, node의 server.close()가 끝나려면 남은 연결을 끊는다.
export type GatewayUpgrade = {
  accept(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    ctx: AuthenticatedContext,
    deps: SocketDeps,
  ): void;
  shutdown(): void;
};

export function createGatewayUpgrade(): GatewayUpgrade {
  const server = new WebSocketServer({
    noServer: true,
    // acceptSocket이 이미 같은 subprotocol을 확인했다.
    handleProtocols: () => GATEWAY_SUBPROTOCOL,
  });
  return {
    accept(request, socket, head, ctx, deps) {
      // handshake가 실패하면 ws는 ws 객체 없이 socket을 버린다. 연결 자리는 socket이 닫힐 때 돌려준다.
      socket.once("close", () => deps.onClose?.());
      server.handleUpgrade(request, socket, head, (ws) => {
        attachSession(ws, ctx, deps);
      });
    },
    shutdown() {
      // upgraded socket은 server.close()가 닫지 않는다.
      for (const client of [...server.clients]) client.terminate();
    },
  };
}

// upgrade를 받지 않는다. HTTP handler와 같은 오류 body를 raw socket에 쓴다.
export function refuseSocket(socket: Duplex, reason: RequestFailure): void {
  // gate를 기다리는 사이 client가 끊었을 수 있다. 늦은 write 오류로 process가 죽지 않게.
  socket.on("error", () => {});
  const body = JSON.stringify(errorBody(reason.error));
  socket.write(
    `HTTP/1.1 ${reason.status} ${STATUS_CODES[reason.status] ?? ""}\r\n` +
      "content-type: application/json\r\n" +
      `content-length: ${Buffer.byteLength(body)}\r\n` +
      "connection: close\r\n\r\n" +
      body,
  );
  socket.destroy();
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
  socket.on("message", (data) => {
    try {
      session.receive(String(data));
    } catch (thrown) {
      asInternalError(thrown);
      socket.close(1011);
    }
  });
  socket.on("close", finish);
  socket.on("error", finish);
}
