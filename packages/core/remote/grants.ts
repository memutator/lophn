// 이 컴퓨터가 터미널 입력을 허락한 기기의 표 `remote_grants`와 그 command·read, 입력마다 동기로 묻는 메모리 사본. 허락은 받는
// 컴퓨터가 정한다: 명단은 누가 내 기기인지만 말하고 서명한 값은 명단의 컴퓨터 누구나 다시 서명할 수 있어 경계가 되지 못한다. key는
// 명단 항목의 key(host key 글)라 같은 기기가 새 key로 다시 들면 다시 켠다. 명단으로 퍼지지 않고 서명하지 않는다.
// writer·reader Worker에서 도는 표와 main thread의 사본이 한 file에 있다.
import { ok, type Result } from "../../base/mod.ts";
import {
  rosterGrants,
  rosterGrantSet,
  rosterGrantsSeed,
} from "../../protocol/remote/grants.ts";
import type {
  CommandDefinition,
  ReadDefinition,
  SchemaStep,
} from "../../protocol/server/mod.ts";

// `remote_grants_seed`는 옛 명단 칸에서 옮기기를 했다는 표지(한 행)다. 낸 step 목록의 끝에 붙어야 해서 WIRINGS 맨 뒤
// wiring(remote)의 schemaStepsAfterTeams 끝에 둔다.
export const GRANTS_SCHEMA_STEPS: readonly SchemaStep[] = [
  {
    id: "remote.grants",
    sql: `
create table remote_grants (
  key text primary key,
  granted_at text not null
) strict;
create table remote_grants_seed (
  id integer primary key check (id = 1)
) strict;`,
  },
];

const grantSet: CommandDefinition<typeof rosterGrantSet> = {
  route: rosterGrantSet,
  handle(tx, _ctx, input) {
    if (input.on) {
      tx.sql.run(
        "insert or ignore into remote_grants (key, granted_at) values (?, ?)",
        [input.key, tx.now()],
      );
    } else {
      tx.sql.run("delete from remote_grants where key = ?", [input.key]);
    }
    return ok({ key: input.key });
  },
};

const grantsSeed: CommandDefinition<typeof rosterGrantsSeed> = {
  route: rosterGrantsSeed,
  handle(tx, _ctx, input) {
    if (tx.sql.get("select 1 from remote_grants_seed", []) !== undefined) {
      return ok({ written: false });
    }
    for (const key of input.keys) {
      tx.sql.run(
        "insert or ignore into remote_grants (key, granted_at) values (?, ?)",
        [key, tx.now()],
      );
    }
    tx.sql.run("insert into remote_grants_seed (id) values (1)", []);
    return ok({ written: true });
  },
};

export const GRANTS_COMMANDS = [grantSet, grantsSeed] as const;

export const grantsRead: ReadDefinition<typeof rosterGrants> = {
  route: rosterGrants,
  handle(snapshot) {
    return ok({
      keys: snapshot.sql
        .all("select key from remote_grants order by key", [])
        .map((row) => row.key as string),
      seeded:
        snapshot.sql.get("select 1 from remote_grants_seed", []) !== undefined,
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
  },
};

export type GrantsDeps = {
  // `roster/grants`, `roster/grant_set`, `roster/grants_seed`(machine 자격).
  load(): Promise<Result<{ keys: string[]; seeded: boolean }>>;
  set(key: string, on: boolean): Promise<Result<void>>;
  seed(keys: string[]): Promise<Result<void>>;
};

// 메모리 사본. 터미널 입력마다 동기로 묻기 때문에 command가 끝난 뒤에 같이 고친다.
export function createGrants(deps: GrantsDeps) {
  let held = new Set<string>();
  let seeded = false;

  async function load(): Promise<Result<void>> {
    const read = await deps.load();
    if (!read.ok) return read;
    held = new Set(read.value.keys);
    seeded = read.value.seeded;
    return ok(undefined);
  }

  return {
    // key가 undefined인 기기(명단에 없다)는 허락이 없다.
    has: (key: string | undefined) => key !== undefined && held.has(key),
    seeded: () => seeded,
    load,

    async set(key: string, on: boolean): Promise<Result<void>> {
      if (held.has(key) === on) return ok(undefined);
      const done = await deps.set(key, on);
      if (!done.ok) return done;
      if (on) held.add(key);
      else held.delete(key);
      return ok(undefined);
    },

    // 표지가 없을 때만 쓴다(있으면 command가 쓰지 않는다). 쓴 뒤 표를 다시 읽는다.
    async seed(keys: string[]): Promise<Result<void>> {
      const done = await deps.seed(keys);
      return done.ok ? load() : done;
    },

    // 표를 비운 뒤(`roster/forget_all`) 사본도 비운다. 표지는 둔다.
    clear(): void {
      held = new Set();
    },
  };
}

export type Grants = ReturnType<typeof createGrants>;
