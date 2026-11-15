import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import {
  defineCommand,
  defineFile,
  defineMemory,
  defineRead,
} from "../base/route.ts";
import { atSchema, sha256Schema } from "../base/values.ts";
import {
  keyTextSchema,
  remoteDeviceSchema,
  remotePairingSchema,
} from "./frames.ts";

const deviceIdSchema = idSchema("dev");

// 새 code를 만들고 앞 code를 무효로 한다. remote listener가 꺼져 있으면 unavailable이다.
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
export const devicesRegister = defineCommand({
  resource: "devices",
  method: "register",
  name: "devices.register",
  changes: [{ name: "remote_devices", id: (_input, output) => output.id }],
  input: remoteDeviceSchema.extend({ public_key: keyTextSchema }),
  output: z.object({ id: deviceIdSchema }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "conflict", "unavailable"],
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

// 폰의 `pair`가 맞았을 때 같은 id의 `result` value다.
export const remotePairedSchema = z.strictObject({ device: deviceIdSchema });

// remote 화면 bundle의 file 목록이다. 기기는 이것으로 받은 사본이 지금 core의 bundle과 같은지 본다.
// `hash`는 file마다 `<path> <hash>` 줄을 path 순으로 이은 글의 sha256이다. core가 기동 뒤 한 번 계산하고 core가 사는 동안
// 바뀌지 않아 `reads`가 없다. bundle이 없으면 unavailable이다.
export const remoteUiManifest = defineMemory({
  resource: "remote_ui",
  method: "manifest",
  name: "remote_ui.manifest",
  input: z.strictObject({}),
  output: z.object({
    hash: sha256Schema,
    files: z.array(
      z.object({
        path: z.string(),
        hash: sha256Schema,
        size: z.number().int().nonnegative(),
      }),
    ),
  }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// remote 화면 bundle의 file 하나다. path는 bundle 폴더 아래 `/` 꼴 상대 경로다. 폴더 밖과 없는 file은 not_found다.
export const remoteUiFile = defineFile({
  resource: "remote_ui",
  method: "file",
  name: "remote_ui.file",
  input: z.strictObject({ path: z.string().min(1) }),
  // 실제 Content-Type은 file 형식이다. 선언은 fallback이다.
  contentType: "application/octet-stream",
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});
