// 개발 build 전용 bridge. phone 껍데기가 할 일(remote protocol로 core에 붙기, 다시 붙기, `watch` 다시 보내기)을 browser에서
// 같은 protocol code로 해서 phone 없이 화면을 실제 core로 본다. key는 localStorage에 둔다(개발용이다).
import { cryptoRandom } from "../../../../base/random.ts";
import {
  connectRemote,
  generateKeyPair,
  type KeyPair,
  REMOTE_PATH,
  type RemoteClientChannel,
  type RemoteTransport,
  remoteKeyBytes,
  remoteKeyText,
  remotePairingSchema,
} from "../../../../protocol/remote/client.ts";
import type { CoreEventMessage, CoreWatch } from "../../../ipc/core.ts";
import type { CoreReply } from "../../../ipc/core-api.ts";
import type {
  ConnectionState,
  CoreSource,
} from "../../desktop/connection/connection.ts";

export interface DevPairing {
  readonly addresses: readonly string[];
  readonly port: number;
  /** core의 공개 key. */
  readonly key: string;
  /** 이 browser(기기)의 비밀 key. */
  readonly secret_key: string;
}

const STORAGE_KEY = "lophn.remote.dev-pairing";
const RETRY_MS = 2000;

export function storedPairing(): DevPairing | null {
  const text = localStorage.getItem(STORAGE_KEY);
  return text === null ? null : (JSON.parse(text) as DevPairing);
}

function socket(url: string): Promise<RemoteTransport> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.binaryType = "arraybuffer";
    const handlers = { message: (_: Uint8Array) => {}, close: () => {} };
    ws.onmessage = (event) =>
      handlers.message(new Uint8Array(event.data as ArrayBuffer));
    ws.onclose = () => handlers.close();
    ws.onerror = () => reject(new Error(`cannot connect to ${url}`));
    ws.onopen = () =>
      resolve({
        send: (bytes) => ws.send(bytes as Uint8Array<ArrayBuffer>),
        close: () => ws.close(),
        onMessage: (fn) => {
          handlers.message = fn;
        },
        onClose: (fn) => {
          handlers.close = fn;
        },
      });
  });
}

// QR의 주소를 차례로 붙어 본다. 하나도 handshake가 서지 않으면 null이다.
async function open(
  pairing: DevPairing,
  me: KeyPair,
): Promise<RemoteClientChannel | null> {
  const remoteStatic = remoteKeyBytes(pairing.key);
  if (!remoteStatic) return null;
  for (const address of pairing.addresses) {
    const host = address.includes(":") ? `[${address}]` : address;
    const transport = await socket(
      `ws://${host}:${pairing.port}${REMOTE_PATH}`,
    ).catch(() => undefined);
    if (!transport) continue;
    const channel = await connectRemote({
      transport,
      staticKey: me,
      remoteStatic,
      capabilities: [],
      random: cryptoRandom,
    });
    if (channel.ok) return channel.value;
  }
  return null;
}

function keyPairOf(pairing: DevPairing): KeyPair {
  const secret = remoteKeyBytes(pairing.secret_key)!;
  return generateKeyPair({ fill: (out) => out.set(secret) });
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)));

/** QR 내용으로 pairing하고 localStorage에 남긴다. 실패하면 이유를 던진다. */
export async function pairDev(text: string): Promise<DevPairing> {
  const qr = remotePairingSchema.parse(JSON.parse(text));
  const me = generateKeyPair(cryptoRandom);
  const pairing: DevPairing = {
    addresses: qr.addresses,
    port: qr.port,
    key: qr.key,
    secret_key: remoteKeyText(me.secretKey),
  };
  const channel = await open(pairing, me);
  if (!channel) throw new Error("no address answered");
  const answer = new Promise<CoreReply>((resolve) => {
    channel.onClose(() =>
      resolve({ ok: false, error: { code: "unavailable", message: "closed" } }),
    );
    channel.onFrame((frame) => {
      if (frame.type === "result" && frame.id === "pair") resolve(frame);
    });
  });
  channel.send({
    type: "pair",
    id: "pair",
    code: qr.code,
    name: "Browser",
    os: "android",
    width: clamp(innerWidth, 200, 2000),
    height: clamp(innerHeight, 200, 3000),
    dpr: Math.min(4, Math.max(1, devicePixelRatio)),
  });
  const done = await answer;
  channel.close();
  if (!done.ok) throw new Error(done.error?.message ?? "pairing failed");
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pairing));
  return pairing;
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (char) => char.charCodeAt(0));
}

