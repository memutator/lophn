import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineMemory, defineRead } from "../base/route.ts";
import { atSchema } from "../base/values.ts";
import { pushPrefsSchema } from "../attention/mod.ts";
import {
  keyTextSchema,
  remoteDeviceSchema,
  remotePairingSchema,
} from "./frames.ts";

const deviceIdSchema = idSchema("dev");

// 새 code를 만들고 앞 code를 무효로 한다. remote listener도 relay도 떠 있지 않으면 unavailable이다.
export const pairingStart = defineMemory({
  resource: "pairing",
  method: "start",
  name: "pairing.start",
  input: z.strictObject({}),
  output: remotePairingSchema.extend({ expires_at: atSchema }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 설정 `remote.relay`로 건 relay 연결의 상태. relay 설정이 비었거나 remote가 꺼져 있으면 off다.
export const remoteRelayStatus = defineMemory({
  resource: "remote_relay",
  method: "status",
  name: "remote_relay.status",
  input: z.strictObject({}),
  output: z.strictObject({
    url: z.string().nullable(),
    state: z.enum(["off", "connecting", "connected"]),
  }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden"],
});

const deviceSchema = remoteDeviceSchema.extend({
  id: deviceIdSchema,
  public_key: keyTextSchema,
  created_at: atSchema,
  last_connected_at: atSchema.nullable(),
  primary: z.boolean(),
});
export type RemoteDevice = z.infer<typeof deviceSchema>;

// 만든 순서다. remote 연결이 붙는 기기를 key로 찾으려고 core 안 machine도 읽는다.
export const devicesList = defineRead({
  resource: "devices",
  method: "list",
  name: "devices.list",
  reads: ["remote_devices"],
  input: z.strictObject({}),
  output: withReadCommon(z.object({ devices: z.array(deviceSchema) })),
  actors: ["user", "machine"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 설정 `shell.devices`에서 이 기기의 항목(`device`가 이 id) 이름도 바꾼다. 다른 항목과 겹치면 뒤에 " 2"…를 붙인다.
export const devicesRename = defineCommand({
  resource: "devices",
  method: "rename",
  name: "devices.rename",
  changes: [{ name: "remote_devices", id: (_input, output) => output.id }],
  input: z.strictObject({
    id: deviceIdSchema,
    name: remoteDeviceSchema.shape.name,
  }),
  output: z.object({ id: deviceIdSchema }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// 기기를 지운다. 그 기기의 연결은 바로 닫히고, 같은 key는 다시 pairing해야 붙는다.
export const devicesRevoke = defineCommand({
  resource: "devices",
  method: "revoke",
  name: "devices.revoke",
  changes: [{ name: "remote_devices", id: (_input, output) => output.id }],
  input: z.strictObject({ id: deviceIdSchema }),
  output: z.object({ id: deviceIdSchema }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// 폰이 이 컴퓨터를 지울 때 부른다. 부른 기기 자기 등록만 지운다(id를 받지 않는다). 기기 자격이 아니면 forbidden이다.
export const devicesUnpair = defineCommand({
  resource: "devices",
  method: "unpair",
  name: "devices.unpair",
  changes: [{ name: "remote_devices", id: (_input, output) => output.id }],
  input: z.strictObject({}),
  output: z.object({ id: deviceIdSchema }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// 기준 기기는 하나다. 다른 기기의 기준을 내린다.
export const devicesSetPrimary = defineCommand({
  resource: "devices",
  method: "set_primary",
  name: "devices.set_primary",
  changes: [{ name: "remote_devices", id: (_input, output) => output.id }],
  input: z.strictObject({ id: deviceIdSchema }),
  output: z.object({ id: deviceIdSchema }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// pairing이 맞은 기기를 등록한다. core 안 machine 자격만 낸다. 새 기기가 기준이 된다.
// 같은 key의 옛 등록(폰이 이 컴퓨터를 지웠는데 컴퓨터는 몰랐다)은 지우고 새 등록으로 바꾼다.
export const devicesRegister = defineCommand({
  resource: "devices",
  method: "register",
  name: "devices.register",
  changes: [{ name: "remote_devices", id: (_input, output) => output.id }],
  input: remoteDeviceSchema.extend({ public_key: keyTextSchema }),
  output: z.object({ id: deviceIdSchema }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 기기가 붙은 때를 적는다. core 안 machine 자격만 낸다.
export const devicesConnected = defineCommand({
  resource: "devices",
  method: "connected",
  name: "devices.connected",
  changes: [{ name: "remote_devices", id: (_input, output) => output.id }],
  input: z.strictObject({ id: deviceIdSchema }),
  output: z.object({ id: deviceIdSchema }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// Expo push token. 폰이 `getExpoPushTokenAsync`로 받은 글 그대로다.
const pushTokenSchema = z
  .string()
  .regex(/^Expo(nent)?PushToken\[[^\]]+\]$/)
  .max(200);

// 폰이 자기 push token과 알림 설정을 core에 둔다. 부른 기기 자기 행만 고친다(id를 받지 않는다). 기기 자격이 아니면 forbidden이다.
// `token: null`은 이 기기의 push를 끄는 것이다(token을 지우고 prefs는 저장한다).
export const devicesSetPush = defineCommand({
  resource: "devices",
  method: "set_push",
  name: "devices.set_push",
  changes: [{ name: "remote_devices", id: (_input, output) => output.id }],
  input: z.strictObject({
    token: pushTokenSchema.nullable(),
    prefs: pushPrefsSchema,
  }),
  output: z.object({ id: deviceIdSchema }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// 죽은 token을 core가 거둔다. 그 기기의 token이 입력과 같을 때만 지운다(그 사이 폰이 새 token을 보냈으면 그대로 둔다). core 안 machine 자격만 낸다.
export const devicesClearPush = defineCommand({
  resource: "devices",
  method: "clear_push",
  name: "devices.clear_push",
  changes: [{ name: "remote_devices", id: (_input, output) => output.id }],
  input: z.strictObject({ id: deviceIdSchema, token: pushTokenSchema }),
  output: z.object({ id: deviceIdSchema }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// push를 보낼 기기: token이 있는 기기의 token과 알림 설정. core 안 machine 자격만 읽는다. 폰은 부를 수 없다.
export const devicesPushTargets = defineRead({
  resource: "devices",
  method: "push_targets",
  name: "devices.push_targets",
  reads: ["remote_devices"],
  input: z.strictObject({}),
  output: withReadCommon(
    z.object({
      devices: z.array(
        z.strictObject({
          id: deviceIdSchema,
          token: pushTokenSchema,
          prefs: pushPrefsSchema,
        }),
      ),
    }),
  ),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 폰의 `pair`가 맞았을 때 같은 id의 `result` value다.
export const remotePairedSchema = z.strictObject({ device: deviceIdSchema });
