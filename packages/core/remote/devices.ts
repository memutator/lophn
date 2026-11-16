// 기기 표 `devices`와 그 command·read. writer·reader Worker에서 돈다.
import { err, ok, type Result } from "../../base/mod.ts";
import { pushPrefsSchema } from "../../protocol/attention/mod.ts";
import {
  devicesClearPush,
  devicesConnected,
  devicesList,
  devicesPushTargets,
  devicesRegister,
  devicesRename,
  devicesRevoke,
  devicesSetPrimary,
  devicesSetPush,
  devicesSetTerminalInput,
  devicesUnpair,
  type RemoteDevice,
  remoteDeviceSchema,
} from "../../protocol/remote/mod.ts";
import type {
  CommandDefinition,
  ReadDefinition,
  SchemaStep,
  Sql,
  Tx,
} from "../../protocol/server/mod.ts";
import { afterCommit } from "../storage/ledger/mod.ts";

// 공개 key는 base64url 글자다(remoteKeyText). 기준 기기는 많아야 하나다.
export const DEVICES_SCHEMA_STEPS: readonly SchemaStep[] = [
  {
    id: "remote.devices",
    sql: `
create table devices (
  id text primary key,
  name text not null,
  os text not null check (os in ('ios', 'android')),
  width integer not null,
  height integer not null,
  dpr real not null,
  public_key text not null unique,
  created_at text not null,
  last_connected_at text,
  is_primary integer not null check (is_primary in (0, 1))
) strict;`,
  },
  // push token과 알림 설정은 기기의 것이라 기기 행의 칸이다. prefs는 JSON 글이고 읽을 때 pushPrefsSchema로 확인한다.
  {
    id: "remote.devices.push",
    sql: `
alter table devices add column push_token text;
alter table devices add column push_prefs text not null default '{}';`,
  },
  {
    id: "remote.devices.terminal_input",
    sql: `alter table devices add column terminal_input integer not null default 0 check (terminal_input in (0, 1));`,
  },
];

// kind를 더하고 os를 넓히고 화면 칸을 phone만의 것으로 하고 이름을 알린 이름(`name`)과 사람의 별명(`alias`)으로 나눈다. CHECK를
// 바꾸려 표를 다시 만든다. 이 표를 가리키는 FK와 따로 만든 index·trigger는 없다. 옛 행은 phone이고, 옛 `name`이 pairing 때 온
// 이름인지 사람이 바꾼 별명인지 알 수 없어 별명으로도 옮긴다. 낸 step 목록의 끝에 붙어야 해서 DEVICES_SCHEMA_STEPS가 아니라
// WIRINGS 맨 뒤 wiring(remote)의 schemaStepsAfterTeams 끝에 둔다.
export const DEVICES_KIND_STEPS: readonly SchemaStep[] = [
  {
    id: "remote.devices.kind",
    sql: `
create table devices_next (
  id text primary key,
  kind text not null check (kind in ('phone', 'desktop')),
  name text not null,
  alias text,
  name_announced_at text,
  os text not null check (os in ('ios', 'android', 'linux', 'macos', 'windows')),
  width integer,
  height integer,
  dpr real,
  public_key text not null unique,
  created_at text not null,
  last_connected_at text,
  is_primary integer not null check (is_primary in (0, 1)),
  push_token text,
  push_prefs text not null default '{}',
  terminal_input integer not null default 0 check (terminal_input in (0, 1)),
  check (
    (kind = 'phone' and os in ('ios', 'android')
      and width is not null and height is not null and dpr is not null)
    or (kind = 'desktop' and os in ('linux', 'macos', 'windows')
      and width is null and height is null and dpr is null
      and is_primary = 0 and push_token is null)
  )
) strict;
insert into devices_next (id, kind, name, alias, name_announced_at, os, width, height, dpr, public_key, created_at,
  last_connected_at, is_primary, push_token, push_prefs, terminal_input)
select id, 'phone', name, name, null, os, width, height, dpr, public_key, created_at,
  last_connected_at, is_primary, push_token, push_prefs, terminal_input from devices;
drop table devices;
alter table devices_next rename to devices;`,
  },
];