/**
 * remote 연결 하나를 `CoreSource`로 보인다. 끊기면 stale로 알리고 다시 붙어 마지막 `watch`를 다시 보낸다(core가 ready로 답한다).
 * desktop의 byte route 모양을 맞춘다: upload는 `{input, base64}`로 싣고 file 답 `{content_type, base64}`는 `{bytes, contentType}`로 푼다.
 */
export function devBridge(pairing: DevPairing): CoreSource {
  const me = keyPairOf(pairing);
  let state: ConnectionState = { state: "starting", confirmedAt: null };
  let channel: RemoteClientChannel | null = null;
  let conditions: CoreWatch["conditions"] | null = null;
  let next = 0;
  const pending = new Map<string, (reply: CoreReply) => void>();
  const states = new Set<(state: ConnectionState) => void>();
  const events = new Set<(message: CoreEventMessage) => void>();

  function set(value: ConnectionState) {
    state = value;
    for (const listener of [...states]) listener(value);
  }

  function emit(message: CoreEventMessage) {
    for (const listener of [...events]) listener(message);
  }

  async function connect() {
    const opened = await open(pairing, me);
    if (!opened) {
      setTimeout(connect, RETRY_MS);
      return;
    }
    channel = opened;
    opened.onFrame((frame) => {
      if (frame.type === "result") {
        const resolve = pending.get(frame.id);
        pending.delete(frame.id);
        resolve?.(
          frame.ok
            ? { ok: true, value: frame.value }
            : { ok: false, error: frame.error },
        );
      } else if (frame.type === "ready") emit({ kind: "ready" });
      else if (frame.type === "event") {
        emit({ kind: "event", event: frame.event });
      } else if (frame.type === "closed") {
        emit({ kind: "closed", reason: frame.reason });
      }
    });
    opened.onClose(() => {
      channel = null;
      for (const resolve of pending.values()) {
        resolve({
          ok: false,
          error: { code: "unavailable", message: "connection closed" },
        });
      }
      pending.clear();
      set({ state: "stale", confirmedAt: state.confirmedAt });
      setTimeout(connect, RETRY_MS);
    });
    set({ state: "ready", confirmedAt: Date.now() });
    if (conditions !== null) opened.send({ type: "watch", conditions });
  }

  void connect();

  return {
    subscribe(listener) {
      states.add(listener);
      return () => states.delete(listener);
    },
    current: () => state,
    call(input) {
      if (channel === null) {
        return Promise.resolve({
          ok: false,
          error: { code: "unavailable", message: "not connected" },
        });
      }
      const id = String(++next);
      const body =
        input.kind === "upload"
          ? { input: input.body, base64: toBase64(input.bytes!) }
          : input.body;
      const reply = new Promise<CoreReply>((resolve) =>
        pending.set(id, resolve),
      );
      const sent = channel.send({
        type: "call",
        id,
        resource: input.resource,
        method: input.method,
        body,
      });
      if (!sent.ok) {
        pending.delete(id);
        return Promise.resolve({ ok: false, error: sent.error });
      }
      if (input.kind !== "file") return reply;
      return reply.then((done) => {
        if (!done.ok) return done;
        const file = done.value as { content_type: string; base64: string };
        return {
          ok: true,
          value: {
            bytes: fromBase64(file.base64),
            contentType: file.content_type,
          },
        };
      });
    },
    watch(wanted) {
      conditions = wanted;
      channel?.send({ type: "watch", conditions: wanted });
      return Promise.resolve();
    },
    onEvent(listener) {
      events.add(listener);
      return () => events.delete(listener);
    },
  };
}
