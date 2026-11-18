import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineMemory, defineRead } from "../base/route.ts";
import { atSchema } from "../base/values.ts";
import { pushPrefsSchema } from "../attention/mod.ts";
import { appTools } from "../apps/declaration/read.ts";
import { eventConditionSchema } from "../events/bus.ts";
import { agentIdSchema, workspaceSchema } from "../lophn-agent/workspaces.ts";
import { machineIdSchema } from "../machine/mod.ts";
import { appIdSchema } from "../projects/values.ts";
import {
  deviceNameSchema,
  keyTextSchema,
  remoteDeviceSchema,
  remotePhoneSchema,
} from "./frames.ts";
import {
  machineCandidateSchema,
  machineRefSchema,
} from "../machine/requester.ts";
import {
  ROSTER_STATEMENTS_MAX,
  rosterEntryBodySchema,
  rosterInviteTextSchema,
  rosterKindSchema,
  rosterReachSchema,
  rosterStatementSchema,
} from "./roster.ts";

const deviceIdSchema = idSchema("dev");

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

// 이 컴퓨터에 붙은 폰의 행: 이 컴퓨터만의 칸(화면, 기준, 마지막 연결). 종류, 이름의 주인, 터미널 입력 허락은 명단이 든다
// (`roster/list`). `name`은 명단의 이름이다.
const deviceSchema = z.strictObject({
  id: deviceIdSchema,
  name: deviceNameSchema,
  os: remoteDeviceSchema.shape.os,
  width: remoteDeviceSchema.shape.width,
  height: remoteDeviceSchema.shape.height,
  dpr: remoteDeviceSchema.shape.dpr,
  public_key: keyTextSchema,
  created_at: atSchema,
  last_connected_at: atSchema.nullable(),
  primary: z.boolean(),
});
export type RemoteDevice = z.infer<typeof deviceSchema>;

// 만든 순서다. core 안 machine도 읽는다(host queue가 기준 폰을 찾는다).
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

// 기준 기기는 하나다. 다른 기기의 기준을 내린다. 행은 폰만 있어 컴퓨터는 not_found다.
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

// 기기가 알린 이름(client hello `name`). 연결마다 고쳐 적힌다.
const announcedNameSchema = z.string().trim().min(1).max(64);

// 폰이 붙은 때와 그 연결의 hello로 알린 이름을 적는다. core 안 machine 자격만 낸다. `phone`은 그 연결의 hello가 알린 화면이다.
// 이 컴퓨터에 처음 붙는 폰의 local 행(`shell.devices` 항목)을 이것으로 만든다. `renamed`는 있던 행의 알린 이름이 바뀐
// 것이다(폰에서 이름을 바꿨다). 그때만 wiring이 명단의 이름을 서명하므로 사람이 `roster/rename`으로 바꾼 이름을 폰이 옛
// 이름으로 다시 덮지 않는다.
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
  output: z.object({ id: deviceIdSchema, renamed: z.boolean() }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// Expo push token. 폰이 `getExpoPushTokenAsync`로 받은 글 그대로다.
const pushTokenSchema = z
  .string()
  .regex(/^Expo(nent)?PushToken\[[^\]]+\]$/)
  .max(200);

// 폰이 자기 push token과 알림 설정을 core에 둔다. 부른 기기 자기 행만 고친다(id를 받지 않는다). 기기 자격이 아니면 forbidden, 행이 없는 기기(컴퓨터)는 not_found다.
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

// 내 기기 명단(architecture `remote.md`의 "명단"). 명단 하나를 모든 기계가 같이 들고 어느 컴퓨터에서나 고친다.

