// relay에 거는 core 쪽. control socket 하나를 밖으로 걸어 key를 증명하고, relay가 알린 폰 연결마다 data socket을 열어
// listener의 연결과 같은 RemoteSocket으로 넘긴다. relay는 암호문만 넘기므로 handshake와 자격은 RemoteHost가 그대로 맡는다.
import { WebSocket } from "ws";
import {
  type KeyPair,
  relayDataUrl,
  relayHostUrl,
  relayProof,
  relayToHostSchema,
  remoteKeyText,
} from "../../protocol/remote/mod.ts";
import { NOISE_MAX_MESSAGE_BYTES } from "../../protocol/remote/noise.ts";
import type { RemoteSocket, RemoteTimers } from "./host.ts";

const RETRY_FIRST_MS = 1_000;
const RETRY_MAX_MS = 30_000;
// control socket은 20초마다 ping하고 60초 동안 아무것도 오지 않으면 끊는다. 망이 조용히 끊긴 것을 알아채려고.
const PING_MS = 20_000;
const IDLE_MS = 60_000;
const CLOSE_GRACE_MS = 1_000;

export type RelaySocket = {
  send(data: string | Uint8Array): void;
  close(): void;
  onText(handler: (text: string) => void): void;
  onBinary(handler: (bytes: Uint8Array) => void): void;
  onClose(handler: () => void): void;
  bufferedAmount(): number;
};

export type RelayState = "connecting" | "connected";

export type RelayClient = {
  url: string;
  state(): RelayState;
  // control socket과 data socket을 모두 닫고 다시 걸지 않는다.
  close(): void;
};

export function startRelayClient(options: {
  url: string;
  staticKey: KeyPair;
  open(url: string): RelaySocket;
  timers: RemoteTimers;
  accept(socket: RemoteSocket): void;
}): RelayClient {
  const keyText = remoteKeyText(options.staticKey.publicKey);
  const data = new Set<RelaySocket>();
  let state: RelayState = "connecting";
  let control: RelaySocket | undefined;
  let retryMs = RETRY_FIRST_MS;
  let retry: unknown;
  let closed = false;

  function openData(conn: string) {
    const socket = options.open(relayDataUrl(options.url, conn));
    data.add(socket);
    socket.onClose(() => data.delete(socket));
    socket.onText(() => socket.close());
    options.accept({
      send: (bytes) => socket.send(bytes),
      close: () => socket.close(),
      onMessage: (handler) => socket.onBinary(handler),
      onClose: (handler) => socket.onClose(handler),
      bufferedAmount: () => socket.bufferedAmount(),
    });
  }

  function connect() {
    retry = undefined;
    state = "connecting";
    const socket = options.open(relayHostUrl(options.url, keyText));
    control = socket;
    socket.onBinary(() => socket.close());
    socket.onText((text) => {
      let frame: unknown;
      try {
        frame = JSON.parse(text);
      } catch {
        return socket.close();
      }
      const parsed = relayToHostSchema.safeParse(frame);
      if (!parsed.success) return socket.close();
      const message = parsed.data;
      if (message.type === "challenge") {
        const mac = relayProof(
          options.staticKey.secretKey,
          message.relay_key,
          message.nonce,
        );
        if (mac === undefined) return socket.close();
        socket.send(JSON.stringify({ type: "proof", mac }));
      } else if (message.type === "ready") {
        state = "connected";
        retryMs = RETRY_FIRST_MS;
      } else if (message.type === "connected") {
        openData(message.conn);
      }
      // `gone`: relay가 짝인 data socket을 닫는다. core는 할 일이 없다.
    });
    socket.onClose(() => {
      if (control !== socket) return;
      control = undefined;
      state = "connecting";
      if (closed) return;
      retry = options.timers.set(connect, retryMs);
      retryMs = Math.min(retryMs * 2, RETRY_MAX_MS);
    });
  }

  connect();
  return {
    url: options.url,
    state: () => state,
    close() {
      closed = true;
      if (retry !== undefined) options.timers.clear(retry);
      control?.close();
      control = undefined;
      for (const socket of [...data]) socket.close();
    },
  };
}

// 실제 WebSocket. message 하나는 Noise message 하나다.
export function openRelayWebSocket(url: string): RelaySocket {
  const ws = new WebSocket(url, {
    maxPayload: NOISE_MAX_MESSAGE_BYTES,
    perMessageDeflate: false,
  });
  ws.binaryType = "arraybuffer";
  ws.on("error", () => undefined);
  let idle = setTimeout(() => ws.terminate(), IDLE_MS).unref();
  const alive = () => {
    clearTimeout(idle);
    idle = setTimeout(() => ws.terminate(), IDLE_MS).unref();
  };
  ws.on("message", alive);
  ws.on("pong", alive);
  ws.on("ping", alive);
  const ping = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) ws.ping();
  }, PING_MS).unref();
  ws.on("close", () => {
    clearTimeout(idle);
    clearInterval(ping);
  });
  return {
    send(payload) {
      if (ws.readyState === WebSocket.OPEN) ws.send(payload);
    },
    // 보낸 frame(`closed` 등)을 보낼 틈을 주고 닫는다.
    close() {
      ws.close();
      setTimeout(() => ws.terminate(), CLOSE_GRACE_MS).unref();
    },
    onText(handler) {
      ws.on("message", (payload, isBinary) => {
        if (!isBinary) handler(String(payload));
      });
    },
    onBinary(handler) {
      ws.on("message", (payload, isBinary) => {
        if (isBinary) handler(new Uint8Array(payload as ArrayBuffer));
      });
    },
    onClose(handler) {
      ws.on("close", handler);
    },
    bufferedAmount: () => ws.bufferedAmount,
  };
}
