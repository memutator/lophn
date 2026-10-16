// 앱 데이터 기록의 ledger 저장. 행은 참조와 결과만 담고 DB 파일은 열지 않는다.

import type { Tx } from "../../../protocol/server/mod.ts";
import type { DataRecord, DataRecordStore } from "./commands.ts";

type RecordRow = {
  app: string;
  release: string;
  attempt: string;
  kind: DataRecord["kind"];
  data_schema: number | bigint;
  backup_hash: string | null;
  invocation: string | null;
  integrity_ok: number | bigint;
};

function recordOf(row: RecordRow): DataRecord {
  return {
    kind: row.kind,
    app: row.app,
    release: row.release,
    attempt: row.attempt,
    dataSchema: Number(row.data_schema),
    backupHash: row.backup_hash,
    invocation: row.invocation,
    integrityOk: Number(row.integrity_ok) === 1,
  };
}

export function createDataRecordStore(tx: Pick<Tx, "sql">): DataRecordStore {
  return {
    find(release, attempt, kind) {
      const row = tx.sql.get(
        `select app, release, attempt, kind, data_schema, backup_hash,
                invocation, integrity_ok
           from app_data_records
          where release = ? and attempt = ? and kind = ?`,
        [release, attempt, kind],
      ) as RecordRow | undefined;
      return row === undefined ? null : recordOf(row);
    },
    save(record) {
      tx.sql.run(
        `insert into app_data_records (
           app, release, attempt, kind, data_schema, backup_hash,
           invocation, integrity_ok
         ) values (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.app,
          record.release,
          record.attempt,
          record.kind,
          record.dataSchema,
          record.backupHash,
          record.invocation,
          record.integrityOk ? 1 : 0,
        ],
      );
    },
  };
}

// 읽기 전용 조회. read handler가 snapshot sql로 쓴다.
