// 폰·다른 컴퓨터가 붙는 WebSocket listener. 모든 interface의 port 하나에서:
// - `/remote`: 직접 Noise WebSocket(binary message만).
// - `/v1/host`, `/v1/phone`, `/v1/data`: `remote.hub`가 켜져 relay가 붙어 있을 때만 hub relay로 accept한다.
// 지금 API listener(loopback)와 따로 연다.
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import {
  RELAY_DATA_PATH,
  RELAY_HOST_PATH,
  RELAY_PHONE_PATH,
  REMOTE_PATH,
  type Relay,
} from "../../protocol/remote/mod.ts";
import { NOISE_MAX_MESSAGE_BYTES } from "../../protocol/remote/noise.ts";
import type { RemoteSocket } from "./host.ts";

const CLOSE_GRACE_MS = 1_000;

export type RemoteListener = {
  port: number;
  readonly hub?: boolean;
  setRelay?(relay: Relay | undefined): void;
  close(): Promise<void>;
};

export function describeRemoteListenerError(
  port: number,
  thrown: unknown,
): string {
  const code = (thrown as NodeJS.ErrnoException | null)?.code;
  if (code === "EADDRINUSE") {
    return `the remote port ${port} is in use by another program; change remote.port`;
  }
  if (code === "EACCES" || code === "EPERM") {
    return `permission denied opening remote port ${port}; change remote.port`;
  }
  const detail = thrown instanceof Error ? thrown.message : String(thrown);
  return `failed to open remote port ${port}: ${detail}`;
}

function isRelayPath(pathname: string): boolean {
  return (
    pathname === RELAY_HOST_PATH ||
    pathname === RELAY_PHONE_PATH ||
    pathname === RELAY_DATA_PATH
  );
}

export function openRemoteListener(options: {
  port: number;
  accept(socket: RemoteSocket): void;
  relay?: Relay;
}): Promise<RemoteListener> {
  return new Promise((resolve, reject) => {
    let currentRelay: Relay | undefined = options.relay;
    const relayClients = new Set<WebSocket>();
    const httpServer = createServer((_req, res) => {
      res.statusCode = 404;
      res.end();
    });
    const wss = new WebSocketServer({
      noServer: true,
      // Noise message 하나가 WebSocket message 하나다. 그보다 큰 것은 ws가 받기 전에 끊는다.
      maxPayload: NOISE_MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
    });

    function acceptDirect(ws: WebSocket) {
      ws.binaryType = "arraybuffer";
      ws.on("error", () => undefined);
      options.accept({
        send(bytes) {
          if (ws.readyState === WebSocket.OPEN) ws.send(bytes);
        },
        // 보낸 frame(`closed` 등)을 보낼 틈을 주고 닫는다. 답 없는 상대(handshake를 하지 않는 socket)는 1초 뒤 끊는다.
        close() {
          ws.close();
          setTimeout(() => ws.terminate(), CLOSE_GRACE_MS).unref();
        },
        onMessage(handler) {
          ws.on("message", (data, isBinary) => {
            if (!isBinary) return ws.terminate();
            handler(new Uint8Array(data as ArrayBuffer));
          });
        },
        onClose(handler) {
          ws.on("close", handler);
        },
        bufferedAmount: () => ws.bufferedAmount,
      });
    }

    function acceptRelay(relay: Relay, ws: WebSocket, req: IncomingMessage) {
      ws.binaryType = "arraybuffer";
      ws.on("error", () => undefined);
      relayClients.add(ws);
      ws.on("close", () => relayClients.delete(ws));
      const forwarded = req.headers["fly-client-ip"];
      const ip =
        (typeof forwarded === "string" ? forwarded : undefined) ??
        req.socket.remoteAddress ??
        "";
      relay.accept(
        req.url ?? "",
        {
          send(data) {
            if (ws.readyState === WebSocket.OPEN) ws.send(data);
          },
          ping() {
            if (ws.readyState === WebSocket.OPEN) ws.ping();
          },
          close() {
            ws.close();
            setTimeout(() => ws.terminate(), CLOSE_GRACE_MS).unref();
          },
          onMessage(handler) {
            ws.on("message", (data, isBinary) => {
              if (!isBinary) return handler(String(data));
              handler(new Uint8Array(data as ArrayBuffer));
            });
          },
          onPong(handler) {
            ws.on("pong", handler);
          },
          onClose(handler) {
            ws.on("close", handler);
          },
          bufferedAmount: () => ws.bufferedAmount,
        },
        ip,
      );
    }

    httpServer.on("upgrade", (req, socket, head) => {
      let pathname = "";
      try {
        pathname = new URL(req.url ?? "", "http://lophn").pathname;
      } catch {
        socket.destroy();
        return;
      }
      if (pathname === REMOTE_PATH) {
        wss.handleUpgrade(req, socket, head, acceptDirect);
        return;
      }
      if (currentRelay !== undefined && isRelayPath(pathname)) {
        const relay = currentRelay;
        wss.handleUpgrade(req, socket, head, (ws) =>
          acceptRelay(relay, ws, req),
        );
        return;
      }
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
    });

    httpServer.once("error", reject);
    httpServer.once("listening", () => {
      httpServer.off("error", reject);
      httpServer.on("error", () => undefined);
      const boundPort = (httpServer.address() as AddressInfo).port;
      resolve({
        port: boundPort,
        get hub() {
          return currentRelay !== undefined;
        },
        setRelay(next) {
          if (currentRelay === next) return;
          currentRelay = next;
          for (const client of [...relayClients]) client.terminate();
          relayClients.clear();
        },
        close: () =>
          new Promise((done) => {
            currentRelay = undefined;
            for (const client of wss.clients) client.terminate();
            relayClients.clear();
            wss.close(() => {
              httpServer.close(() => done());
            });
          }),
      });
    });
    httpServer.listen(options.port);
  });
}
