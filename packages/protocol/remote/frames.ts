import { z } from "zod";
import { errorBodySchema } from "../base/errors.ts";
import {
  gatewayClientFrameSchema,
  gatewayServerFrameSchema,
} from "../events/gateway.ts";

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

// 화면 칸은 설정 `shell.devices` 항목과 같은 범위다. 등록한 기기가 그 자리에 그대로 들어간다.
export const remoteDeviceSchema = z.strictObject({
  name: z.string().min(1).max(40),
  os: z.enum(["ios", "android"]),
  width: z.number().int().min(200).max(2000),
  height: z.number().int().min(200).max(3000),
  dpr: z.number().min(1).max(4),
});

// 답은 같은 id의 `result`다. 성공 value는 core가 정한다(기기 id 등).
const pairFrameSchema = remoteDeviceSchema.extend({
  type: z.literal("pair"),
  id: frameIdSchema,
  code: z.string().min(1).max(128),
});

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

// 폰 → core
export const remoteClientFrameSchema = z.union([
  helloFrameSchema,
  pairFrameSchema,
  callFrameSchema,
  gatewayClientFrameSchema,
]);
export type RemoteClientFrame = z.infer<typeof remoteClientFrameSchema>;

// core → 폰. ready·event·closed는 Gateway frame 그대로다.
export const remoteServerFrameSchema = z.union([
  helloFrameSchema,
  resultFrameSchema,
  gatewayServerFrameSchema,
]);
export type RemoteServerFrame = z.infer<typeof remoteServerFrameSchema>;

export type RemoteHello = z.infer<typeof helloFrameSchema>;
