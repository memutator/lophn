import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineMemory, defineRead } from "../base/route.ts";
import { atSchema } from "../base/values.ts";
import { remoteDeviceSchema } from "./frames.ts";

// 공개 key의 글자 꼴은 base64url(패딩 없음) 하나다. QR, 기기 표, `devices/list`가 같은 글자를 쓴다.
// 폰의 JavaScript engine에서도 돌아서 Buffer를 쓰지 않는다.
export function remoteKeyText(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

// 32 bytes가 아니거나 꼴이 틀리면 undefined다.
export function remoteKeyBytes(text: string): Uint8Array | undefined {
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) return undefined;
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/") + "=");
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

// 폰은 `ws://<address>:<port>/remote`로 붙는다.
export const REMOTE_PATH = "/remote";

const keyTextSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const deviceIdSchema = idSchema("dev");

// QR에 싣는 것. 폰은 addresses를 차례로 `ws://<address>:<port>/remote`로 붙어 보고, key로 core를 확인하고, code로 pairing한다.
export const remotePairingSchema = z.strictObject({
  addresses: z.array(z.string().min(1)).max(16),
  port: z.number().int().min(1).max(65535),
  key: keyTextSchema,
  code: z.string().min(1).max(128),
});
export type RemotePairing = z.infer<typeof remotePairingSchema>;

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
  input: z.strictObject({}),
  output: withReadCommon(z.object({ devices: z.array(deviceSchema) })),
  actors: ["user", "machine"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 같은 이름은 설정 `shell.devices`의 항목 이름도 바꾼다.
export const devicesRename = defineCommand({
  resource: "devices",
  method: "rename",
  name: "devices.rename",
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
  input: z.strictObject({ id: deviceIdSchema }),
  output: z.object({ id: deviceIdSchema }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// 폰의 `pair`가 맞았을 때 같은 id의 `result` value다.
export const remotePairedSchema = z.strictObject({ device: deviceIdSchema });
