// 기기 표 `devices`와 그 command·read. writer·reader Worker에서 돈다.
import { err, ok, type Result } from "../../base/mod.ts";
import {
  devicesConnected,
  devicesList,
  devicesRegister,
  devicesRename,
  devicesRevoke,
  devicesSetPrimary,
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
];

// commit 뒤 main thread가 할 일(설정 `shell.devices` 고치기, 연결 닫기). 설정과 연결은 writer Worker 밖에 있다.
export const DEVICES_TOPIC = "remote.devices";
export type DevicesChange =
  | { type: "renamed"; id: string; name: string }
  | { type: "revoked"; id: string };

// 설정 `shell.devices`의 항목. pairing이 넣은 항목만 `device`(기기 id)가 있다.
type Screen = { name: string; device?: string };

// 이름은 항목 사이에서 겹치지 않아야 한다. 겹치면 " 2", " 3"…을 붙이고 이름 상한을 넘지 않게 앞을 줄인다.
function uniqueName(name: string, list: readonly Screen[]): string {
  const taken = new Set(list.map((each) => each.name));
  if (!taken.has(name)) return name;
  const max = remoteDeviceSchema.shape.name.maxLength ?? name.length;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = name.slice(0, max - suffix.length) + suffix;
    if (!taken.has(candidate)) return candidate;
  }
}

// pairing한 기기의 항목을 더한다. 같은 이름의 다른 항목(다른 폰, 사람이 넣은 항목)은 그대로 두고 새 항목 이름을 바꾼다.
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

function rowOf(row: Record<string, unknown>): RemoteDevice {
  return {
    id: row.id as RemoteDevice["id"],
    name: row.name as string,
    os: row.os as RemoteDevice["os"],
    width: Number(row.width),
    height: Number(row.height),
    dpr: Number(row.dpr),
    public_key: row.public_key as string,
    created_at: row.created_at as string,
    last_connected_at: (row.last_connected_at as string | null) ?? null,
    primary: Number(row.is_primary) === 1,
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
    const taken = tx.sql.get("select id from devices where public_key = ?", [
      input.public_key,
    ]);
    if (taken !== undefined) {
      return err({ code: "conflict", message: "device key already paired" });
    }
    const id = tx.newId("dev");
    tx.sql.run("update devices set is_primary = 0 where is_primary = 1", []);
    tx.sql.run(
      `insert into devices (id, name, os, width, height, dpr, public_key, created_at, last_connected_at, is_primary)
       values (?, ?, ?, ?, ?, ?, ?, ?, null, 1)`,
      [
        id,
        input.name,
        input.os,
        input.width,
        input.height,
        input.dpr,
        input.public_key,
        tx.now(),
      ],
    );
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
    if (found.value.name === input.name) return ok({ id: input.id });
    tx.sql.run("update devices set name = ? where id = ?", [
      input.name,
      input.id,
    ]);
    push(tx, { type: "renamed", id: input.id, name: input.name });
    return ok({ id: input.id });
  },
};

const revoke: CommandDefinition<typeof devicesRevoke> = {
  route: devicesRevoke,
  handle(tx, _ctx, input) {
    const found = load(tx.sql, input.id);
    if (!found.ok) return found;
    tx.sql.run("delete from devices where id = ?", [input.id]);
    push(tx, { type: "revoked", id: input.id });
    return ok({ id: input.id });
  },
};

const setPrimary: CommandDefinition<typeof devicesSetPrimary> = {
  route: devicesSetPrimary,
  handle(tx, _ctx, input) {
    const found = load(tx.sql, input.id);
    if (!found.ok) return found;
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
  setPrimary,
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
