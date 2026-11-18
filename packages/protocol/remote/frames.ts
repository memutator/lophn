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

// core → client. 자격(pair code, call)을 보내기 전에 붙는 쪽이 어느 기계인지 안다. `addresses`는 그 기계의 지금 주소 후보다.
// pairing 뒤에 주소가 바뀌어도(새 network, Tailscale) 붙는 쪽이 저장한 목록을 고친다. 이 칸 전의 core는 싣지 않는다.
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

// QR에 싣는 것. 폰은 addresses의 `ws://<address>:<port>/remote`와 relay(있으면)를 같이 걸어 먼저 된 것을 쓰고,
// key로 core를 확인하고, code로 pairing한다.
export const remotePairingSchema = z.strictObject({
  addresses: remoteAddressesSchema,
  port: z.number().int().min(1).max(65535),
  key: keyTextSchema,
  code: z.string().min(1).max(128),
  relay: z.string().url().optional(),
});
export type RemotePairing = z.infer<typeof remotePairingSchema>;

// 설정 `shell.devices`의 항목 모양. 화면 칸은 설정 `shell.devices` 항목과 같은 범위다. 등록한 폰이 그 자리에 들어간다(기기 id `device`는 core가 단다. 폰은 보내지 못한다).
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

// client → core. 폰은 자기 이름을, desktop은 자기 기계 이름을 알린다. core는 붙을 때마다 기기 표의 알린 이름으로 적는다.
const clientHelloSchema = z.object({
  ...helloFields,
  name: z.string().trim().min(1).max(64),
  phone: remotePhoneSchema.optional(),
});

// 기기 kind. 기준 기기, `shell.devices`, push는 phone만의 것이다. desktop은 다른 기계의 lophn이 기기로 붙은 것이다.
export const deviceKindSchema = z.enum(["phone", "desktop"]);

// pairing 때 기기가 자기를 알리는 칸. kind로 갈린다. desktop에는 화면 칸이 없다. 이름은 그 연결의 client hello `name`이다.
export const phonePairingSchema = remoteDeviceSchema
  .omit({ name: true })
  .extend({
    kind: z.literal("phone"),
  });
export const desktopPairingSchema = z.strictObject({
  kind: z.literal("desktop"),
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

// 붙는 쪽의 첫 frame. statements는 붙는 쪽 key에 대한 항목이다(컴퓨터가 서명한 것과, 처음 들어올 때는 초대 서명
// statement). 답은 같은 id의 `result`이고 value는 `rosterJoinedSchema`다.
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
  pairFrameSchema,
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
