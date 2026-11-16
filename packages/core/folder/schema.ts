import type { SchemaStep } from "../../protocol/server/mod.ts";

// 폴더 교환의 local 상태. 폴더에는 두지 않고 이 기계 ledger에 둔다.
// 모든 표의 첫 칸 machine은 그 행을 쓴 기계 id다. 지금 기계 id와 다른 행(복제된 data root에서 온 것)은 없는 것으로 본다.
// - folder_streams: 이 기계가 destination에 쓰는 stream마다의 다음 번호와 상태. 기계 기록은 app ''.
//   settled·horizon은 HLC(십진 문자열).
// - folder_written: 이 기계가 쓴 file. compaction과, 자기 폴더에 자기가 쓰지 않은 file이 보이는 것(남의 writer)을 알아챈다.
// - folder_reads: (앱, 출처 기계, stream)마다 적용했거나 held로 넘긴 마지막 번호와 물러남.
// - folder_held: 다른 release라 적용하지 않고 data root에 복사해 둔 file.
// - folder_records: 다른 기계의 기록 사본. key는 기계 기록이면 '', 앱 기록이면 앱 id. 가장 큰 revision을 둔다.
//   forgotten_at이 있으면 알려진 기계에서 빠진다.
// 낸 때 step 목록의 끝에 붙어야 해서(schema-steps.lock.json) WIRINGS 맨 뒤 wiring(remote)의 schemaStepsAfterTeams에서 잇는다.
export const FOLDER_SCHEMA_STEPS: readonly SchemaStep[] = [
  {
    id: "folder.tables",
    sql: `
    CREATE TABLE folder_streams (
      machine TEXT NOT NULL,
      app TEXT NOT NULL,
      destination TEXT NOT NULL,
      stream TEXT NOT NULL CHECK (stream IN ('data', 'source', 'record', 'app')),
      next_n INTEGER NOT NULL CHECK (next_n >= 1),
      last_seq INTEGER NOT NULL DEFAULT 0,
      bundle_hash TEXT,
      last_snapshot_n INTEGER,
      written_at TEXT,
      settled TEXT,
      horizon TEXT,
      away_since TEXT,
      error TEXT CHECK (error IS NULL OR json_valid(error)),
      PRIMARY KEY (machine, app, destination, stream)
    ) STRICT;
    CREATE TABLE folder_written (
      machine TEXT NOT NULL,
      destination TEXT NOT NULL,
      path TEXT NOT NULL,
      app TEXT NOT NULL,
      stream TEXT NOT NULL,
      n INTEGER,
      sha256 TEXT NOT NULL,
      size INTEGER NOT NULL,
      written_at TEXT NOT NULL,
      deleted_at TEXT,
      PRIMARY KEY (machine, destination, path)
    ) STRICT;
    CREATE TABLE folder_reads (
      machine TEXT NOT NULL,
      app TEXT NOT NULL,
      origin TEXT NOT NULL,
      stream TEXT NOT NULL CHECK (stream IN ('data', 'source')),
      cursor INTEGER NOT NULL DEFAULT 0,
      bundle_hash TEXT,
      read_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_try_at TEXT,
      waiting_for INTEGER,
      error TEXT CHECK (error IS NULL OR json_valid(error)),
      PRIMARY KEY (machine, app, origin, stream)
    ) STRICT;
    CREATE TABLE folder_held (
      machine TEXT NOT NULL,
      app TEXT NOT NULL,
      origin TEXT NOT NULL,
      n INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('changes', 'snapshot')),
      bundle_hash TEXT NOT NULL,
      data_schema INTEGER NOT NULL,
      path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      size INTEGER NOT NULL,
      held_at TEXT NOT NULL,
      PRIMARY KEY (machine, app, origin, n)
    ) STRICT;
    CREATE TABLE folder_records (
      machine TEXT NOT NULL,
      origin TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('machine', 'app')),
      key TEXT NOT NULL,
      revision INTEGER NOT NULL,
      record TEXT NOT NULL CHECK (json_valid(record)),
      destination TEXT NOT NULL,
      read_at TEXT NOT NULL,
      forgotten_at TEXT,
      PRIMARY KEY (machine, origin, kind, key)
    ) STRICT;
  `,
  },
];
