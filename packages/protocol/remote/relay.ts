// lophn relay: 폰과 core가 다른 network에 있어도 만나게 하는 전달자. relay는 binary message를 그대로 넘기고
// 내용은 폰과 core 사이 Noise가 지킨다. core는 control socket 하나를 밖으로 걸어 자기 key를 증명하고,
// 폰이 붙을 때마다 relay가 준 연결 id로 data socket을 따로 연다.
import { x25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { z } from "zod";
import { keyTextSchema } from "./frames.ts";
import { remoteKeyBytes, remoteKeyText } from "./noise.ts";

// `<relay>`는 `wss://…`(개발은 `ws://…`), 끝의 `/` 없이.
export const RELAY_HOST_PATH = "/v1/host"; // ?key=<core key text>
export const RELAY_DATA_PATH = "/v1/data"; // ?conn=<연결 id>
export const RELAY_PHONE_PATH = "/v1/phone"; // ?key=<core key text>

export function relayHostUrl(relay: string, key: string): string {
  return `${relay}${RELAY_HOST_PATH}?key=${key}`;
}
export function relayDataUrl(relay: string, conn: string): string {
  return `${relay}${RELAY_DATA_PATH}?conn=${conn}`;
}
export function relayPhoneUrl(relay: string, key: string): string {
  return `${relay}${RELAY_PHONE_PATH}?key=${key}`;
}

// 한도. message 하나의 크기는 `NOISE_MAX_MESSAGE_BYTES`다.
export const RELAY_PHONES_PER_HOST = 16;
// data socket이 붙기 전에 relay가 들고 있는 폰 message 수.
export const RELAY_PENDING_MESSAGES = 16;
// 증명 없는 control socket, data socket이 붙지 않은 폰 연결을 닫는 시간.
export const RELAY_OPEN_TIMEOUT_MS = 10_000;
export const RELAY_PING_MS = 20_000;
export const RELAY_IDLE_TIMEOUT_MS = 60_000;

// 연결 id: 무작위 128-bit, base64url 22글자.
export const relayConnSchema = z.string().regex(/^[A-Za-z0-9_-]{22}$/);
const nonceSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

// control socket의 text frame(JSON).
export const relayToHostSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("challenge"),
    relay_key: keyTextSchema,
    nonce: nonceSchema,
  }),
  z.strictObject({ type: z.literal("ready") }),
  z.strictObject({ type: z.literal("connected"), conn: relayConnSchema }),
  z.strictObject({ type: z.literal("gone"), conn: relayConnSchema }),
]);
export type RelayToHost = z.infer<typeof relayToHostSchema>;

export const hostToRelaySchema = z.strictObject({
  type: z.literal("proof"),
  mac: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
});
export type HostToRelay = z.infer<typeof hostToRelaySchema>;

// `mac = HMAC-SHA256(key = X25519(내 secret, 상대 공개 key), nonce bytes)`, base64url.
// core는 (자기 static secret, relay_key)로, relay는 (자기 임시 secret, core key)로 같은 값을 얻는다.
export function relayProof(
  secret: Uint8Array,
  peerKey: string,
  nonce: string,
): string | undefined {
  const peer = remoteKeyBytes(peerKey);
  const nonceBytes = remoteKeyBytes(nonce);
  if (!peer || !nonceBytes) return undefined;
  return remoteKeyText(
    hmac(sha256, x25519.getSharedSecret(secret, peer), nonceBytes),
  );
}
