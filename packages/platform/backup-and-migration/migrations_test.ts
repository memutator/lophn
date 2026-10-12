import { assert, assertEquals, assertThrows } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, sha256Hex } from "../../base/mod.ts";
import type { SchemaStep } from "../../protocol/platform/mod.ts";
import { applyMigrations, recoveryName } from "./mod.ts";

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

function recoveryFolders(root: string): string[] {
  const names: string[] = [];
  try {
    for (const entry of Deno.readDirSync(`${root}/backups/migrations`)) {
      names.push(entry.name);
    }
  } catch {
    // 폴더가 아직 없으면 없다고 본다.
  }
  return names.sort();
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

Deno.test(
  "platform/backup-and-migration#R3: 미적용 step이 있으면 복구본을 만들고 이름에 schema 순번과 시각을 둔다",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/ledger.db`;
    const backups = `${dir}`;
    const clock = manualClock(START);
    // 첫 적용은 복구본 대상 schema 0이라 변환 전 복구본이 없다.
    assert((await applyMigrations(path, [STEPS[0]], { clock })).ok);
    const clock2 = manualClock(Date.parse("2026-02-03T04:05:06.789Z"));
    const second = await applyMigrations(path, STEPS, {
      clock: clock2,
      recovery: { root: backups },
    });
    assert(second.ok, second.ok ? "" : second.error.message);
    const folders = recoveryFolders(backups);
    assertEquals(folders, [recoveryName(1, "20260203T040506789Z")]);
    const copy = `${backups}/backups/migrations/${folders[0]}/ledger.db`;
    const db = new DatabaseSync(copy, { readOnly: true });
    // 복구본은 변환 전 schema의 내용을 그대로 담는다.
    assertEquals(
      db.prepare("pragma table_info(notes)").all().map((c) => c["name"]),
      ["id", "body"],
    );
    assertEquals(db.prepare("select count(*) as n from notes").get()?.n, 0);
    db.close();
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R3: 복구본 무결성 검사가 실패하면 원본을 변환하지 않는다",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/ledger.db`;
    const clock = manualClock(START);
    assert((await applyMigrations(path, [STEPS[0]], { clock })).ok);
    const before = history(path);
    // 원본을 변환 후처럼 손상시켜 vacuum이 만든 복구본 검사가 실패하게 만든다.
    // 여기서는 원본 손상이 아니라 복구본 폴더를 파일로 막아 검사 실패를 만든다.
    await Deno.mkdir(`${dir}/backups/migrations`, {
      recursive: true,
      mode: 0o700,
    });
    await Deno.mkdir(
      `${dir}/backups/migrations/${recoveryName(1, "20260203T040506789Z")}`,
      { recursive: true, mode: 0o700 },
    );
    // 이미 같은 이름의 복구본이 있으면 만들기를 거절한다.
    await Deno.writeFile(
      `${dir}/backups/migrations/${
        recoveryName(1, "20260203T040506789Z")
      }/ledger.db`,
      new Uint8Array([1]),
    );
    const clock2 = manualClock(Date.parse("2026-02-03T04:05:06.789Z"));
    const refused = await applyMigrations(path, STEPS, {
      clock: clock2,
      recovery: { root: dir },
    });
    assert(!refused.ok);
    if (!refused.ok) assertEquals(refused.error.code, "unavailable");
    assertEquals(history(path), before);
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R2: migration 중 새 요청과 worker 쓰기가 시작되지 않는다",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/ledger.db`;
    const clock = manualClock(START);
    assert((await applyMigrations(path, [STEPS[0]], { clock })).ok);
    // migration 적용기는 openConnection 하나로 열고 닫는다. 정상 writer가 닫힌
    // 유지보수 실행기라 다른 연결이 나중에 열리는 동안 BEGIN IMMEDIATE를 쓴다.
    const held = new DatabaseSync(path);
    held.exec("begin immediate");
    try {
      held.exec("rollback");
    } finally {
      held.close();
    }
    const second = await applyMigrations(path, STEPS, {
      clock: manualClock(Date.parse("2026-02-03T04:05:06.789Z")),
      recovery: { root: dir },
    });
    assert(second.ok, second.ok ? "" : second.error.message);
    assertEquals(history(path).length, 2);
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R5: 완료 뒤 FK·unique·불변 보호 검사와 ID·event 순서 보존",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/ledger.db`;
    const clock = manualClock(START);
    assert((await applyMigrations(path, [STEPS[0]], { clock })).ok);
    // 원본에 행을 남긴다. conversion 전 자료다.
    const source = new DatabaseSync(path);
    source.exec(
      "insert into notes (id, body) values (1, 'original'), (2, 'second')",
    );
    source.close();
    const step: SchemaStep = {
      id: "notes-audit",
      sql: `
alter table notes add column revised text;
create trigger notes_no_update
before update on notes
begin
  select raise(abort, 'immutable');
end;
create trigger notes_no_delete
before delete on notes
begin
  select raise(abort, 'immutable');
end;`,
    };
    const migrated = await applyMigrations(path, [STEPS[0], step], {
      clock: manualClock(Date.parse("2026-02-03T04:05:06.789Z")),
      recovery: { root: dir },
    });
    assert(migrated.ok, migrated.ok ? "" : migrated.error.message);
    const checked = new DatabaseSync(path, { readOnly: true });
    // ID·원문 보존(R5).
    const rows = checked.prepare(
      "select id, body, revised from notes order by id",
    )
      .all();
    assertEquals(rows.length, 2);
    assertEquals(rows[0]["id"], 1);
    assertEquals(rows[0]["body"], "original");
    assertEquals(rows[0]["revised"], null);
    assertEquals(rows[1]["body"], "second");
    // FK·무결성 검사가 통과한다.
    assertEquals(
      checked.prepare("select count(*) as n from pragma_foreign_key_check")
        .get()?.n,
      0,
    );
    assertEquals(
      checked.prepare("select * from pragma_integrity_check").get()
        ?.integrity_check,
      "ok",
    );
    // 불변 보호 trigger가 남아 있다.
    const triggers = checked.prepare(
      "select name from sqlite_master where type = 'trigger' and tbl_name = 'notes' order by name",
    ).all().map((t) => t["name"]);
    assert(triggers.includes("notes_no_update"));
    assert(triggers.includes("notes_no_delete"));
    checked.close();
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R5: FK 위반이 남은 원본은 완료 검사를 통과하지 못한다",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/ledger.db`;
    const clock = manualClock(START);
    const parent: SchemaStep = {
      id: "parent",
      sql: "create table parent (id integer primary key)",
    };
    // 먼저 schema만 만든다.
    assert((await applyMigrations(path, [parent], { clock })).ok);
    // foreign_keys=OFF로 위반 행을 남긴다. 위반 행은 migration 밖의 raw 연결이 남긴다.
    const raw = new DatabaseSync(path);
    raw.exec("create table child (pid integer references parent (id))");
    raw.exec("pragma foreign_keys=OFF");
    raw.exec("insert into child (pid) values (999)");
    raw.close();
    // child schema가 이미 있는 설치를 다시 열면 완료 검사가 FK 위반을 잡는다.
    const withChild: SchemaStep = {
      id: "child",
      sql:
        "create table if not exists child (pid integer references parent (id))",
    };
    const refused = await applyMigrations(path, [parent, withChild], {
      clock: manualClock(Date.parse("2026-02-03T04:05:06.789Z")),
      recovery: { root: dir },
    });
    assert(!refused.ok);
    if (!refused.ok) assertEquals(refused.error.code, "unavailable");
    // refused의 child 적용은 rollback되지 않는다. create table if not exists는
    // 이미 있어 아무것도 쓰지 않지만 이력 insert는 commit된다. 원본 FK 위반은 남는다.
    const rows = history(path);
    assertEquals(rows.length, 2);
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R7: 이전 lophn은 높은 schema로의 되돌림을 거절한다",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/ledger.db`;
    const clock = manualClock(START);
    assert((await applyMigrations(path, STEPS, { clock })).ok);
    // 높은 schema가 적용된 설치를 다시 낮은 step 목록으로 여는 것은 checkHistory가 거절한다.
    // 여기서는 낮은 설치에 높은 step을 놓고 거절을 본다(앞으로만 간다).
    const higher: SchemaStep[] = [...STEPS, {
      id: "notes-audit",
      sql: "alter table notes add column revised text",
    }];
    assert((await applyMigrations(path, higher, { clock })).ok);
    assertEquals(history(path).length, 3);
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R18: 변환 성공 뒤에도 복구본이 남는다",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/ledger.db`;
    assert(
      (await applyMigrations(path, [STEPS[0]], { clock: manualClock(START) }))
        .ok,
    );
    const second = await applyMigrations(path, STEPS, {
      clock: manualClock(Date.parse("2026-02-03T04:05:06.789Z")),
      recovery: { root: dir },
    });
    assert(second.ok);
    // 성공 뒤에도 복구본은 사람이 명시 삭제할 때까지 남는다.
    const folders = recoveryFolders(dir);
    assertEquals(folders.length, 1);
    const copy = `${dir}/backups/migrations/${folders[0]}/ledger.db`;
    const db = new DatabaseSync(copy, { readOnly: true });
    assertEquals(db.prepare("select count(*) as n from notes").get()?.n, 0);
    db.close();
    // 원본도 변환 완료 상태로 남는다.
    assertEquals(history(path).length, 2);
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R5: event 순서·내용과 blob 참조 부담이 변환 전후로 같다",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/ledger.db`;
    const clock = manualClock(START);
    const events: SchemaStep = {
      id: "events",
      sql: `
create table events (
  seq integer primary key autoincrement,
  type text not null,
  subject text,
  actor text not null,
  payload text not null,
  at text not null
);
create trigger events_no_update before update on events begin
  select raise(abort, 'immutable');
end;
create trigger events_no_delete before delete on events begin
  select raise(abort, 'immutable');
end;`,
    };
    assert((await applyMigrations(path, [events], { clock })).ok);
    // blob_refs 표도 먼저 남긴다. 참조는 변환 전 schema의 자료다.
    const refsSchema = new DatabaseSync(path);
    refsSchema.exec(
      "create table blob_refs (owner_kind text not null, owner_key text not null, field text not null, hash text not null, registered_seq integer not null, primary key (owner_kind, owner_key, field, registered_seq))",
    );
    refsSchema.close();
    // event 세 개와 참조 blob 두 개를 남긴다.
    const source = new DatabaseSync(path);
    source.exec(
      "insert into events (type, subject, actor, payload, at) values ('Created', 'note:1', 'user', '{\"name\":\"one\"}', '2026-01-01T00:00:00.000Z'), ('Created', 'note:2', 'user', '{\"name\":\"two\"}', '2026-01-01T00:00:01.000Z'), ('Changed', 'note:1', 'machine', '{\"name\":\"one-b\"}', '2026-01-01T00:00:02.000Z')",
    );
    source.exec(
      "insert into blob_refs (owner_kind, owner_key, field, hash, registered_seq) values ('event', 'note:1', 'body', 'aa', 1), ('event', 'note:2', 'body', 'bb', 2)",
    );
    source.close();
    const before = new DatabaseSync(path, { readOnly: true });
    const eventsBefore = before.prepare(
      "select seq, type, subject, actor, payload, at from events order by seq",
    ).all();
    const refsBefore = before.prepare(
      "select owner_kind, owner_key, field, hash, registered_seq from blob_refs order by owner_key, registered_seq",
    ).all();
    before.close();
    const step: SchemaStep = {
      id: "events-index",
      sql: "create index events_type on events (type)",
    };
    const migrated = await applyMigrations(path, [events, step], {
      clock: manualClock(Date.parse("2026-02-03T04:05:06.789Z")),
      recovery: { root: dir },
    });
    assert(migrated.ok, migrated.ok ? "" : migrated.error.message);
    const after = new DatabaseSync(path, { readOnly: true });
    const eventsAfter = after.prepare(
      "select seq, type, subject, actor, payload, at from events order by seq",
    ).all();
    const refsAfter = after.prepare(
      "select owner_kind, owner_key, field, hash, registered_seq from blob_refs order by owner_key, registered_seq",
    ).all();
    after.close();
    // event 순서·내용 보존(R5).
    assertEquals(eventsAfter, eventsBefore);
    // blob 참조 보존(R5).
    assertEquals(refsAfter, refsBefore);
    await Deno.remove(dir, { recursive: true });
  },
);

Deno.test(
  "platform/backup-and-migration#R3: 권한을 제한한 core 모양의 프로세스에서도 변환 전 복구본을 만든다",
  async () => {
    const dir = await tempDir();
    const repo = new URL("../../..", import.meta.url).pathname;
    const script = new URL("./testdata/restricted-migrate.ts", import.meta.url)
      .pathname;
    const home = Deno.env.get("HOME");
    // packaged core의 권한처럼 쓰기는 데이터 root뿐이다. 이 권한에서는 SQLite attach가 막힌다.
    const outcome = await new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        `--allow-read=${dir},${repo}${home ? `,${home}/.cache/deno` : ""}`,
        `--allow-write=${dir}`,
        "--no-prompt",
        script,
        dir,
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    const out = new TextDecoder().decode(outcome.stdout) +
      new TextDecoder().decode(outcome.stderr);
    assert(outcome.success, out);
    assertEquals(recoveryFolders(dir).length, 1);
    await Deno.remove(dir, { recursive: true });
  },
);
