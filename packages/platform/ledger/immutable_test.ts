import { assert, assertEquals, assertThrows } from "@std/assert";
import { constants, DatabaseSync } from "node:sqlite";
import { manualClock, sha256Hex } from "../../base/mod.ts";
import { applyMigrations } from "../backup-and-migration/mod.ts";
import { LEDGER_SCHEMA_STEPS } from "./schema.ts";
import { configure, createSql, isSqlRejected } from "./sqlite.ts";

const AT = "2026-01-01T00:00:00.000Z";
const COMMON_HASH =
  "2244b9d070f7cbf6f71284e312455b167d0cdaceb26e94ac0d4523e231bdf005";
const clock = () => manualClock(Date.parse(AT));

// 이전 bootstrap을 재현한다. 새 bootstrap을 쓰면 upgrade 전 보호를 검증하지 못한다.
const HISTORY_SCHEMA = `
create table schema_migrations (
  version integer primary key,
  step_id text not null,
  content_hash text not null,
  applied_at text not null
);
create trigger schema_migrations_no_update before update on schema_migrations
begin select raise(abort, 'immutable'); end;
create trigger schema_migrations_no_delete before delete on schema_migrations
begin select raise(abort, 'immutable'); end;`;

function rows(db: DatabaseSync, table: string) {
  return db.prepare(`select * from ${table} order by 1, 2`).all();
}

function seed(db: DatabaseSync) {
  db.prepare(
    "insert into events (seq, type, subject, actor, run, payload, at) values (1, 'Created', 'thing:1', 'user', 'run:1', '{\"name\":\"original\"}', ?)",
  ).run(AT);
  db.prepare(
    "insert into command_results values ('user', 'key', 'fingerprint', '{\"value\":\"original\"}', 1, 1, ?)",
  ).run(AT);
}

function attackDuplicates(db: DatabaseSync) {
  const tables = [
    { name: "events", key: "seq", change: "payload = 'changed'" },
    {
      name: "command_results",
      key: "principal, idempotency_key",
      change: "result = 'changed'",
    },
    {
      name: "schema_migrations",
      key: "version",
      change: "content_hash = 'changed'",
    },
  ];
  for (const table of tables) {
    const before = rows(db, table.name);
    const columns = Object.keys(before[0]).join(", ");
    const source = `select ${columns} from ${table.name} where 1 limit 1`;
    const changedColumn = table.change.split(" = ")[0];
    const changedSource = `select ${
      Object.keys(before[0]).map((column) =>
        column === changedColumn ? "'changed'" : column
      ).join(", ")
    } from ${table.name} where 1 limit 1`;
    const attacks = [
      `insert or replace into ${table.name} (${columns}) ${changedSource}`,
      `replace into ${table.name} (${columns}) ${changedSource}`,
      `insert or replace into ${table.name} (${columns}) ${source}`,
      `replace into ${table.name} (${columns}) ${source}`,
      `insert into ${table.name} (${columns}) ${source} on conflict (${table.key}) do update set ${table.change}`,
      `insert into ${table.name} (${columns}) ${source} on conflict (${table.key}) do update set ${
        columns.split(", ")[0]
      } = excluded.${columns.split(", ")[0]}`,
      `insert into ${table.name} (${columns}) ${source} on conflict (${table.key}) do nothing`,
    ];
    for (const sql of attacks) {
      assertThrows(() => db.exec(sql), Error, "immutable");
      assertEquals(rows(db, table.name), before);
    }
  }
}

