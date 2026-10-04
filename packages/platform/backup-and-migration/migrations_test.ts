import { assert, assertEquals, assertThrows } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, sha256Hex } from "../../base/mod.ts";
import type { SchemaStep } from "../../contracts/platform/mod.ts";
import { applyMigrations } from "./mod.ts";

const START = Date.parse("2026-01-01T00:00:00.000Z");

const STEPS: SchemaStep[] = [
  {
    id: "notes",
    sql: "create table notes (id integer primary key, body text not null)",
  },
  { id: "notes-flag", sql: "alter table notes add column flag integer" },
];

async function tempDir(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "lophn-migrate-" });
}

function history(path: string): Record<string, unknown>[] {
  const db = new DatabaseSync(path, { readOnly: true });
  const rows = db.prepare(
    "select version, step_id, content_hash, applied_at from schema_migrations order by version",
  ).all();
  db.close();
  return rows;
}

Deno.test(
  "platform/backup-and-migration#R1: 미적용 step을 순번·hash·시각의 이력으로 적용한다",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/ledger.db`;
    const clock = manualClock(START);
    const applied = await applyMigrations(path, STEPS, { clock });
    assert(applied.ok);
    const rows = history(path);
    assertEquals(rows.length, 2);
    assertEquals(Number(rows[0]["version"]), 1);
    assertEquals(rows[0]["step_id"], "notes");
    assertEquals(rows[0]["content_hash"], await sha256Hex(STEPS[0].sql));
    assertEquals(rows[0]["applied_at"], "2026-01-01T00:00:00.000Z");
    assertEquals(Number(rows[1]["version"]), 2);
    assertEquals(rows[1]["content_hash"], await sha256Hex(STEPS[1].sql));
    const again = await applyMigrations(path, STEPS, { clock });
    assert(again.ok);
    assertEquals(history(path).length, 2);
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R4: 실패한 단계는 변환과 이력이 모두 rollback된다",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/ledger.db`;
    const clock = manualClock(START);
    const first = await applyMigrations(path, [STEPS[0]], { clock });
    assert(first.ok);
    const failing: SchemaStep = {
      id: "broken",
      sql: "insert into notes (id, body) values (1, 1, 1)",
    };
    const failed = await applyMigrations(path, [STEPS[0], failing], { clock });
    assert(!failed.ok);
    if (!failed.ok) assertEquals(failed.error.code, "unavailable");
    const rows = history(path);
    assertEquals(rows.length, 1);
    assertEquals(Number(rows[0]["version"]), 1);
    const db = new DatabaseSync(path, { readOnly: true });
    const columns = db.prepare("pragma table_info(notes)").all();
    db.close();
    assertEquals(columns.map((column) => column["name"]), ["id", "body"]);
    const retried = await applyMigrations(path, STEPS, { clock });
    assert(retried.ok);
    assertEquals(history(path).length, 2);
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R6: 지원보다 높은 schema면 원본을 건드리지 않는다",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/ledger.db`;
    const clock = manualClock(START);
    assert((await applyMigrations(path, STEPS, { clock })).ok);
    const before = await Deno.readFile(path);
    const refused = await applyMigrations(path, [STEPS[0]], { clock });
    assert(!refused.ok);
    if (!refused.ok) assertEquals(refused.error.code, "unavailable");
    assertEquals(history(path).length, 2);
    const after = await Deno.readFile(path);
    assertEquals(after, before);
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R6: 적용된 내용 hash가 다르면 원본을 건드리지 않는다",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/ledger.db`;
    const clock = manualClock(START);
    assert((await applyMigrations(path, [STEPS[0]], { clock })).ok);
    const changed: SchemaStep = {
      id: "notes",
      sql: "create table notes (id integer primary key, body text)",
    };
    const before = history(path);
    const refused = await applyMigrations(path, [changed], { clock });
    assert(!refused.ok);
    if (!refused.ok) assertEquals(refused.error.code, "unavailable");
    assertEquals(history(path), before);
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R6: 무결성 검사가 실패하면 원본을 건드리지 않는다",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/ledger.db`;
    const clock = manualClock(START);
    assert((await applyMigrations(path, [STEPS[0]], { clock })).ok);
    const bytes = await Deno.readFile(path);
    bytes[4100] = 0x00;
    bytes[4101] = 0xff;
    await Deno.writeFile(path, bytes);
    const before = await Deno.readFile(path);
    const refused = await applyMigrations(path, STEPS, { clock });
    assert(!refused.ok);
    if (!refused.ok) assertEquals(refused.error.code, "unavailable");
    const after = await Deno.readFile(path);
    assertEquals(after, before);
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R1: schema 이력은 고치거나 지우지 못한다",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/ledger.db`;
    assert(
      (await applyMigrations(path, [STEPS[0]], { clock: manualClock(START) }))
        .ok,
    );
    const db = new DatabaseSync(path);
    let updateFailed = false;
    try {
      db.exec("update schema_migrations set step_id = 'x'");
    } catch {
      updateFailed = true;
    }
    let deleteFailed = false;
    try {
      db.exec("delete from schema_migrations");
    } catch {
      deleteFailed = true;
    }
    db.close();
    assert(updateFailed);
    assert(deleteFailed);
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R1: trigger와 release 열이 있는 step은 적용된다",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/ledger.db`;
    const step: SchemaStep = {
      id: "releases",
      sql: `
create table releases (
  id integer primary key,
  release text not null
);
create trigger releases_no_delete
before delete on releases
begin
  select raise(abort, 'immutable');
end;`,
    };
    const applied = await applyMigrations(path, [step], {
      clock: manualClock(START),
    });
    assert(applied.ok);
    const db = new DatabaseSync(path, { readOnly: true });
    const columns = db.prepare("pragma table_info(releases)").all();
    const triggers = db.prepare(
      "select name from sqlite_master where type = 'trigger'",
    ).all();
    db.close();
    assertEquals(columns.map((column) => column["name"]), ["id", "release"]);
    assert(
      triggers.some((trigger) => trigger["name"] === "releases_no_delete"),
    );
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R1 #R4 #R5: owner step bootstrap은 history REPLACE와 domain 쓰기를 함께 rollback한다",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/ledger.db`;
    try {
      assert(
        (await applyMigrations(path, [STEPS[0]], {
          clock: manualClock(START),
        })).ok,
      );
      const before = history(path);
      const db = new DatabaseSync(path);
      try {
        db.exec("pragma recursive_triggers=OFF");
        assertEquals(
          db.prepare("pragma journal_mode").get()?.journal_mode,
          "wal",
        );
        for (
          const sql of [
            "insert or replace into schema_migrations select * from schema_migrations",
            "replace into schema_migrations select * from schema_migrations",
            "insert into schema_migrations select * from schema_migrations where 1 on conflict (version) do update set content_hash = 'changed'",
            "insert into schema_migrations select * from schema_migrations where 1 on conflict (version) do update set content_hash = excluded.content_hash",
          ]
        ) {
          assertThrows(() => db.exec(sql), Error, "immutable");
          assertEquals(
            db.prepare("select * from schema_migrations order by version")
              .all(),
            before,
          );
        }
        // 이전 bootstrap만 있는 설치를 재현해 upgrade 전 bootstrap도 검증한다.
        db.exec("drop trigger schema_migrations_no_duplicate_insert");
      } finally {
        db.close();
      }
      const malicious: SchemaStep = {
        id: "replace-history",
        sql: `
insert into notes (id, body) values (1, 'must rollback');
pragma recursive_triggers=OFF;
replace into schema_migrations (version, step_id, content_hash, applied_at)
values (1, 'changed', 'changed', 'changed');`,
      };
      const refused = await applyMigrations(path, [STEPS[0], malicious], {
        clock: manualClock(START),
      });
      assert(!refused.ok);
      assertEquals(refused.error.code, "unavailable");
      assertEquals(history(path), before);
      const checked = new DatabaseSync(path, { readOnly: true });
      try {
        assertEquals(checked.prepare("select * from notes").all(), []);
      } finally {
        checked.close();
      }
      assert(
        (await applyMigrations(path, STEPS, {
          clock: manualClock(START),
        })).ok,
      );
      assertEquals(history(path).slice(0, 1), before);
      assertEquals(history(path).length, 2);
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
);

Deno.test(
  "platform/backup-and-migration#R4: transaction을 끝내는 step은 거절한다",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/ledger.db`;
    const step: SchemaStep = {
      id: "commits",
      sql: "commit;",
    };
    const refused = await applyMigrations(path, [step], {
      clock: manualClock(START),
    });
    assert(!refused.ok);
    if (!refused.ok) assertEquals(refused.error.code, "unavailable");
    const db = new DatabaseSync(path, { readOnly: true });
    const table = db.prepare(
      "select name from sqlite_master where name = 'schema_migrations'",
    ).all();
    const rows = table.length === 0
      ? []
      : db.prepare("select version from schema_migrations").all();
    db.close();
    assertEquals(rows.length, 0);
    await Deno.remove(dir, { recursive: true });
  },
);
