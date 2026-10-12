// flow update-lophn 3단계 통합 테스트(b&m#R2·R3·R5). 업데이트는 정상 정지한
// 데이터 폴더의 파일 SQLite에서 다시 뜨며, schema 변경이 필요하면 변환 전
// 복구본을 만들고 이전 내용을 보존한 채 migration한다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock } from "../../packages/base/mod.ts";
import { applyMigrations } from "../../packages/core/storage/migration/mod.ts";
import {
  recoveryName,
  recoveryStamp,
} from "../../packages/core/storage/migration/mod.ts";
import type { SchemaStep } from "../../packages/protocol/server/mod.ts";
import { CREDENTIAL_SCHEMA } from "./credentials.ts";

const START = Date.parse("2026-01-01T00:00:00.000Z");

async function tempDir(): Promise<string> {
  return await Deno.makeTempDir({ prefix: "lophn-flow-update-" });
}

Deno.test(
  "platform/backup-and-migration#R3: update 재기동은 변환 전 복구본을 남기고 이전 내용을 보존한 채 migration한다",
  async () => {
    const dir = await tempDir();
    const path = `${dir}/lophn.db`;
    // 설치 패키지의 schema. 이전 lophn은 이보다 적은 schema로 떴다.
    const steps: SchemaStep[] = [
      ...[CREDENTIAL_SCHEMA],
      {
        id: "notes",
        sql: "create table notes (id integer primary key, body text not null)",
      },
      {
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
      },
    ];
    const clock = manualClock(START);
    // 이전 lophn의 schema. update 재기동 전 정상 정지한 상태다.
    const before: SchemaStep[] = steps.slice(0, 2);
    const applied = await applyMigrations(path, before, {
      clock,
      recovery: { root: dir },
    });
    assert(applied.ok, applied.ok ? "" : applied.error.message);
    const source = new DatabaseSync(path);
    source.exec(
      "insert into notes (id, body) values (1, 'kept'), (2, 'kept-2')",
    );
    source.close();
    const at = manualClock(START + 1).now();
    const stamp = recoveryStamp(at);
    assert(stamp.ok);
    const expected = recoveryName(2, stamp.value);

    // update 재기동은 새 schema를 순서대로 적용한다. 복구본은 변환 전 schema
    // 순번과 시각을 name에 둔다(R3).
    const migrated = await applyMigrations(path, steps, {
      clock: manualClock(START + 1),
      recovery: { root: dir },
    });
    assert(migrated.ok, migrated.ok ? "" : migrated.error.message);
    const folders: string[] = [];
    for (const entry of Deno.readDirSync(`${dir}/backups/migrations`)) {
      folders.push(entry.name);
    }
    assertEquals(folders.sort(), [expected]);
    // 복구본은 변환 전 schema의 내용을 그대로 담는다(R5).
    const copy = new DatabaseSync(
      `${dir}/backups/migrations/${expected}/ledger.db`,
      { readOnly: true },
    );
    assertEquals(
      copy.prepare("pragma table_info(notes)").all().map((c) => c["name"]),
      ["id", "body"],
    );
    assertEquals(
      copy.prepare("select id, body from notes order by id").all(),
      [{ id: 1, body: "kept" }, { id: 2, body: "kept-2" }],
    );
    copy.close();
    // 원본은 새 schema로 이전 내용을 보존한다(R5).
    const migratedDb = new DatabaseSync(path, { readOnly: true });
    assertEquals(
      migratedDb.prepare("select id, body, revised from notes order by id")
        .all(),
      [
        { id: 1, body: "kept", revised: null },
        { id: 2, body: "kept-2", revised: null },
      ],
    );
    assertEquals(
      migratedDb.prepare(
        "select count(*) as n from pragma_foreign_key_check",
      ).get()?.n,
      0,
    );
    migratedDb.close();
    await Deno.remove(dir, { recursive: true });
  },
);
