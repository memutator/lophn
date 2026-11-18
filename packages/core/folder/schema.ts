import type { SchemaStep } from "../../protocol/server/mod.ts";

// 폴더 교환의 local 상태. 폴더에는 두지 않고 이 기계 ledger에 둔다.
// 모든 표의 첫 칸 machine은 그 행을 쓴 기계 id다. 지금 기계 id와 다른 행(복제된 data root에서 온 것)은 없는 것으로 본다.
// - folder_streams: 이 기계가 destination에 쓰는 stream마다의 다음 번호와 상태. 기계 기록은 app ''.
//   settled·horizon은 HLC(십진 문자열). away_notified는 떨어져 있음 알림에 마지막으로 쓴 held 수다(알림 줄은 그린 글만 가져
//   수를 되읽을 수 없고, core가 다시 떠도 같은 줄을 다시 쓰지 않아야 한다).
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

// folder_streams에 떨어져 있음 알림의 마지막 held 수를 둔다. FOLDER_SCHEMA_STEPS 뒤 낸 step 목록의 끝에 잇는다.
export const FOLDER_AWAY_NOTIFIED_STEPS: readonly SchemaStep[] = [
  {
    id: "folder.away-notified",
    sql: `ALTER TABLE folder_streams ADD COLUMN away_notified INTEGER;`,
  },
];

// 다른 기계에서 온 event file 가운데 이 기계(machine)가 이미 낸 것. 같은 file이 여러 길로 와도 한 번만 낸다. seen_at이
// `CROSS_EVENT_SEEN_KEEP_MS`(나이 한도의 두 배)가 지난 행만 지운다. FOLDER_AWAY_NOTIFIED_STEPS 뒤 낸 step 목록의 끝에 잇는다.
export const FOLDER_EVENTS_SEEN_STEPS: readonly SchemaStep[] = [
  {
    id: "folder.events-seen",
    sql: `
    CREATE TABLE folder_events_seen (
      machine TEXT NOT NULL,
      origin TEXT NOT NULL,
      app TEXT NOT NULL,
      event TEXT NOT NULL,
      seen_at TEXT NOT NULL,
      PRIMARY KEY (machine, origin, app, event)
    ) STRICT;
  `,
  },
];

// 받아 들인 다른 기계 manifest의 가장 큰 revision. (그 기계, 그 서명 key)마다 하나이고 `computers` 폴더의 그 기계 하위 폴더
// 밖에 두어 하위 폴더를 지워도 남는다. 지우지 않는다: 남아 있어야 옛 manifest를 되살려 넘겨도 받지 않는다. key가 바뀌면 새
// key는 새 행에서 시작한다(옛 key의 큰 revision이 새 key를 막지 않는다). origin이 이 기계 id면 다른 기계가 되돌려 준 이 기계
// 자신의 manifest revision이고 다음 revision은 그보다 크다. FOLDER_EVENTS_SEEN_STEPS 뒤 낸 step 목록의 끝에 잇는다.
export const FOLDER_CARRY_MARKS_STEPS: readonly SchemaStep[] = [
  {
    id: "folder.carry-marks",
    sql: `
    CREATE TABLE folder_carry_marks (
      machine TEXT NOT NULL,
      origin TEXT NOT NULL,
      signing_key TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision >= 1),
      PRIMARY KEY (machine, origin, signing_key)
    ) STRICT;
  `,
  },
];
