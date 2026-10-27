import type { SchemaStep } from "../../../protocol/server/mod.ts";

// 앱 데이터 작업의 ledger 기록. DB 파일 자체는 data worker가 열고, 여기 표는
// backup·변경·복원의 참조와 결과만 담는다(apps/data command).
export const dataSchemaSteps: readonly SchemaStep[] = [
  {
    id: "apps.data.records",
    sql: `
    CREATE TABLE app_data_records (
      app TEXT NOT NULL,
      release TEXT NOT NULL,
      attempt TEXT NOT NULL CHECK (length(attempt) > 0),
      kind TEXT NOT NULL CHECK (kind IN ('backup', 'change', 'restore')),
      data_schema INTEGER NOT NULL CHECK (data_schema >= 0),
      backup_hash TEXT,
      invocation TEXT,
      integrity_ok INTEGER NOT NULL CHECK (integrity_ok IN (0, 1)),
      PRIMARY KEY (release, attempt, kind),
      CHECK (backup_hash IS NULL OR length(backup_hash) = 64)
    ) STRICT;
    CREATE INDEX app_data_records_app ON app_data_records(app, kind);
  `,
  },
];
