import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineMemory, defineRead } from "../base/route.ts";
import { atSchema } from "../base/values.ts";
import { pushPrefsSchema } from "../attention/mod.ts";
import { eventConditionSchema } from "../events/bus.ts";
import { machineIdSchema } from "../machine/mod.ts";
import {
  desktopPairingSchema,
  deviceKindSchema,
  deviceNameSchema,
  keyTextSchema,
  phonePairingSchema,
  remoteDeviceSchema,
  remotePairingSchema,
  remotePhoneSchema,
} from "./frames.ts";
import {
  ROSTER_STATEMENTS_MAX,
  rosterEntryBodySchema,
  rosterInviteTextSchema,
  rosterKindSchema,
  rosterReachSchema,
  rosterStatementSchema,
} from "./roster.ts";

const deviceIdSchema = idSchema("dev");

// 새 code를 만들고 앞 code를 무효로 한다. remote listener도 relay도 떠 있지 않으면 unavailable이다.
// `terminal_input`은 이 code로 붙는 기기가 터미널에 칠 수 있는가다. 사람이 pairing 화면에서 정한다.
export const pairingStart = defineMemory({
  resource: "pairing",
  method: "start",
  name: "pairing.start",
  input: z.strictObject({ terminal_input: z.boolean() }),
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

const deviceSchema = z.strictObject({
  id: deviceIdSchema,
  kind: deviceKindSchema,
  // 보이는 이름: 사람이 붙인 별명이 있으면 별명, 없으면 기기가 마지막으로 알린 이름.
  name: deviceNameSchema,
  announced_name: deviceNameSchema,
  alias: deviceNameSchema.nullable(),
  os: z.enum([
    ...phonePairingSchema.shape.os.options,
    ...desktopPairingSchema.shape.os.options,
  ]),
  // 화면 칸은 phone만 있다.
  width: remoteDeviceSchema.shape.width.nullable(),
  height: remoteDeviceSchema.shape.height.nullable(),
  dpr: remoteDeviceSchema.shape.dpr.nullable(),
  public_key: keyTextSchema,
  created_at: atSchema,
  last_connected_at: atSchema.nullable(),
  primary: z.boolean(),
  // 이 기기가 coding agent 터미널에 칠 수 있는가. 기본 꺼짐이고 사람이 컴퓨터에서만 켠다(devices/set_terminal_input).
  terminal_input: z.boolean(),
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

// 사람이 붙인 별명을 둔다. null이면 별명을 지워 기기가 알린 이름이 다시 보인다. 보이는 이름이 바뀌면 설정 `shell.devices`에서
// 이 기기의 항목(`device`가 이 id) 이름도 바꾼다. 다른 항목과 겹치면 뒤에 " 2"…를 붙인다.
export const devicesRename = defineCommand({
  resource: "devices",
  method: "rename",
  name: "devices.rename",
  changes: [{ name: "remote_devices", id: (_input, output) => output.id }],
  input: z.strictObject({
    id: deviceIdSchema,
    name: deviceNameSchema.nullable(),
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

// 기준 기기는 하나다. 다른 기기의 기준을 내린다. phone만 기준이 된다(desktop이면 invalid_input).
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

// 기기가 터미널에 치는 것을 켜고 끈다. 사람(desktop)만 부른다: 기기 자격은 이 route가 목록(REMOTE_ALLOWED_ROUTES)에 없어
// forbidden이다. 끄면 그 기기의 다음 입력부터 거절이다.
export const devicesSetTerminalInput = defineCommand({
  resource: "devices",
  method: "set_terminal_input",
  name: "devices.set_terminal_input",
  changes: [{ name: "remote_devices", id: (_input, output) => output.id }],
  input: z.strictObject({ id: deviceIdSchema, on: z.boolean() }),
  output: z.object({ id: deviceIdSchema }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// 기기가 알린 이름(client hello `name`). 별명과 달리 연결마다 고쳐 적힌다.
const announcedNameSchema = z.string().trim().min(1).max(64);

// pairing이 맞은 기기를 등록한다. core 안 machine 자격만 낸다. 새 phone이 기준이 된다(desktop은 기준을 건드리지 않는다).
// 같은 key의 옛 등록(폰이 이 컴퓨터를 지웠는데 컴퓨터는 몰랐다)은 지우고 새 등록으로 바꾼다. name은 그 연결의 hello로 알린 이름이다.
// terminal_input은 그 pairing code를 만들 때 사람이 정한 터미널 입력 허락이다.
const registered = {
  public_key: keyTextSchema,
  name: announcedNameSchema,
  terminal_input: z.boolean(),
};
export const devicesRegister = defineCommand({
  resource: "devices",
  method: "register",
  name: "devices.register",
  changes: [{ name: "remote_devices", id: (_input, output) => output.id }],
  input: z.discriminatedUnion("kind", [
    phonePairingSchema.extend(registered),
    desktopPairingSchema.extend(registered),
  ]),
  output: z.object({ id: deviceIdSchema }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 기기가 붙은 때와 그 연결의 hello로 알린 이름을 적는다. core 안 machine 자격만 낸다. 사람이 붙인 별명은 그대로다.
// `phone`은 그 연결의 hello가 알린 화면이다. 이 컴퓨터에 처음 붙는 폰의 local 행(`shell.devices` 항목)을 이것으로 만든다.
// 하나만 다르다: 알린 이름을 아직 받은 적 없는 행(migration·pairing에서 온 이름)의 별명이 알린 이름과 같으면 별명을 거둔다.
// migration이 옛 이름을 별명으로 지켜 둔 것 가운데 사람이 바꾼 적 없는 것이라 보이는 글은 바뀌지 않는다.
export const devicesConnected = defineCommand({
  resource: "devices",
  method: "connected",
  name: "devices.connected",
  changes: [{ name: "remote_devices", id: (_input, output) => output.id }],
  input: z.strictObject({
    id: deviceIdSchema,
    name: announcedNameSchema,
    phone: remotePhoneSchema.optional(),
  }),
  output: z.object({ id: deviceIdSchema }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// 기기 등록을 모두 지운다. core 안 machine 자격만 낸다. host key가 다른 기계의 것(복사된 data root)일 때 기동이 부른다:
// 그 등록은 다른 기계가 pairing한 것이다. 행마다 끊은 것과 같이 연결을 닫고 자격을 거둔다.
export const devicesForgetAll = defineCommand({
  resource: "devices",
  method: "forget_all",
  name: "devices.forget_all",
  changes: ["remote_devices"],
  input: z.strictObject({}),
  output: z.object({ count: z.number().int().min(0) }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// Expo push token. 폰이 `getExpoPushTokenAsync`로 받은 글 그대로다.
const pushTokenSchema = z
  .string()
  .regex(/^Expo(nent)?PushToken\[[^\]]+\]$/)
  .max(200);

// 폰이 자기 push token과 알림 설정을 core에 둔다. 부른 기기 자기 행만 고친다(id를 받지 않는다). 기기 자격이 아니거나 desktop이면 forbidden이다.
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

// 내 기기 명단(architecture `remote.md`의 "명단"). 명단 하나를 모든 기계가 같이 들고 어느 컴퓨터에서나 고친다.

// 이 컴퓨터가 믿는 명단의 기기들. 이름은 명단의 이름 하나다(기기마다 따로 붙이는 별명이 없다). `this`는 이 컴퓨터의 id다.
// `pending`은 다른 컴퓨터가 아직 받아들이지 않은 기기다(`rosterPending`): 닿지 못한 채 든 이 컴퓨터, 아직 붙지 않은 기기.
export const rosterList = defineMemory({
  resource: "roster",
  method: "list",
  name: "roster.list",
  reads: ["remote_devices"],
  input: z.strictObject({}),
  output: z.strictObject({
    this: deviceIdSchema.nullable(),
    devices: z.array(
      z.strictObject({
        id: deviceIdSchema,
        kind: rosterKindSchema,
        name: deviceNameSchema,
        os: rosterEntryBodySchema.shape.os,
        machine: machineIdSchema.nullable(),
        terminal_input: z.boolean(),
        this: z.boolean(),
        pending: z.boolean(),
        last_connected_at: atSchema.nullable(),
      }),
    ),
  }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 초대장을 낸다. `kind`는 들일 기기의 종류이고(사람이 폰과 컴퓨터 가운데 고른다) 다른 종류는 그 초대장으로 들지 못한다.
// 수명은 short(`ROSTER_INVITE_SHORT_MS`)와 long(`ROSTER_INVITE_LONG_MS`. 새 기기가 이 컴퓨터와 같은 때 켜질 수 없을 때).
// remote가 꺼져 있으면 unavailable이다.
export const rosterInvite = defineMemory({
  resource: "roster",
  method: "invite",
  name: "roster.invite",
  input: z.strictObject({
    kind: rosterKindSchema,
    terminal_input: z.boolean(),
    lifetime: z.enum(["short", "long"]),
  }),
  output: z.strictObject({
    invite: rosterInviteTextSchema,
    expires_at: atSchema,
  }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 이 컴퓨터가 다른 컴퓨터의 초대장으로 명단에 든다. 초대한 컴퓨터에 닿지 못하면 초대장을 확인하고 초대 서명 statement를
// 들고 `pending: true`로 끝난다(link나 폰이 그 statement를 초대한 컴퓨터를 믿는 컴퓨터에 나른다).
// 이 컴퓨터 자신이 낸 초대장이면 conflict(`this_computer`)다.
export const rosterJoin = defineMemory({
  resource: "roster",
  method: "join",
  name: "roster.join",
  changes: [{ name: "remote_devices", id: (_input, output) => output.device }],
  input: z.strictObject({ text: z.string().min(1).max(16384) }),
  output: z.strictObject({
    device: deviceIdSchema,
    machine: machineIdSchema,
    pending: z.boolean(),
  }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "forbidden",
    "unauthorized",
    "conflict",
    "unavailable",
  ],
});

// 기기를 명단에서 뺀다(서명한 빼기). 이 컴퓨터 자신이면 invalid_input이다. 뺀 key는 다시 들지 못한다.
export const rosterRemove = defineMemory({
  resource: "roster",
  method: "remove",
  name: "roster.remove",
  changes: [{ name: "remote_devices", id: (_input, output) => output.id }],
  input: z.strictObject({ id: deviceIdSchema }),
  output: z.strictObject({ id: deviceIdSchema }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// 기기의 터미널 입력 허락을 바꾼다. 이 컴퓨터가 서명한 새 rev라 모든 기계에 같다.
export const rosterSetTerminalInput = defineMemory({
  resource: "roster",
  method: "set_terminal_input",
  name: "roster.set_terminal_input",
  changes: [{ name: "remote_devices", id: (_input, output) => output.id }],
  input: z.strictObject({ id: deviceIdSchema, on: z.boolean() }),
  output: z.strictObject({ id: deviceIdSchema }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// 기기의 이름을 바꾼다. 이 컴퓨터가 서명한 새 rev라 모든 기계에 같다. 컴퓨터 자기 이름은 `machine/rename`을 따라
// 그 컴퓨터가 자기 항목을 다시 서명한다.
export const rosterRename = defineMemory({
  resource: "roster",
  method: "rename",
  name: "roster.rename",
  changes: [{ name: "remote_devices", id: (_input, output) => output.id }],
  input: z.strictObject({ id: deviceIdSchema, name: deviceNameSchema }),
  output: z.strictObject({ id: deviceIdSchema }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// 부른 기기 자기만 명단에서 뺀다(id를 받지 않는다). 기기 자격(principal `device:<id>`)이 아니면 forbidden이다.
export const rosterLeave = defineMemory({
  resource: "roster",
  method: "leave",
  name: "roster.leave",
  changes: [{ name: "remote_devices", id: (_input, output) => output.id }],
  input: z.strictObject({}),
  output: z.strictObject({ id: deviceIdSchema }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// 저장한 명단(statement와 주소). core 안 machine 자격만 읽는다.
export const rosterStatements = defineRead({
  resource: "roster",
  method: "statements",
  name: "roster.statements",
  reads: ["remote_devices"],
  input: z.strictObject({}),
  output: withReadCommon(
    z.object({
      statements: z.array(rosterStatementSchema),
      reach: z.array(rosterReachSchema),
    }),
  ),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 저장할 명단을 통째로 둔다. main thread가 서명하고 합쳐 정한 뒤 부른다. `folds`는 같은 key의 여러 id를 접은 것이고
// 같은 write에서 그 id를 쓰는 곳을 고친다. core 안 machine 자격만 낸다.
export const rosterStore = defineCommand({
  resource: "roster",
  method: "store",
  name: "roster.store",
  changes: ["remote_devices"],
  input: z.strictObject({
    statements: z.array(rosterStatementSchema).max(ROSTER_STATEMENTS_MAX),
    reach: z.array(rosterReachSchema).max(256),
    folds: z.array(
      z.strictObject({ from: deviceIdSchema, to: deviceIdSchema }),
    ),
  }),
  output: z.object({ count: z.number().int().min(0) }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 명단을 모두 버린다. 복사된 data root일 때 기동이 부른다(host key와 서명 key도 지워 다음 reconcile에 새로 만든다).
// core 안 machine 자격만 낸다.
export const rosterForgetAll = defineCommand({
  resource: "roster",
  method: "forget_all",
  name: "roster.forget_all",
  changes: ["remote_devices"],
  input: z.strictObject({}),
  output: z.object({ count: z.number().int().min(0) }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 명단의 다른 컴퓨터와 이 컴퓨터 core의 연결 상태(이 컴퓨터는 없다). `update`는 판이 어긋났을 때 어느 쪽을 올릴지다.
export const machinesList = defineMemory({
  resource: "machines",
  method: "list",
  name: "machines.list",
  reads: ["remote_devices"],
  input: z.strictObject({}),
  output: z.strictObject({
    machines: z.array(
      z.strictObject({
        machine: machineIdSchema,
        device: deviceIdSchema,
        name: deviceNameSchema,
        status: z.enum(["connecting", "connected", "offline", "update"]),
        update: z.enum(["client", "host"]).nullable(),
        path: z.enum(["direct", "relay"]).nullable(),
        last_seen_at: atSchema.nullable(),
      }),
    ),
  }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 다른 기계의 route 하나를 이 컴퓨터 core의 연결로 부른다. 받는 기계는 `device:<이 컴퓨터의 id>`인 사람으로 보고 지금의
// 기기 route 목록으로 거른다. 답은 그 기계의 value이고 오류(code, message, details)도 그대로다. 그래서 일곱 code가 다
// 날 수 있다. 연결이 없으면 unavailable, 명단에 없는 기계면 not_found다.
export const machinesCall = defineMemory({
  resource: "machines",
  method: "call",
  name: "machines.call",
  input: z.strictObject({
    machine: machineIdSchema,
    resource: z.string().min(1),
    method: z.string().min(1),
    body: z.unknown(),
  }),
  output: z.unknown(),
  actors: ["user"],
  errors: [
    "invalid_input",
    "forbidden",
    "not_found",
    "unauthorized",
    "conflict",
    "unavailable",
    "internal",
  ],
});

// 다른 기계의 Gateway 조건을 통째로 바꾼다(빈 배열은 끈다). 그 기계의 frame은 이 컴퓨터의 bus에 `MachineFrameReceived`로 온다.
export const machinesWatch = defineMemory({
  resource: "machines",
  method: "watch",
  name: "machines.watch",
  input: z.strictObject({
    machine: machineIdSchema,
    conditions: z.array(eventConditionSchema).max(64),
  }),
  output: z.strictObject({}),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});
