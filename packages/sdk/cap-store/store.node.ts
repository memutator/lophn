// Node entry의 openStore다. 파일은 `node:sqlite`로 열고 session도 거기서 건다. host가 `store.open`을 주면
// 그 DB를 쓴다(session은 host가 맡는다).

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Migration,
  migrationOfSql,
} from "../../protocol/apps/activation/migration-sql.ts";
import {
  attachNewTables,
  closeConnection,
  openConnection,
} from "./connection.node.ts";
import { CapabilityError } from "./errors.ts";
import { readHost } from "./host.ts";
import {
  DEFAULT_DATABASE_FILE,
  invalid,
  makeStore,
  type OpenStoreOptions,
  type Store,
} from "./store.ts";

function path(options: OpenStoreOptions): string {
  if (options.path === ":memory:") return options.path;
  if (options.path !== undefined) return resolve(options.path);
  const host = options.host ?? readHost();
  if (!host) {
    throw new CapabilityError({
      code: "unavailable",
      message: "this code is not running inside a lophn app process",
    });
  }
  return resolve(host.dataPath, DEFAULT_DATABASE_FILE);
}

// host가 없는 앱 test는 앱 폴더(지금 폴더)의 단계 파일에서 읽는다.
function folderMigrations(): { target: number; steps: Migration[] } {
  const steps: Migration[] = [];
  for (const name of readdirSync("migrations")) {
    const match = /^(\d+)-(\d+)\.sql$/.exec(name);
    if (!match) continue;
    const step = migrationOfSql(
      Number(match[1]),
      Number(match[2]),
      readFileSync(`migrations/${name}`, "utf8"),
    );
    if (!step.ok) throw invalid(step.error.message);
    steps.push(step.value);
  }
  return {
    target: steps.reduce((high, step) => Math.max(high, step.to), 0),
    steps,
  };
}

export function openStore(options: OpenStoreOptions = {}): Store {
  const host = options.host ?? readHost();
  const now = options.now ?? (() => new Date().toISOString());
  if (host?.store?.open && options.path === undefined) {
    return makeStore({
      db: host.store.open(),
      host,
      now,
      fallbackMigrations: folderMigrations,
    });
  }
  const file = path(options);
  const db = openConnection(file);
  return makeStore({
    db,
    host,
    now,
    fallbackMigrations: folderMigrations,
    tablesChanged: () => attachNewTables(db),
    close: () => closeConnection(file),
  });
}
