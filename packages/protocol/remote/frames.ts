import { z } from "zod";
import { errorBodySchema } from "../base/errors.ts";
import {
  gatewayClientFrameSchema,
  gatewayServerFrameSchema,
} from "../events/gateway.ts";
import { machineIdSchema, machineNameSchema } from "../machine/mod.ts";
import {
  phoneRequestFrameSchema,
  phoneResponseFrameSchema,
} from "../phone/link.ts";
import {
  deviceNameSchema,
  keyTextSchema,
  remoteAddressesSchema,
  rosterSnapshotSchema,
  rosterStatementSchema,
  ROSTER_JOIN_STATEMENTS_MAX,
} from "./roster.ts";

export { deviceNameSchema, keyTextSchema, remoteAddressesSchema };

// handshake 뒤 client가 먼저, core가 그 뒤에 `hello`를 보낸다. 서로의 판 범위가 겹치지 않으면 양쪽 다 `conflict`로 닫는다.
// Noise prologue는 판과 다른 것이라 판을 올려도 그대로다.
export const REMOTE_PROTOCOL_VERSION = 3;
export const REMOTE_PROTOCOL_MIN_VERSION = 3;
export const REMOTE_PROLOGUE = "lophn-remote/1";

// hello는 모르는 칸을 버린다(z.object). 다음 판이 칸을 더해도 이 판과 붙는다.
const helloFields = {
  type: z.literal("hello"),
  version: z.number().int().min(1),
  min_version: z.number().int().min(1),
  capabilities: z.array(z.string().min(1).max(64)).max(64),
};

// core → client. 자격(join, call)을 보내기 전에 붙는 쪽이 어느 기계인지 안다. `addresses`는 그 기계의 지금 주소 후보다.
// 명단에 든 뒤 주소가 바뀌어도(새 network, Tailscale) 붙는 쪽이 저장한 목록을 고친다. 이 칸 전의 core는 싣지 않는다.
const serverHelloSchema = z.object({
  ...helloFields,
  machine: z.object({
    id: machineIdSchema,
    name: machineNameSchema,
    addresses: remoteAddressesSchema.optional(),
  }),
});

const frameIdSchema = z.string().min(1).max(64);

// 폰은 `ws://<address>:<port>/remote`로 붙는다.
export const REMOTE_PATH = "/remote";

// 설정 `shell.devices`의 항목 모양. 이 컴퓨터에 처음 붙은 폰이 그 자리에 들어간다(기기 id `device`는 core가 단다. 폰은 보내지 못한다).
export const remoteDeviceSchema = z.strictObject({
  name: z.string().min(1).max(40),
  os: z.enum(["ios", "android"]),
  width: z.number().int().min(200).max(2000),
  height: z.number().int().min(200).max(3000),
  dpr: z.number().min(1).max(4),
});

// 폰의 화면. 폰이 연결마다 hello에 싣고, core는 이 컴퓨터에 처음 붙는 폰의 `shell.devices` 항목을 이것으로 만든다.
export const remotePhoneSchema = remoteDeviceSchema.omit({ name: true });
export type RemotePhone = z.infer<typeof remotePhoneSchema>;

// client → core. 폰은 자기 이름을, 컴퓨터의 core는 자기 기계 이름을 알린다. 폰이면 core가 붙을 때마다 기기 표에 알린 이름으로
// 적고, 알린 이름이 바뀌었으면 명단의 이름도 그것으로 서명한다.
const clientHelloSchema = z.object({
  ...helloFields,
  name: z.string().trim().min(1).max(64),
  phone: remotePhoneSchema.optional(),
});

// 붙는 쪽의 첫 frame. statements는 붙는 쪽 key에 대한 항목이다(컴퓨터가 서명한 것과, 처음 들어올 때는 초대 서명
// statement). 답은 같은 id의 `result`이고 value는 `rosterJoinedSchema`다. 아직 누구인지 모르는 쪽이 core의 저장소를
// 채우지 못하게 core는 이렇게 받는다:
// - statements의 항목이 모두 이 연결의 Noise key에 대한 것이어야 한다. 아니면 거절한다.
// - 붙기 전 연결에서 온 초대 서명 statement는 `checkInvited`가 맞을 때만 저장한다(서명자를 모르는 것은 저장하지 않는다).
// - 수명이 지났거나 지금부터 `ROSTER_INVITE_LONG_MS`보다 먼 초대 서명 statement는 저장하지 않는다(`rosterFresh`).
const joinFrameSchema = z.strictObject({
  type: z.literal("join"),
  id: frameIdSchema,
  statements: z.array(rosterStatementSchema).max(ROSTER_JOIN_STATEMENTS_MAX),
});

// 붙은 뒤 붙는 쪽이 든 명단 전부를 보낸다(`join` 뒤와 든 명단이 바뀔 때). 답은 같은 id의 `result`이고 value는
// core의 rosterSnapshot이다. 그래서 폰이 한 컴퓨터의 statement를 다음에 붙는 컴퓨터에 나른다.
const rosterClientFrameSchema = z.strictObject({
  type: z.literal("roster"),
  id: frameIdSchema,
  roster: rosterSnapshotSchema,
});

// core의 명단이 바뀌면 붙은 연결마다 민다.
const rosterServerFrameSchema = z.strictObject({
  type: z.literal("roster"),
  roster: rosterSnapshotSchema,
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

// 기기 → core
export const remoteClientFrameSchema = z.union([
  clientHelloSchema,
  joinFrameSchema,
  rosterClientFrameSchema,
  callFrameSchema,
  phoneResponseFrameSchema,
  gatewayClientFrameSchema,
]);
export type RemoteClientFrame = z.infer<typeof remoteClientFrameSchema>;

// core → 기기. ready·event·closed는 Gateway frame 그대로다. `request`는 폰이 `hello.capabilities`에 적은 kind만 온다(`phone/link.ts`).
export const remoteServerFrameSchema = z.union([
  serverHelloSchema,
  resultFrameSchema,
  rosterServerFrameSchema,
  phoneRequestFrameSchema,
  gatewayServerFrameSchema,
]);
export type RemoteServerFrame = z.infer<typeof remoteServerFrameSchema>;

export type RemoteServerHello = z.infer<typeof serverHelloSchema>;
export type RemoteClientHello = z.infer<typeof clientHelloSchema>;