for (const upgrade of [false, true]) {
  Deno.test(
    `platform/ledger#R10 platform/backup-and-migration#R1 #R5: ${
      upgrade ? "common-tables DB upgrade" : "새 DB"
    }는 REPLACE·UPSERT를 막고 원본을 보존한다`,
    async () => {
      const dir = await Deno.makeTempDir({ prefix: "lophn-immutable-" });
      const path = `${dir}/ledger.db`;
      let db: DatabaseSync | undefined;
      try {
        assertEquals(LEDGER_SCHEMA_STEPS[0].id, "common-tables");
        assertEquals(await sha256Hex(LEDGER_SCHEMA_STEPS[0].sql), COMMON_HASH);
        assertEquals(LEDGER_SCHEMA_STEPS[1].id, "immutable-insert-guards");
        db = new DatabaseSync(path);
        assert(configure(db).ok);
        if (upgrade) {
          db.exec(HISTORY_SCHEMA);
          db.exec(LEDGER_SCHEMA_STEPS[0].sql);
          db.prepare("insert into schema_migrations values (1, ?, ?, ?)").run(
            "common-tables",
            COMMON_HASH,
            AT,
          );
          seed(db);
        }
        const before = upgrade
          ? {
            events: rows(db, "events"),
            results: rows(db, "command_results"),
            history: rows(db, "schema_migrations"),
            schema: db.prepare(
              "select name, sql from sqlite_master where type in ('table', 'index', 'trigger') order by name",
            ).all(),
          }
          : undefined;
        db.close();
        db = undefined;
        assert(
          (await applyMigrations(path, LEDGER_SCHEMA_STEPS, {
            clock: clock(),
          })).ok,
        );
        db = new DatabaseSync(path);
        assert(configure(db).ok);
        assertEquals(
          db.prepare("pragma journal_mode").get()?.journal_mode,
          "wal",
        );
        if (before) {
          assertEquals(rows(db, "events"), before.events);
          assertEquals(rows(db, "command_results"), before.results);
          assertEquals(
            rows(db, "schema_migrations").slice(0, 1),
            before.history,
          );
        } else {
          seed(db);
        }
        const history = rows(db, "schema_migrations");
        assertEquals(history.length, LEDGER_SCHEMA_STEPS.length);
        assertEquals(history[0].content_hash, COMMON_HASH);
        assertEquals(
          history[1].content_hash,
          await sha256Hex(LEDGER_SCHEMA_STEPS[1].sql),
        );
        const master = db.prepare(
          "select name, sql from sqlite_master where type in ('table', 'index', 'trigger') and name not like '%no_duplicate_insert' and name not like '%question_evidence%' and name not like '%blob_refs%' and name not like '%erase_windows%' order by name",
        ).all();
        if (before) assertEquals(master, before.schema);
        attackDuplicates(db);
        for (
          const table of ["events", "command_results", "schema_migrations"]
        ) {
          assertThrows(
            () =>
              db!.exec(
                `update ${table} set ${Object.keys(rows(db!, table)[0])[0]} = ${
                  Object.keys(rows(db!, table)[0])[0]
                }`,
              ),
            Error,
            "immutable",
          );
          assertThrows(
            () => db!.exec(`delete from ${table}`),
            Error,
            "immutable",
          );
        }
        db.exec("pragma recursive_triggers=OFF");
        assertEquals(
          Number(
            db.prepare("pragma recursive_triggers").get()?.recursive_triggers,
          ),
          0,
        );
        attackDuplicates(db);
        assertEquals(
          db.prepare(
            "select name, sql from sqlite_master where type in ('table', 'index', 'trigger') and name not like '%no_duplicate_insert' and name not like '%question_evidence%' and name not like '%blob_refs%' and name not like '%erase_windows%' order by name",
          ).all(),
          master,
        );
        db.prepare(
          "insert into command_results values (?, ?, 'f', '{}', 1, 1, ?)",
        ).run("other", "key", AT);
        db.prepare(
          "insert into command_results values (?, ?, 'f', '{}', 1, 1, ?)",
        ).run("user", "new-key", AT);
        db.prepare(
          "insert into events (type, actor, payload, at) values ('Next', 'user', '{}', ?)",
        ).run(AT);
        assertEquals(rows(db, "events").length, 2);
        assertEquals(rows(db, "command_results").length, 3);
        db.close();
        db = undefined;
        assert(
          (await applyMigrations(path, [
            ...LEDGER_SCHEMA_STEPS,
            {
              id: "owner-table",
              sql: "create table owner_data (id integer primary key)",
            },
          ], { clock: clock() })).ok,
        );
        db = new DatabaseSync(path);
        assertEquals(
          rows(db, "schema_migrations").slice(0, history.length),
          history,
        );
        assertEquals(
          rows(db, "schema_migrations").length,
          history.length + 1,
        );
      } finally {
        db?.close();
        await Deno.remove(dir, { recursive: true });
      }
    },
  );
}