// 이 컴퓨터가 믿는 명단의 기기들. 이름은 명단의 이름 하나다(기기마다 따로 붙이는 별명이 없다). `this`는 이 컴퓨터의 id다.
// `removed_at`은 다른 컴퓨터가 이 컴퓨터를 빼 명단과 key를 버린 때다. core의 메모리에만 있어 다시 뜨거나 다시 들면 null이다.
// `pending`은 초대장으로 들었는데 다른 컴퓨터가 아직 받아들이지 않은 기기다(`rosterPending`): 초대한 컴퓨터에 닿지 못하고 든 이 컴퓨터 등.
// `disputed`는 정해지지 않은 빼기(두 컴퓨터가 서로 뺐다)로 빠진 기기다. 명단에는 없고 사람이 이 컴퓨터에서 `roster/remove {key}`로
// 다시 빼면 그 빼기가 이 컴퓨터의 판단이 되어 풀린다. 그 줄의 id와 이름은 지금 믿는 서명자의 항목(없으면 그 기기 자신의 서명)에서
// 온다. `key`는 기기의 key다(엇갈린 줄을 고르는 값). `terminal_input`은 명단에 서명된 값이 아니라 이
// 컴퓨터가 허락한 것이다: 이 컴퓨터가 자기 표(기기의 key로 찾는다)에서 읽으므로 컴퓨터마다 다르다.
export const rosterList = defineMemory({
  resource: "roster",
  method: "list",
  name: "roster.list",
  reads: ["remote_devices"],
  input: z.strictObject({}),
  output: z.strictObject({
    this: deviceIdSchema.nullable(),
    removed_at: atSchema.nullable(),
    devices: z.array(
      z.strictObject({
        id: deviceIdSchema,
        key: keyTextSchema,
        kind: rosterKindSchema,
        name: deviceNameSchema,
        os: rosterEntryBodySchema.shape.os,
        machine: machineIdSchema.nullable(),
        terminal_input: z.boolean(),
        this: z.boolean(),
        pending: z.boolean(),
        disputed: z.boolean(),
        last_connected_at: atSchema.nullable(),
      }),
    ),
  }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 초대장을 낸다. `kind`는 들일 기기의 종류이고(사람이 폰과 컴퓨터 가운데 고른다) 다른 종류는 그 초대장으로 들지 못한다.
// 수명은 short(`ROSTER_INVITE_SHORT_MS`)와 long(`ROSTER_INVITE_LONG_MS`. 새 기기가 이 컴퓨터와 같은 때 켜질 수 없을 때).
// remote가 꺼져 있으면 unavailable이다. `terminal_input`은 초대하는 이 컴퓨터가 기기를 받아들일 때 자기 표에 적는 허락이다(명단에는 실리지
// 않고 다른 컴퓨터는 모른다).
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
  input: z.strictObject({
    text: z.string().min(1).max(16384),
    // 합류하는 컴퓨터가 초대한 컴퓨터에 터미널 입력을 허락하는가(생략하면 켬. 초대장의 기본과 같다).
    terminal_input: z.boolean().optional(),
  }),
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

// 기기를 명단에서 뺀다(서명한 빼기). 이 컴퓨터 자신이면 invalid_input이다. 뺀 key는 다시 들지 못한다. `disputed`인 기기(정해지지
// 않은 빼기로 빠진 기기)도 뺄 수 있다. `id`나 `key` 하나로 고른다. 엇갈린 줄의 id는 빠진 서명자가 단 것일 수 있어 화면은 그 줄을
// key로 빼고, id가 두 줄에 맞으면 conflict다.
export const rosterRemove = defineMemory({
  resource: "roster",
  method: "remove",
  name: "roster.remove",
  changes: [{ name: "remote_devices", id: (_input, output) => output.id }],
  input: z
    .strictObject({
      id: deviceIdSchema.optional(),
      key: keyTextSchema.optional(),
    })
    .refine((input) => (input.id === undefined) !== (input.key === undefined), {
      message: "give either id or key",
    }),
  output: z.strictObject({ id: deviceIdSchema }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

// 기기의 터미널 입력 허락을 바꾼다. 이 컴퓨터의 허락 표만 고친다. 명단에 statement를 내지 않아 다른 컴퓨터에는 닿지 않는다.
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

// 저장한 명단(statement와 주소). core 안 machine 자격만 읽는다. `adopt`는 옛 기기 표에서 옮긴 폰 행 가운데 명단에 그 key의
// statement가 하나도 없는 것이다: main thread가 서명 key를 가진 첫 때 이 컴퓨터가 그대로(id, key, 이름, 허락) 서명한다.
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
      adopt: z.array(
        z.strictObject({
          id: deviceIdSchema,
          key: keyTextSchema,
          name: deviceNameSchema,
          os: remoteDeviceSchema.shape.os,
          terminal_input: z.boolean(),
        }),
      ),
    }),
  ),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 저장할 명단을 통째로 둔다. main thread가 서명하고 합쳐 정한 뒤 부른다. `folds`는 같은 key의 여러 id를 접은 것이고
// 같은 write에서 그 id를 쓰는 곳을 고친다. `removed`는 view의 정해진 빼기가 뺀 key다(keep은 빠진 기기의 항목도 남겨 statement만으로는
// 모른다). 같은 write에서 그 기기 행을 지운다. `names`는 view의 기기 이름이고 기기 행의 `alias`(이 컴퓨터가 보이는 이름)에 둔다.
// core 안 machine 자격만 낸다.
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
    removed: z.array(keyTextSchema).max(ROSTER_STATEMENTS_MAX),
    names: z
      .array(z.strictObject({ key: keyTextSchema, name: deviceNameSchema }))
      .max(ROSTER_STATEMENTS_MAX),
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

// 다른 기계의 route 하나를 이 컴퓨터 core의 연결로 부른다. `machine`은 컴퓨터 이름, `mch_`, `dev_` 가운데 하나다(화면은 `mch_`를 준다).
// `mch_`·`dev_`로 시작하는 글은 id로만 찾는다(id를 먼저 시도하고 이름으로는 찾지 않는다). 이름이 id처럼 생긴 컴퓨터는 그 id로만 닿는다.
// 받는 기계는 `device:<이 컴퓨터의 id>`인 컴퓨터가 부른 것으로 보고, 요청한 쪽(call frame의 `by`)으로 지금의 기기 route 목록을
// 거르고 그 종류마다 대한다. 요청한 쪽은 core가 부른 자격으로 정한다. 살아 있는 `shell_capability`면 `screen`(이 기계의 화면),
// 칸이 없으면 사람의 CLI token이라 `terminal`이고, 있는데 살아 있지 않으면 forbidden이다. 입력의 다른 칸으로 요청한 쪽을 싣는 길은 없다.
// 답은 그 기계의 value이고 오류(code, message, details)도 그대로다. 그래서 일곱 code가 다 날 수 있다.
// 연결이 없으면 unavailable, 명단에 없는 기계면 not_found, 같은 이름이 둘이면 invalid_input(`details.candidates`)이다.
export const machinesCall = defineMemory({
  resource: "machines",
  method: "call",
  name: "machines.call",
  input: z.strictObject({
    machine: machineRefSchema,
    resource: z.string().min(1),
    method: z.string().min(1),
    body: z.unknown(),
    shell_capability: z.string().min(1).optional(),
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

// 구독은 화면의 것이라 살아 있는 `shell_capability`가 늘 필요하다(이 core 안 구독자는 이 route를 거치지 않고 link의 watch를 바로 부른다).
// 다른 기계의 Gateway 조건 가운데 한 구독자(이 shell의 `watcher`)의 것을 통째로 바꾼다(빈 배열은 그 구독자를 뺀다). core는
// 구독자들의 합을 그 기계에 건다. 그 기계의 frame은 이 컴퓨터의 bus에 `MachineFrameReceived`로 온다.
export const machinesWatch = defineMemory({
  resource: "machines",
  method: "watch",
  name: "machines.watch",
  input: z.strictObject({
    machine: machineIdSchema,
    // shell 안의 구독자 이름(창이면 `w<webContents id>`). 그 구독자가 바꾼 합에 답한 `ready`가 이 이름을 단다.
    watcher: z.string().min(1).max(64),
    conditions: z.array(eventConditionSchema).max(64),
    shell_capability: z.string().min(1),
  }),
  output: z.strictObject({}),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

// agent runtime이 그 agent에 할당된 다른 기계 앱의 command 목록을 읽는다. core가 그 agent 대신 읽으므로 요청한 쪽은
// `{kind:"agent", session: null}`이고, 닿지 않거나 거절한 앱의 `view`는 null이다. core 안 machine 자격만 낸다.
export const machinesAppTools = defineMemory({
  resource: "machines",
  method: "app_tools",
  name: "machines.app_tools",
  input: z.strictObject({
    agent: agentIdSchema,
    workspace: workspaceSchema.nullable(),
  }),
  output: z.strictObject({
    machines: z.array(machineCandidateSchema),
    apps: z.array(
      z.strictObject({
        machine: machineIdSchema,
        app: appIdSchema,
        name: z.string().min(1),
        view: appTools.output.nullable(),
      }),
    ),
  }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});
