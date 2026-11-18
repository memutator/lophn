// 기기 표 `devices`(이 컴퓨터에 붙은 폰의, 이 컴퓨터만의 칸: push, 기준, 화면, 마지막 연결, 마지막으로 받은 알린 이름)와 명단 표,
// 그 command·read. 종류, 이름, 터미널 입력 허락은 명단이 든다. `kind`(늘 phone)·`alias`·`terminal_input` 칸은 표를 다시 만들지
// 않으려 남겼고, 옮긴 폰 행의 별명과 허락을 이 컴퓨터가 처음 서명할 때만 읽는다(rosterStatements의 `adopt`).
// writer·reader Worker에서 돈다. 명단의 믿음 계산과 서명은 main thread가 한다(remote/roster.ts). 여기는 정한 것을 저장한다.
import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import { pushPrefsSchema } from "../../protocol/attention/mod.ts";
import {
  devicesClearPush,
  devicesConnected,
  devicesList,
  devicesPushTargets,
  devicesSetPrimary,
  devicesSetPush,
  type RemoteDevice,
  type RemotePhone,
  type RosterEntryBody,
  type RosterReach,
  type RosterStatement,
  remoteDeviceSchema,
  rosterForgetAll,
  rosterStatements,
  rosterStore,
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

// 내 기기 명단. statement는 canonical 글 하나가 한 행이고 `key`는 그 body의 key다. 주소는 기기마다 한 행(JSON)이다.
// 옛 기기 표의 phone 행은 SQL이 서명하지 못해 여기서 옮기지 않는다: 명단에 그 key의 statement가 하나도 없는 행이 "이 컴퓨터가
// 서명할 것"이고, main thread가 서명 key를 가진 첫 때(listener·relay를 열기 전) 그 행마다 항목(id, key, 이름, 허락 그대로)에
// 서명해 저장한다. desktop 행은 그 key가 shell main의 것이고 없어지므로 지운다. 낸 step 목록의 끝에 붙어야 해서 WIRINGS 맨 뒤
// wiring(remote)의 schemaStepsAfterTeams 끝에 둔다.
export const ROSTER_SCHEMA_STEPS: readonly SchemaStep[] = [
  {
    id: "remote.roster",
    sql: `
create table roster_statements (
  text text primary key,
  key text not null
) strict;
create index roster_statements_key on roster_statements (key);
create table roster_reach (
  device text primary key,
  body text not null
) strict;
delete from devices where kind = 'desktop';`,
  },
];

// commit 뒤 main thread가 할 일(설정 `shell.devices` 고치기). 설정은 writer Worker 밖에 있다.
export const DEVICES_TOPIC = "remote.devices";
export type DevicesChange =
  | { type: "registered"; id: string; name: string; phone: RemotePhone }
  | { type: "revoked"; id: string }
  | { type: "folded"; from: string; to: string };

// 설정 `shell.devices`의 항목. 이 컴퓨터에 붙은 폰의 항목만 `device`(기기 id)가 있다.
type Screen = { name: string; device?: string };

// 이름은 항목 사이에서 겹치지 않아야 한다. 겹치면 " 2", " 3"…을 붙이고 이름 상한을 넘지 않게 앞을 줄인다.
// 명단의 이름은 항목 이름 상한보다 길 수 있어 먼저 상한으로 자른다.
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

// 이 컴퓨터에 처음 붙은 폰의 항목을 더한다. 같은 이름의 다른 항목(다른 폰, 사람이 넣은 항목)은 그대로 두고 새 항목 이름을 바꾼다.
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

export function screensFolded<T extends Screen>(
  list: readonly T[],
  from: string,
  to: string,
): T[] {
  return list.map((each) =>
    each.device === from ? { ...each, device: to } : each,
  );
}

// 기기 자격의 principal은 `device:<id>`다(call.ts devicePrincipal).
const DEVICE_PRINCIPAL = "device:";

function storedStatements(sql: Pick<Sql, "all">): RosterStatement[] {
  return sql
    .all("select text from roster_statements order by text", [])
    .map((row) => JSON.parse(row.text as string) as RosterStatement);
}

// 컴퓨터가 서명한 항목 가운데 key마다 앞서는 것(rev가 큰 것, 같으면 허락을 끈 것, 같으면 body 글이 작은 것). 저장한 명단은
// main thread가 계산한 keep이라 남은 기기마다 이 컴퓨터가 서명한 이긴 항목이 들어 있다. 기기 표 읽기가 이름과 허락을 여기서 얻는다.
function entriesByKey(
  statements: readonly RosterStatement[],
): Map<string, RosterEntryBody> {
  const best = new Map<string, RosterEntryBody>();
  for (const statement of statements) {
    if (!("by" in statement) || statement.body.type !== "entry") continue;
    const body = statement.body;
    const other = best.get(body.key);
    const order =
      other === undefined
        ? -1
        : other.rev - body.rev ||
          Number(body.terminal_input) - Number(other.terminal_input) ||
          (canonicalize(body) < canonicalize(other) ? -1 : 1);
    if (order < 0) best.set(body.key, body);
  }
  return best;
}

// 아직 서명하지 않은 옮긴 행의 이름은 옛 이름(별명이 있으면 별명)이다.
const oldName = (row: Record<string, unknown>) =>
  (row.alias as string | null) ?? (row.name as string);

function rowOf(
  row: Record<string, unknown>,
  entries: ReadonlyMap<string, RosterEntryBody>,
): RemoteDevice {
  return {
    id: row.id as RemoteDevice["id"],
    name: entries.get(row.public_key as string)?.name ?? oldName(row),
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

function exists(sql: Pick<Sql, "get">, id: string): Result<void> {
  return sql.get("select 1 from devices where id = ?", [id]) === undefined
    ? err({ code: "not_found", message: "device not found" })
    : ok(undefined);
}

function push(tx: Pick<Tx, "port">, change: DevicesChange): void {
  tx.port(afterCommit).push(DEVICES_TOPIC, change);
}

function remove(tx: Pick<Tx, "sql" | "port">, id: string): void {
  tx.sql.run("delete from devices where id = ?", [id]);
  push(tx, { type: "revoked", id });
}

// 알린 이름과 마지막 연결을 적는다. 이 컴퓨터에 처음 붙는 폰(행이 없고 hello가 화면을 실었다)은 행을 만든다: 명단에서 그 id의
// key를 찾고, 새 폰이 기준이 된다.
const connected: CommandDefinition<typeof devicesConnected> = {
  route: devicesConnected,
  handle(tx, _ctx, input) {
    const now = tx.now();
    const row = tx.sql.get("select name from devices where id = ?", [input.id]);
    if (row !== undefined) {
      tx.sql.run(
        "update devices set last_connected_at = ?, name = ?, name_announced_at = ? where id = ?",
        [now, input.name, now, input.id],
      );
      return ok({ id: input.id, renamed: row.name !== input.name });
    }
    const key = storedStatements(tx.sql).find(
      (statement) =>
        "by" in statement &&
        statement.body.type === "entry" &&
        statement.body.id === input.id,
    )?.body.key;
    if (input.phone === undefined || key === undefined) {
      return err({ code: "not_found", message: "device not found" });
    }
    const { os, width, height, dpr } = input.phone;
    tx.sql.run("update devices set is_primary = 0 where is_primary = 1", []);
    tx.sql.run(
      `insert into devices (id, kind, name, name_announced_at, os, width, height, dpr, public_key, created_at,
         last_connected_at, is_primary, terminal_input)
       values (?, 'phone', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
      [input.id, input.name, now, os, width, height, dpr, key, now, now],
    );
    push(tx, {
      type: "registered",
      id: input.id,
      name: input.name,
      phone: input.phone,
    });
    return ok({ id: input.id, renamed: false });
  },
};

// 접힌 기기 id를 쓰는 다른 표(앱 sync log)를 고친다. remote는 바닥 module이라 그 표의 module을 import하지 않고 조립이 넘긴다.
export type DeviceFold = (
  sql: Pick<Sql, "run">,
  from: string,
  to: string,
) => void;

// main thread가 서명하고 합쳐 정한 명단(keep)을 통째로 둔다. 같은 write에서:
// - 접힌 id(같은 key의 큰 id → 작은 id)로 기기 행과 다른 표의 기기 칸(fold)을 바꾼다. 접힘은 큰 id의 항목이 남는 동안 저장마다
//   다시 오므로 다시 해도 같다.
// - 명단에서 빠진 기기(서명한 항목이 남지 않은 key)의 행을 지운다. push token도 같이 간다.
export const rosterStoreCommand = (
  fold: DeviceFold,
): CommandDefinition<typeof rosterStore> => ({
  route: rosterStore,
  handle(tx, _ctx, input) {
    tx.sql.run("delete from roster_statements", []);
    for (const statement of input.statements) {
      tx.sql.run(
        "insert or ignore into roster_statements (text, key) values (?, ?)",
        [canonicalize(statement), statement.body.key],
      );
    }
    tx.sql.run("delete from roster_reach", []);
    for (const reach of input.reach) {
      tx.sql.run(
        "insert or replace into roster_reach (device, body) values (?, ?)",
        [reach.device, JSON.stringify(reach)],
      );
    }
    for (const { from, to } of input.folds) {
      fold(tx.sql, from, to);
      const moved = tx.sql.run(
        "update or ignore devices set id = ? where id = ?",
        [to, from],
      );
      if (Number(moved.changes) > 0) push(tx, { type: "folded", from, to });
    }
    const kept = entriesByKey(input.statements);
    for (const row of tx.sql.all("select id, public_key from devices", [])) {
      if (!kept.has(row.public_key as string)) remove(tx, row.id as string);
    }
    return ok({ count: input.statements.length });
  },
});

// 명단과 이 컴퓨터의 기기 행을 모두 버린다. 행마다 revoked를 내어 `shell.devices`가 따라간다.
const forgetAll: CommandDefinition<typeof rosterForgetAll> = {
  route: rosterForgetAll,
  handle(tx) {
    tx.sql.run("delete from roster_statements", []);
    tx.sql.run("delete from roster_reach", []);
    const rows = tx.sql.all("select id from devices", []);
    for (const row of rows) remove(tx, row.id as string);
    return ok({ count: rows.length });
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
    const found = exists(tx.sql, id);
    if (!found.ok) return found;
    tx.sql.run(
      "update devices set push_token = ?, push_prefs = ? where id = ?",
      [input.token, JSON.stringify(input.prefs), id],
    );
    return ok({ id: id as RemoteDevice["id"] });
  },
};

const clearPush: CommandDefinition<typeof devicesClearPush> = {
  route: devicesClearPush,
  handle(tx, _ctx, input) {
    const found = exists(tx.sql, input.id);
    if (!found.ok) return found;
    tx.sql.run(
      "update devices set push_token = null where id = ? and push_token = ?",
      [input.id, input.token],
    );
    return ok({ id: input.id });
  },
};

const setPrimary: CommandDefinition<typeof devicesSetPrimary> = {
  route: devicesSetPrimary,
  handle(tx, _ctx, input) {
    const found = exists(tx.sql, input.id);
    if (!found.ok) return found;
    tx.sql.run(
      "update devices set is_primary = case when id = ? then 1 else 0 end",
      [input.id],
    );
    return ok({ id: input.id });
  },
};

export const DEVICES_COMMANDS = [
  connected,
  forgetAll,
  setPush,
  clearPush,
  setPrimary,
] as const;

export const devicesListRead: ReadDefinition<typeof devicesList> = {
  route: devicesList,
  handle(snapshot) {
    const entries = entriesByKey(storedStatements(snapshot.sql));
    const devices = snapshot.sql
      .all("select * from devices order by created_at, id", [])
      .map((row) => rowOf(row, entries));
    return ok({ devices, as_of_seq: snapshot.as_of_seq, next_cursor: null });
  },
};

export const rosterStatementsRead: ReadDefinition<typeof rosterStatements> = {
  route: rosterStatements,
  handle(snapshot) {
    const reach = snapshot.sql
      .all("select body from roster_reach order by device", [])
      .map((row) => JSON.parse(row.body as string) as RosterReach);
    const statements = storedStatements(snapshot.sql);
    const mentioned = new Set(statements.map((each) => each.body.key));
    const adopt = snapshot.sql
      .all("select * from devices order by created_at, id", [])
      .filter((row) => !mentioned.has(row.public_key as string))
      .map((row) => ({
        id: row.id as RemoteDevice["id"],
        key: row.public_key as string,
        name: oldName(row),
        os: row.os as RemoteDevice["os"],
        terminal_input: Number(row.terminal_input) === 1,
      }));
    return ok({
      statements,
      reach,
      adopt,
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
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