Deno.test(
  "platform/ledger#R2: native authorizer가 recursive trigger 설정을 무시하면 실제 0 readback으로 기동을 거절한다",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "lophn-pragma-" });
    const db = new DatabaseSync(`${dir}/ledger.db`);
    try {
      db.exec("pragma recursive_triggers=OFF");
      // Deno 내장 native API는 있지만 현재 node:sqlite 선언에는 빠져 있다.
      const native = db as DatabaseSync & {
        setAuthorizer(
          callback: (
            action: number,
            name: string | null,
            value: string | null,
          ) => number,
        ): void;
      };
      const codes = constants as typeof constants & {
        SQLITE_PRAGMA: number;
        SQLITE_IGNORE: number;
        SQLITE_OK: number;
      };
      native.setAuthorizer((action, name, value) => {
        return action === codes.SQLITE_PRAGMA &&
            name === "recursive_triggers" && value !== null
          ? codes.SQLITE_IGNORE
          : codes.SQLITE_OK;
      });
      const refused = configure(db);
      assert(!refused.ok);
      assertEquals(refused.error.code, "unavailable");
      assertEquals(
        Number(
          db.prepare("pragma recursive_triggers").get()?.recursive_triggers,
        ),
        0,
      );
      assertEquals(
        db.prepare("pragma journal_mode").get()?.journal_mode,
        "wal",
      );
      assertEquals(
        Number(db.prepare("pragma synchronous").get()?.synchronous),
        2,
      );
      assertEquals(
        Number(db.prepare("pragma foreign_keys").get()?.foreign_keys),
        1,
      );
      assertEquals(
        Number(db.prepare("pragma busy_timeout").get()?.timeout),
        5000,
      );
      const sql = createSql(db, () => true);
      const rejected = assertThrows(() =>
        sql.run("pragma recursive_triggers=OFF", [])
      );
      assert(isSqlRejected(rejected));
    } finally {
      db.close();
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "platform/backup-and-migration#R6: common-tables hash 불일치는 upgrade guard 쓰기 전에 거절한다",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "lophn-history-" });
    const path = `${dir}/ledger.db`;
    const db = new DatabaseSync(path);
    try {
      assert(configure(db).ok);
      db.exec(HISTORY_SCHEMA);
      db.exec(LEDGER_SCHEMA_STEPS[0].sql);
      db.prepare(
        "insert into schema_migrations values (1, 'common-tables', 'wrong', ?)",
      ).run(AT);
      seed(db);
      const before = db.prepare(
        "select name, sql from sqlite_master order by name",
      ).all();
      const history = rows(db, "schema_migrations");
      const events = rows(db, "events");
      const results = rows(db, "command_results");
      const refused = await applyMigrations(path, LEDGER_SCHEMA_STEPS, {
        clock: clock(),
      });
      assert(!refused.ok);
      assertEquals(refused.error.code, "unavailable");
      assertEquals(
        db.prepare("select name, sql from sqlite_master order by name").all(),
        before,
      );
      assertEquals(rows(db, "schema_migrations"), history);
      assertEquals(rows(db, "events"), events);
      assertEquals(rows(db, "command_results"), results);
    } finally {
      db.close();
      await Deno.remove(dir, { recursive: true });
    }
  },
);
