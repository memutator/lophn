// 앱 데이터 기록이 ledger 표에 참조와 결과만 남는지 확인한다.
// node:sqlite는 테스트에서만 연다. core module graph에는 없다.
import { assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import type { Sql, SqlParams } from "../../contracts/platform/mod.ts";
import type { DataRecord } from "./commands.ts";
import { dataSchemaSteps } from "./schema.ts";
import { createDataRecordStore, loadDataRecords } from "./store.ts";

const RELEASE = "rel_01h455vb4pex5v6nkc6gd5fdw1";
const BACKUP = "a".repeat(64);

function sqlite(path: string): Sql {
  const db = new DatabaseSync(path);
  for (const step of dataSchemaSteps) db.exec(step.sql);
  return {
    run(statement: string, params: SqlParams) {
      const result = db.prepare(statement).run(...params);
      return {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    },
    get(statement: string, params: SqlParams) {
      return db.prepare(statement).get(...params) as
        | Record<string, unknown>
        | undefined;
    },
    all(statement: string, params: SqlParams) {
      return db.prepare(statement).all(...params) as Record<string, unknown>[];
    },
  } as unknown as Sql;
}

Deno.test(
  "apps/data#R9: migration 기록에서 backup·schema·결과를 찾는다",
  async () => {
    const dir = await Deno.makeTempDir({ prefix: "lophn-app-data-store-" });
    const sql = sqlite(`${dir}/ledger.db`);
    const store = createDataRecordStore({ sql });
    const backup: DataRecord = {
      kind: "backup",
      release: RELEASE,
      activationSeq: "1",
      dataSchema: 0,
      backupHash: BACKUP,
      invocation: null,
      integrityOk: true,
    };
    store.save(backup);
    const change: DataRecord = {
      kind: "change",
      release: RELEASE,
      activationSeq: "1",
      dataSchema: 3,
      backupHash: BACKUP,
      invocation: "inv_01h455vb4pex5v6nkc6gd5fdw1",
      integrityOk: true,
    };
    store.save(change);
    const found = store.find(RELEASE, "1", "change");
    assertEquals(found?.dataSchema, 3);
    assertEquals(found?.backupHash, BACKUP);
    assertEquals(found?.invocation, "inv_01h455vb4pex5v6nkc6gd5fdw1");
    const loaded = loadDataRecords(sql, RELEASE);
    assertEquals(loaded.map((record) => record.kind), ["backup", "change"]);
    // 실패 기록도 같은 표에서 결과로 구별된다.
    store.save({
      kind: "restore",
      release: RELEASE,
      activationSeq: "1",
      dataSchema: 0,
      backupHash: BACKUP,
      invocation: null,
      integrityOk: true,
    });
    const restored = store.find(RELEASE, "1", "restore");
    assertEquals(restored?.dataSchema, 0);
    assertEquals(restored?.backupHash, BACKUP);
  },
);
