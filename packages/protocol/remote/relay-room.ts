// relay 본체: socket 층과 떨어진 잇는 logic. 폰과 core 사이 binary message를 보지 않고 그대로 넘긴다.
// 시각과 무작위는 인자로 받아 메모리 socket으로 test한다.
import type { RandomSource } from "../../base/mod.ts";
import { generateKeyPair, remoteKeyText } from "./noise.ts";
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
} from "./relay.ts";

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
  // url은 요청의 path와 query다(`/v1/host?key=…`). ip는 그 socket을 연 쪽의 주소다.
  accept(url: string, socket: RelaySocket, ip: string): void;
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
  // 넘길 수 있는 byte(token bucket). 두 방향을 같이 센다.
  allowance: number;
  checkedAt: number;
};

const NONCE_BYTES = 32;
const CONN_BYTES = 16;
// 받는 쪽이 이만큼 밀려 있으면 더 쌓지 않고 짝을 닫는다. 느린 상대가 relay의 memory를 붙잡지 못하게.
export const RELAY_BUFFER_MAX_BYTES = 1024 * 1024;
// ping을 이만큼 연달아 받지 못하면 control socket을 닫는다.
const MISSED_PINGS = RELAY_IDLE_TIMEOUT_MS / RELAY_PING_MS;
// 누구나 새 key로 host 자리를 잡고 relay를 통로로 쓸 수 있다. 한 주소가 연결 자리와 대역을 다 쓰지 못하게 한다.
// IP 하나가 동시에 여는 socket(control, 폰, data 모두).
export const RELAY_SOCKETS_PER_IP = 32;
// IP 하나가 동시에 여는 control socket. core 하나는 다시 붙는 사이 둘까지 연다.
export const RELAY_HOSTS_PER_IP = 4;
// 폰 연결 하나(두 방향 합)가 넘기는 byte: 평균 초당 이만큼, 한꺼번에는 RELAY_BURST_BYTES까지. 넘으면 그 짝을 닫는다.
// 한꺼번의 한도는 remote frame 하나(16 MiB, 큰 대화 snapshot)가 Noise record 덧붙임과 같이 지나가게 한다.
export const RELAY_BYTES_PER_SECOND = 1024 * 1024;
export const RELAY_BURST_BYTES = 17 * 1024 * 1024;
// 남용을 볼 수 있게 이 간격마다 연결 수와 넘긴 byte 합만 남긴다. IP와 key는 남기지 않는다.
const STATS_MS = 60_000;

export function createRelay(deps: {
  random: RandomSource;
  timers: RelayTimers;
  now(): number;
  log?(line: string): void;
}): Relay {
  // 증명된 control socket만 key의 자리를 갖는다.
  const hosts = new Map<string, Host>();
  const phones = new Map<string, Phone>();
  const socketsByIp = new Map<string, number>();
  const hostsByIp = new Map<string, number>();
  let forwarded = 0;

  if (deps.log) {
    const log = deps.log;
    const report = () => {
      let sockets = 0;
      for (const count of socketsByIp.values()) sockets += count;
      log(
        `relay stats: sockets=${sockets} hosts=${hosts.size} phones=${phones.size} bytes=${forwarded}`,
      );
      forwarded = 0;
      deps.timers.set(report, STATS_MS);
    };
    deps.timers.set(report, STATS_MS);
  }

  // ip의 자리 하나를 잡는다. 다 찼으면 false다. socket이 닫히면 놓는다.
  function claim(
    counts: Map<string, number>,
    ip: string,
    max: number,
    socket: RelaySocket,
  ): boolean {
    const used = counts.get(ip) ?? 0;
    if (used >= max) return false;
    counts.set(ip, used + 1);
    let held = true;
    socket.onClose(() => {
      if (!held) return;
      held = false;
      const left = (counts.get(ip) ?? 1) - 1;
      if (left === 0) counts.delete(ip);
      else counts.set(ip, left);
    });
    return true;
  }

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
    const now = deps.now();
    phone.allowance = Math.min(
      RELAY_BURST_BYTES,
      phone.allowance +
        ((now - phone.checkedAt) * RELAY_BYTES_PER_SECOND) / 1000,
    );
    phone.checkedAt = now;
    phone.allowance -= data.byteLength;
    if (phone.allowance < 0) return endPhone(phone);
    forwarded += data.byteLength;
    to.send(data);
  }

  function endHost(key: string, host: Host): void {
    if (host.closed) return;
    host.closed = true;
    if (hosts.get(key) === host) hosts.delete(key);
    host.socket.close();
    for (const phone of [...host.phones]) endPhone(phone);
  }

  function acceptHost(key: string, socket: RelaySocket, ip: string): void {
    if (!claim(hostsByIp, ip, RELAY_HOSTS_PER_IP, socket)) {
      return socket.close();
    }
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
      allowance: RELAY_BURST_BYTES,
      checkedAt: deps.now(),
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
    accept(url, socket, ip) {
      if (!claim(socketsByIp, ip, RELAY_SOCKETS_PER_IP, socket)) {
        return socket.close();
      }
      const { pathname, searchParams } = new URL(url, "http://relay");
      const key = searchParams.get("key") ?? "";
      if (pathname === RELAY_HOST_PATH) return acceptHost(key, socket, ip);
      if (pathname === RELAY_PHONE_PATH) return acceptPhone(key, socket);
      if (pathname === RELAY_DATA_PATH)
        return acceptData(searchParams.get("conn") ?? "", socket);
      socket.close();
    },
  };
}

// 인터넷의 아무나 자기 key로 증명을 시도할 수 있어서 MAC은 일정한 시간에 비교한다.
const textEncoder = new TextEncoder();
function sameText(a: string, b: string): boolean {
  const x = textEncoder.encode(a);
  const y = textEncoder.encode(b);
  if (x.byteLength !== y.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < x.byteLength; i++) diff |= x[i]! ^ y[i]!;
  return diff === 0;
}
