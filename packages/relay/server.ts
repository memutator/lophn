// relay의 WebSocket 층. socket을 RelaySocket으로 감싸 relay 본체에 넘긴다.
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";
import { NOISE_MAX_MESSAGE_BYTES } from "../protocol/remote/noise.ts";
import type { Relay } from "./relay.ts";

const CLOSE_GRACE_MS = 1_000;

export type RelayServer = {
  port: number;
};

export function openRelayServer(options: {
  host: string;
  port: number;
  relay: Relay;
}): Promise<RelayServer> {
  return new Promise((resolve, reject) => {
    const server = new WebSocketServer({
      host: options.host,
      port: options.port,
      // Noise message 하나가 WebSocket message 하나다. 그보다 큰 것은 ws가 받기 전에 끊고, relay는 그 짝을 닫는다.
      maxPayload: NOISE_MAX_MESSAGE_BYTES,
      perMessageDeflate: false,
    });
    server.once("error", reject);
    server.once("listening", () => {
      server.off("error", reject);
      server.on("error", () => undefined);
      resolve({
        // port 0이면 OS가 고른 port다.
        port: (server.address() as AddressInfo).port,
      });
    });
    server.on("connection", (ws, request) => {
      ws.binaryType = "arraybuffer";
      ws.on("error", () => undefined);
      options.relay.accept(request.url ?? "", {
        send(data) {
          if (ws.readyState === WebSocket.OPEN) ws.send(data);
        },
        ping() {
          if (ws.readyState === WebSocket.OPEN) ws.ping();
        },
        // 짝에서 넘긴 message를 보낼 틈을 주고 닫는다. 답 없는 상대는 1초 뒤 끊는다.
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
      });
    });
  });
}
