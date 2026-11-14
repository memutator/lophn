// 폰이 붙는 WebSocket listener. 모든 interface의 port 하나, path `/remote`, binary message만 받는다.
// 지금 API listener(loopback)와 따로 연다. 연결마다 전송 하나를 RemoteHost에 넘긴다.
import { WebSocket, WebSocketServer } from "ws";
import { REMOTE_PATH } from "../../protocol/remote/mod.ts";
import { NOISE_MAX_MESSAGE_BYTES } from "../../protocol/remote/noise.ts";
import type { RemoteSocket } from "./host.ts";

const CLOSE_GRACE_MS = 1_000;

export type RemoteListener = {
  port: number;
  close(): Promise<void>;
};

export function openRemoteListener(options: {
  port: number;
  accept(socket: RemoteSocket): void;
}): Promise<RemoteListener> {
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({
      port: options.port,
      path: REMOTE_PATH,
      // Noise message 하나가 WebSocket message 하나다. 그보다 큰 것은 ws가 받기 전에 끊는다.
      maxPayload: NOISE_MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
    });
    server.once("error", reject);
    server.once("listening", () => {
      server.off("error", reject);
      server.on("error", () => undefined);
      resolve({
        port: options.port,
        close: () =>
          new Promise((done) => {
            for (const client of server.clients) client.terminate();
            server.close(() => done());
          }),
      });
    });
    server.on("connection", (ws) => {
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
    });
  });
}
