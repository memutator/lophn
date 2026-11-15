// relay 본체: socket 층과 떨어진 잇는 logic. 폰과 core 사이 binary message를 보지 않고 그대로 넘긴다.
// 시각과 무작위는 인자로 받아 메모리 socket으로 test한다.
import { timingSafeEqual } from "node:crypto";
import type { RandomSource } from "../base/mod.ts";
import { generateKeyPair, remoteKeyText } from "../protocol/remote/noise.ts";
import {
  hostToRelaySchema,
  RELAY_DATA_PATH,
  RELAY_HOST_PATH,
  RELAY_IDLE_TIMEOUT_MS,
  RELAY_OPEN_TIMEOUT_MS,
  RELAY_PENDING_MESSAGES,
  RELAY_PHONE_PATH,
  RELAY_PHONES_PER_HOST,
  RELAY_PING_MS,
  type RelayToHost,
  relayProof,
} from "../protocol/remote/relay.ts";

// relay가 받은 socket 하나. 한도를 넘는 message는 socket 층이 받기 전에 끊는다(onClose로 온다).
export type RelaySocket = {
  send(data: Uint8Array | string): void;
  ping(): void;
  close(): void;
  // text message는 string으로 온다.
  onMessage(handler: (data: Uint8Array | string) => void): void;
  onPong(handler: () => void): void;
  onClose(handler: () => void): void;
  // 보내지 못하고 쌓인 byte 수.
  bufferedAmount(): number;
};

export type RelayTimers = {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

export type Relay = {
  // url은 요청의 path와 query다(`/v1/host?key=…`).
  accept(url: string, socket: RelaySocket): void;
};

type Host = {
  socket: RelaySocket;
  phones: Set<Phone>;
  closed: boolean;
};

type Phone = {
  conn: string;
  host: Host;
  socket: RelaySocket;
  data: RelaySocket | undefined;
  pending: Uint8Array[];
  timer: unknown;
  ended: boolean;
};

const NONCE_BYTES = 32;
const CONN_BYTES = 16;
// 받는 쪽이 이만큼 밀려 있으면 더 쌓지 않고 짝을 닫는다. 느린 상대가 relay의 memory를 붙잡지 못하게.
export const RELAY_BUFFER_MAX_BYTES = 1024 * 1024;
// ping을 이만큼 연달아 받지 못하면 control socket을 닫는다.
const MISSED_PINGS = RELAY_IDLE_TIMEOUT_MS / RELAY_PING_MS;

export function createRelay(deps: {
  random: RandomSource;
  timers: RelayTimers;
}): Relay {
  // 증명된 control socket만 key의 자리를 갖는다.
  const hosts = new Map<string, Host>();
  const phones = new Map<string, Phone>();

  function randomText(length: number): string {
    const bytes = new Uint8Array(length);
    deps.random.fill(bytes);
    return remoteKeyText(bytes);
  }

  function sendControl(host: Host, frame: RelayToHost): void {
    host.socket.send(JSON.stringify(frame));
  }

  function endPhone(phone: Phone): void {
    if (phone.ended) return;
    phone.ended = true;
    deps.timers.clear(phone.timer);
    phones.delete(phone.conn);
    phone.host.phones.delete(phone);
    phone.socket.close();
    phone.data?.close();
    if (!phone.host.closed)
      sendControl(phone.host, { type: "gone", conn: phone.conn });
  }

  function forward(phone: Phone, to: RelaySocket, data: Uint8Array): void {
    if (to.bufferedAmount() > RELAY_BUFFER_MAX_BYTES) return endPhone(phone);
    to.send(data);
  }

  function endHost(key: string, host: Host): void {
    if (host.closed) return;
    host.closed = true;
    if (hosts.get(key) === host) hosts.delete(key);
    host.socket.close();
    for (const phone of [...host.phones]) endPhone(phone);
  }

  function acceptHost(key: string, socket: RelaySocket): void {
    const host: Host = { socket, phones: new Set(), closed: false };
    const pair = generateKeyPair(deps.random);
    const nonce = randomText(NONCE_BYTES);
    const expected = relayProof(pair.secretKey, key, nonce);
    if (!expected) return socket.close();
    let proven = false;
    let missed = 0;
    let timer = deps.timers.set(
      () => endHost(key, host),
      RELAY_OPEN_TIMEOUT_MS,
    );
    const tick = () => {
      if (missed >= MISSED_PINGS) return endHost(key, host);
      missed++;
      socket.ping();
      timer = deps.timers.set(tick, RELAY_PING_MS);
    };
    socket.onPong(() => {
      missed = 0;
    });
    // core가 control socket에 보내는 것은 증명 하나뿐이다. 그 밖은 닫는다.
    socket.onMessage((data) => {
      if (proven || typeof data !== "string") return endHost(key, host);
      let json: unknown;
      try {
        json = JSON.parse(data);
      } catch {
        return endHost(key, host);
      }
      const proof = hostToRelaySchema.safeParse(json);
      if (!proof.success || !sameText(proof.data.mac, expected))
        return endHost(key, host);
      proven = true;
      deps.timers.clear(timer);
      const old = hosts.get(key);
      if (old) endHost(key, old);
      hosts.set(key, host);
      sendControl(host, { type: "ready" });
      timer = deps.timers.set(tick, RELAY_PING_MS);
    });
    socket.onClose(() => {
      deps.timers.clear(timer);
      endHost(key, host);
    });
    sendControl(host, {
      type: "challenge",
      relay_key: remoteKeyText(pair.publicKey),
      nonce,
    });
  }

  function acceptPhone(key: string, socket: RelaySocket): void {
    const host = hosts.get(key);
    if (!host || host.phones.size >= RELAY_PHONES_PER_HOST)
      return socket.close();
    const phone: Phone = {
      conn: randomText(CONN_BYTES),
      host,
      socket,
      data: undefined,
      pending: [],
      timer: undefined,
      ended: false,
    };
    phone.timer = deps.timers.set(() => endPhone(phone), RELAY_OPEN_TIMEOUT_MS);
    phones.set(phone.conn, phone);
    host.phones.add(phone);
    socket.onMessage((data) => {
      if (typeof data === "string") return endPhone(phone);
      if (phone.data) return forward(phone, phone.data, data);
      phone.pending.push(data);
      if (phone.pending.length > RELAY_PENDING_MESSAGES) endPhone(phone);
    });
    socket.onClose(() => endPhone(phone));
    sendControl(host, { type: "connected", conn: phone.conn });
  }

  function acceptData(conn: string, socket: RelaySocket): void {
    const phone = phones.get(conn);
    if (!phone || phone.data) return socket.close();
    phone.data = socket;
    deps.timers.clear(phone.timer);
    for (const message of phone.pending) forward(phone, socket, message);
    phone.pending = [];
    socket.onMessage((data) => {
      if (typeof data === "string") return endPhone(phone);
      forward(phone, phone.socket, data);
    });
    socket.onClose(() => endPhone(phone));
  }

  return {
    accept(url, socket) {
      const { pathname, searchParams } = new URL(url, "http://relay");
      const key = searchParams.get("key") ?? "";
      if (pathname === RELAY_HOST_PATH) return acceptHost(key, socket);
      if (pathname === RELAY_PHONE_PATH) return acceptPhone(key, socket);
      if (pathname === RELAY_DATA_PATH)
        return acceptData(searchParams.get("conn") ?? "", socket);
      socket.close();
    },
  };
}

// 인터넷의 아무나 자기 key로 증명을 시도할 수 있어서 MAC은 일정한 시간에 비교한다.
function sameText(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