type DeviceKind = RemoteDevice["kind"];

// commit 뒤 main thread가 할 일(설정 `shell.devices` 고치기, 연결 닫기). 설정과 연결은 writer Worker 밖에 있다.
export const DEVICES_TOPIC = "remote.devices";
// `renamed`는 보이는 이름(별명이 있으면 별명)이 바뀔 때 그 이름을 싣는다.
export type DevicesChange =
  | { type: "registered"; id: string; kind: DeviceKind }
  | { type: "renamed"; id: string; name: string }
  | { type: "revoked"; id: string }
  | { type: "terminal_input"; id: string; on: boolean };

// 설정 `shell.devices`의 항목. pairing이 넣은 항목만 `device`(기기 id)가 있다.
type Screen = { name: string; device?: string };

// 이름은 항목 사이에서 겹치지 않아야 한다. 겹치면 " 2", " 3"…을 붙이고 이름 상한을 넘지 않게 앞을 줄인다.
// 별명은 항목 이름 상한보다 길 수 있어 먼저 상한으로 자른다.
function uniqueName(full: string, list: readonly Screen[]): string {
  const taken = new Set(list.map((each) => each.name));
  const max = remoteDeviceSchema.shape.name.maxLength ?? full.length;
  const name = full.slice(0, max);
  if (!taken.has(name)) return name;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = name.slice(0, max - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

// pairing한 폰의 항목을 더한다. 같은 이름의 다른 항목(다른 폰, 사람이 넣은 항목)은 그대로 두고 새 항목 이름을 바꾼다.
export function screensPaired<T extends Screen>(
  list: readonly T[],
  device: string,
  screen: T,
): T[] {
  const others = list.filter((each) => each.device !== device);
  return [
    ...others,
    { ...screen, name: uniqueName(screen.name, others), device },
  ];
}

export function screensRenamed<T extends Screen>(
  list: readonly T[],
  device: string,
  name: string,
): T[] {
  const others = list.filter((each) => each.device !== device);
  return list.map((each) =>
    each.device === device ? { ...each, name: uniqueName(name, others) } : each,
  );
}

export function screensRevoked<T extends Screen>(
  list: readonly T[],
  device: string,
): T[] {
  return list.filter((each) => each.device !== device);
}

// 기기 자격의 principal은 `device:<id>`다(call.ts devicePrincipal). unpair는 그 id 말고는 지울 길이 없다.
const DEVICE_PRINCIPAL = "device:";

// 터미널에 칠 수 있는 기기의 메모리 사본. terminal view가 입력마다 동기로 묻는다. main thread가 기동 때 표를 읽어 채우고
// commit 뒤 바뀜(DevicesChange)으로 고친다. 끄거나 끊은 command가 답하기 전에 고쳐지므로 다음 입력부터 거절이다.
export function createTerminalInputGrants() {
  const on = new Set<string>();
  return {
    load(devices: readonly RemoteDevice[]) {
      on.clear();
      for (const device of devices)
        if (device.terminal_input) on.add(device.id);
    },
    apply(change: DevicesChange) {
      if (change.type === "revoked") on.delete(change.id);
      else if (change.type === "terminal_input") {
        if (change.on) on.add(change.id);
        else on.delete(change.id);
      }
    },
    granted: (principal: string): boolean =>
      principal.startsWith(DEVICE_PRINCIPAL) &&
      on.has(principal.slice(DEVICE_PRINCIPAL.length)),
  };
}

// 기기 principal의 kind(`ctx.deviceKind`). 터미널 입력 허락과 같이 기동 때 표로 채우고 commit 뒤 바뀜으로 고친다.
export function createDeviceKinds() {
  const kinds = new Map<string, DeviceKind>();
  return {
    load(devices: readonly RemoteDevice[]) {
      kinds.clear();
      for (const device of devices) kinds.set(device.id, device.kind);
    },
    apply(change: DevicesChange) {
      if (change.type === "registered") kinds.set(change.id, change.kind);
      else if (change.type === "revoked") kinds.delete(change.id);
    },
    of: (principal: string): DeviceKind | null =>
      principal.startsWith(DEVICE_PRINCIPAL)
        ? (kinds.get(principal.slice(DEVICE_PRINCIPAL.length)) ?? null)
        : null,
  };
}

function rowOf(row: Record<string, unknown>): RemoteDevice {
  return {
    id: row.id as RemoteDevice["id"],
    kind: row.kind as DeviceKind,
    name: (row.alias as string | null) ?? (row.name as string),
    announced_name: row.name as string,
    alias: (row.alias as string | null) ?? null,
    os: row.os as RemoteDevice["os"],
    width: row.width === null ? null : Number(row.width),
    height: row.height === null ? null : Number(row.height),
    dpr: row.dpr === null ? null : Number(row.dpr),
    public_key: row.public_key as string,
    created_at: row.created_at as string,
    last_connected_at: (row.last_connected_at as string | null) ?? null,
    primary: Number(row.is_primary) === 1,
    terminal_input: Number(row.terminal_input) === 1,
  };
}

function load(sql: Pick<Sql, "get">, id: string): Result<RemoteDevice> {
  const row = sql.get("select * from devices where id = ?", [id]);
  return row === undefined
    ? err({ code: "not_found", message: "device not found" })
    : ok(rowOf(row));
}

function push(tx: Pick<Tx, "port">, change: DevicesChange): void {
  tx.port(afterCommit).push(DEVICES_TOPIC, change);
}

const register: CommandDefinition<typeof devicesRegister> = {
  route: devicesRegister,
  handle(tx, _ctx, input) {
    // host가 맞는 pairing code를 본 뒤에만 부른다. 같은 key의 옛 등록은 폰이 잊은 것이라 끊고 새 등록으로 바꾼다.
    const taken = tx.sql.get("select id from devices where public_key = ?", [
      input.public_key,
    ]);
    if (taken !== undefined) remove(tx, taken.id as string);
    const id = tx.newId("dev");
    // 새 phone이 기준이 된다. desktop은 기준이 되지 못하고 다른 기기의 기준도 그대로다.
    const phone = input.kind === "phone";
    if (phone)
      tx.sql.run("update devices set is_primary = 0 where is_primary = 1", []);
    tx.sql.run(
      `insert into devices (id, kind, name, os, width, height, dpr, public_key, created_at, last_connected_at, is_primary)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, null, ?)`,
      [
        id,
        input.kind,
        input.name,
        input.os,
        phone ? input.width : null,
        phone ? input.height : null,
        phone ? input.dpr : null,
        input.public_key,
        tx.now(),
        phone ? 1 : 0,
      ],
    );
    push(tx, { type: "registered", id, kind: input.kind });
    return ok({ id: id as RemoteDevice["id"] });
  },
};

const connected: CommandDefinition<typeof devicesConnected> = {
  route: devicesConnected,
  handle(tx, _ctx, input) {
    const found = load(tx.sql, input.id);
    if (!found.ok) return found;
    tx.sql.run("update devices set last_connected_at = ? where id = ?", [
      tx.now(),
      input.id,
    ]);
    return ok({ id: input.id });
  },
};

const rename: CommandDefinition<typeof devicesRename> = {
  route: devicesRename,
  handle(tx, _ctx, input) {
    const found = load(tx.sql, input.id);
    if (!found.ok) return found;
    if (found.value.alias === input.name) return ok({ id: input.id });
    tx.sql.run("update devices set alias = ? where id = ?", [
      input.name,
      input.id,
    ]);
    const shown = input.name ?? found.value.announced_name;
    if (shown !== found.value.name)
      push(tx, { type: "renamed", id: input.id, name: shown });
    return ok({ id: input.id });
  },
};

function remove(tx: Pick<Tx, "sql" | "port">, id: string): void {
  tx.sql.run("delete from devices where id = ?", [id]);
  push(tx, { type: "revoked", id });
}

const revoke: CommandDefinition<typeof devicesRevoke> = {
  route: devicesRevoke,
  handle(tx, _ctx, input) {
    const found = load(tx.sql, input.id);
    if (!found.ok) return found;
    remove(tx, input.id);
    return ok({ id: input.id });
  },
};

const unpair: CommandDefinition<typeof devicesUnpair> = {
  route: devicesUnpair,
  handle(tx, ctx, _input) {
    if (!ctx.principal.startsWith(DEVICE_PRINCIPAL)) {
      return err({
        code: "forbidden",
        message: "only a paired device removes its own registration",
      });
    }
    const id = ctx.principal.slice(DEVICE_PRINCIPAL.length);
    const found = load(tx.sql, id);
    if (!found.ok) return found;
    remove(tx, id);
    return ok({ id: found.value.id });
  },
};

const setPush: CommandDefinition<typeof devicesSetPush> = {
  route: devicesSetPush,
  handle(tx, ctx, input) {
    if (!ctx.principal.startsWith(DEVICE_PRINCIPAL)) {
      return err({
        code: "forbidden",
        message: "only a paired device sets its own push",
      });
    }
    const id = ctx.principal.slice(DEVICE_PRINCIPAL.length);
    const found = load(tx.sql, id);
    if (!found.ok) return found;
    if (found.value.kind !== "phone") {
      return err({ code: "forbidden", message: "only a phone sets push" });
    }
    tx.sql.run(
      "update devices set push_token = ?, push_prefs = ? where id = ?",
      [input.token, JSON.stringify(input.prefs), id],
    );
    return ok({ id: found.value.id });
  },
};

const clearPush: CommandDefinition<typeof devicesClearPush> = {
  route: devicesClearPush,
  handle(tx, _ctx, input) {
    const found = load(tx.sql, input.id);
    if (!found.ok) return found;
    tx.sql.run(
      "update devices set push_token = null where id = ? and push_token = ?",
      [input.id, input.token],
    );
    return ok({ id: input.id });
  },
};

const setTerminalInput: CommandDefinition<typeof devicesSetTerminalInput> = {
  route: devicesSetTerminalInput,
  handle(tx, _ctx, input) {
    const found = load(tx.sql, input.id);
    if (!found.ok) return found;
    if (found.value.terminal_input === input.on) return ok({ id: input.id });
    tx.sql.run("update devices set terminal_input = ? where id = ?", [
      input.on ? 1 : 0,
      input.id,
    ]);
    push(tx, { type: "terminal_input", id: input.id, on: input.on });
    return ok({ id: input.id });
  },
};

const setPrimary: CommandDefinition<typeof devicesSetPrimary> = {
  route: devicesSetPrimary,
  handle(tx, _ctx, input) {
    const found = load(tx.sql, input.id);
    if (!found.ok) return found;
    if (found.value.kind !== "phone") {
      return err({
        code: "invalid_input",
        message: "only a phone can be the primary device",
      });
    }
    tx.sql.run(
      "update devices set is_primary = case when id = ? then 1 else 0 end",
      [input.id],
    );
    return ok({ id: input.id });
  },
};

export const DEVICES_COMMANDS = [
  register,
  connected,
  rename,
  revoke,
  unpair,
  setPush,
  clearPush,
  setPrimary,
  setTerminalInput,
] as const;

export const devicesListRead: ReadDefinition<typeof devicesList> = {
  route: devicesList,
  handle(snapshot) {
    const devices = snapshot.sql
      .all("select * from devices order by created_at, id", [])
      .map(rowOf);
    return ok({ devices, as_of_seq: snapshot.as_of_seq, next_cursor: null });
  },
};

export const devicesPushTargetsRead: ReadDefinition<typeof devicesPushTargets> =
  {
    route: devicesPushTargets,
    handle(snapshot) {
      const devices = snapshot.sql
        .all(
          "select id, push_token, push_prefs from devices where push_token is not null order by created_at, id",
          [],
        )
        .flatMap((row) => {
          const prefs = pushPrefsSchema.safeParse(
            JSON.parse(row.push_prefs as string),
          );
          return prefs.success
            ? [
                {
                  id: row.id as RemoteDevice["id"],
                  token: row.push_token as string,
                  prefs: prefs.data,
                },
              ]
            : [];
        });
      return ok({ devices, as_of_seq: snapshot.as_of_seq, next_cursor: null });
    },
  };
