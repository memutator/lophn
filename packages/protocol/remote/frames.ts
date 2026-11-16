import { z } from "zod";
import { errorBodySchema } from "../base/errors.ts";
import {
  gatewayClientFrameSchema,
  gatewayServerFrameSchema,
} from "../events/gateway.ts";
import {
  phoneRequestFrameSchema,
  phoneResponseFrameSchema,
} from "../phone/link.ts";

// handshake 뒤 양쪽이 먼저 `hello`를 주고받는다. 상대 판이 하한보다 낮으면 연결을 끊는다.
export const REMOTE_PROTOCOL_VERSION = 1;
export const REMOTE_PROTOCOL_MIN_VERSION = 1;
export const REMOTE_PROLOGUE = "lophn-remote/1";

const helloFrameSchema = z.strictObject({
  type: z.literal("hello"),
  version: z.number().int().min(1),
  capabilities: z.array(z.string().min(1).max(64)).max(64),
});

const frameIdSchema = z.string().min(1).max(64);

// 폰은 `ws://<address>:<port>/remote`로 붙는다.
export const REMOTE_PATH = "/remote";

// 공개 key의 글자 꼴(base64url, 32 bytes). `remoteKeyText`가 만든다.
export const keyTextSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);

// QR에 싣는 것. 폰은 addresses의 `ws://<address>:<port>/remote`와 relay(있으면)를 같이 걸어 먼저 된 것을 쓰고,
// key로 core를 확인하고, code로 pairing한다.
export const remotePairingSchema = z.strictObject({
  addresses: z.array(z.string().min(1)).max(16),
  port: z.number().int().min(1).max(65535),
  key: keyTextSchema,
  code: z.string().min(1).max(128),
  relay: z.string().url().optional(),
});
export type RemotePairing = z.infer<typeof remotePairingSchema>;

// 폰의 것. 화면 칸은 설정 `shell.devices` 항목과 같은 범위다. 등록한 폰이 그 자리에 들어간다(기기 id `device`는 core가 단다. 폰은 보내지 못한다).
export const remoteDeviceSchema = z.strictObject({
  name: z.string().min(1).max(40),
  os: z.enum(["ios", "android"]),
  width: z.number().int().min(200).max(2000),
  height: z.number().int().min(200).max(3000),
  dpr: z.number().min(1).max(4),
});

// 기기 kind. 기준 기기, `shell.devices`, push는 phone만의 것이다. desktop은 다른 기계의 lophn이 기기로 붙은 것이다.
export const deviceKindSchema = z.enum(["phone", "desktop"]);

// 기기가 알리는 자기 이름. desktop은 기계 이름(1..64)을 알린다.
export const deviceNameSchema = z.string().min(1).max(64);

// pairing 때 기기가 자기를 알리는 칸. kind로 갈린다. desktop에는 화면 칸이 없다.
export const phonePairingSchema = remoteDeviceSchema.extend({
  kind: z.literal("phone"),
});
export const desktopPairingSchema = z.strictObject({
  kind: z.literal("desktop"),
  name: deviceNameSchema,
  os: z.enum(["linux", "macos", "windows"]),
});

const pairFields = {
  type: z.literal("pair"),
  id: frameIdSchema,
  code: z.string().min(1).max(128),
};

// 답은 같은 id의 `result`다. 성공 value는 core가 정한다(기기 id 등).
const pairFrameSchema = z.discriminatedUnion("kind", [
  phonePairingSchema.extend(pairFields),
  desktopPairingSchema.extend(pairFields),
]);

// route 하나를 부른다. body는 HTTP API의 요청 body와 같다(command면 `{input, idempotency_key, …}` envelope). core의 route dispatch가 검사한다.
const callFrameSchema = z.strictObject({
  type: z.literal("call"),
  id: frameIdSchema,
  resource: z.string().min(1),
  method: z.string().min(1),
  body: z.unknown(),
});

const resultFrameSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    type: z.literal("result"),
    id: frameIdSchema,
    ok: z.literal(true),
    value: z.unknown(),
  }),
  z.strictObject({
    type: z.literal("result"),
    id: frameIdSchema,
    ok: z.literal(false),
    error: errorBodySchema.shape.error,
  }),
]);

// 기기 → core
export const remoteClientFrameSchema = z.union([
  helloFrameSchema,
  pairFrameSchema,
  callFrameSchema,
  phoneResponseFrameSchema,
  gatewayClientFrameSchema,
]);
export type RemoteClientFrame = z.infer<typeof remoteClientFrameSchema>;

// core → 기기. ready·event·closed는 Gateway frame 그대로다. `request`는 폰이 `hello.capabilities`에 적은 kind만 온다(`phone/link.ts`).
export const remoteServerFrameSchema = z.union([
  helloFrameSchema,
  resultFrameSchema,
  phoneRequestFrameSchema,
  gatewayServerFrameSchema,
]);
export type RemoteServerFrame = z.infer<typeof remoteServerFrameSchema>;

export type RemoteHello = z.infer<typeof helloFrameSchema>;
