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

// 기계 사이 release 신분을 bundle_hash에서 code_commit으로 옮긴다. 기존 stream의 code_commit은 NULL이라 다음
// 내보내기가 판 2 snapshot을 새로 쓰고, 판 1의 held 행과 release 폴더 기록은 더는 쓰지 않아 비운다.
// remote.grants 뒤 낸 step 목록의 끝에 잇는다.
export const FOLDER_CODE_COMMIT_STEPS: readonly SchemaStep[] = [
  {
    id: "folder.code-commit",
    sql: `
    ALTER TABLE folder_streams ADD COLUMN code_commit TEXT;
    ALTER TABLE folder_reads ADD COLUMN code_commit TEXT;
    DROP TABLE folder_held;
    CREATE TABLE folder_held (
      machine TEXT NOT NULL,
      app TEXT NOT NULL,
      origin TEXT NOT NULL,
      n INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('changes', 'snapshot')),
      code_commit TEXT NOT NULL,
      data_schema INTEGER NOT NULL,
      path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      size INTEGER NOT NULL,
      held_at TEXT NOT NULL,
      PRIMARY KEY (machine, app, origin, n)
    ) STRICT;
    DELETE FROM folder_written WHERE stream = 'release';
  `,
  },
];

// 읽는 쪽 상태의 key에 destination을 넣는다(roadmap sync-tables 2단계): 한 앱이 표마다 다른 destination으로 보내면 출처 기계 하나의
// 그 앱 stream이 destination마다 따로 번호를 세고, 앱 기록(`app.json`)도 destination마다 다른 data head·읽은 번호를 싣는다.
// - folder_reads: (앱, destination, 출처, stream)마다. data cursor는 그 앱 활성 release의 선언이 고른 destination(1단계까지는
//   앱에 하나)에서 읽은 것이고, source cursor는 그 출처의 앱 기록 사본을 읽은 destination에서 읽은 것이다. 둘 다 없으면
//   `computers`(source만 내보내는 앱의 길)다. 쓰지 않던 bundle_hash 칸은 뺀다. data 행의 error 칸에 오류와 같이 JSON으로
//   살던 빚진 "없는 row 지우기" 표시(`{error, absent: {caught_up_at} | null}`)를 제 칸 absent·absent_caught_up_at으로 옮기고
//   error에는 오류만 둔다(source 행의 error는 처음부터 오류뿐이다).
// - folder_held: 다른 release라 둔 file도 그 앱 활성 release 선언의 destination에서 읽었다. 사본 path는 행에 그대로 있다.
// - folder_records: 이미 destination 칸이 있다. 기계 기록과 앱 기록을 destination마다 둔다.
// remote wiring의 schemaStepsAfterTeams 끝(apps.sync-log.destination 뒤)에 잇는다.
const ACTIVE_DESTINATION = (app: string) => `(
      SELECT coalesce(
        json_extract(rel.declaration, '$.sync_to'),
        (SELECT s.value FROM json_each(rel.declaration, '$.sync') AS s ORDER BY s.key LIMIT 1))
      FROM releases AS rel WHERE rel.app = ${app} AND rel.status = 'active')`;

export const FOLDER_DESTINATION_STEPS: readonly SchemaStep[] = [
  {
    id: "folder.destination",
    sql: `
    CREATE TABLE folder_reads_next (
      machine TEXT NOT NULL,
      app TEXT NOT NULL,
      destination TEXT NOT NULL,
      origin TEXT NOT NULL,
      stream TEXT NOT NULL CHECK (stream IN ('data', 'source')),
      cursor INTEGER NOT NULL DEFAULT 0,
      code_commit TEXT,
      read_at TEXT,
      attempts INTEGER NOT NULL DEFAULT 0,
      next_try_at TEXT,
      waiting_for INTEGER,
      error TEXT CHECK (error IS NULL OR json_valid(error)),
      absent INTEGER NOT NULL DEFAULT 0 CHECK (absent IN (0, 1)),
      absent_caught_up_at TEXT,
      PRIMARY KEY (machine, app, destination, origin, stream)
    ) STRICT;
    INSERT INTO folder_reads_next
      (machine, app, destination, origin, stream, cursor, code_commit, read_at, attempts, next_try_at, waiting_for, error,
       absent, absent_caught_up_at)
    SELECT r.machine, r.app,
      coalesce(
        CASE WHEN r.stream = 'data' THEN ${ACTIVE_DESTINATION("r.app")} END,
        (SELECT fr.destination FROM folder_records AS fr
          WHERE fr.machine = r.machine AND fr.origin = r.origin AND fr.kind = 'app' AND fr.key = r.app),
        ${ACTIVE_DESTINATION("r.app")},
        'computers'),
      r.origin, r.stream, r.cursor, r.code_commit, r.read_at, r.attempts, r.next_try_at, r.waiting_for,
      CASE WHEN r.stream = 'data' AND r.error IS NOT NULL THEN json_extract(r.error, '$.error') ELSE r.error END,
      CASE WHEN r.stream = 'data' AND json_type(r.error, '$.absent') = 'object' THEN 1 ELSE 0 END,
      CASE WHEN r.stream = 'data' THEN json_extract(r.error, '$.absent.caught_up_at') END
    FROM folder_reads AS r;
    DROP TABLE folder_reads;
    ALTER TABLE folder_reads_next RENAME TO folder_reads;
    CREATE TABLE folder_held_next (
      machine TEXT NOT NULL,
      app TEXT NOT NULL,
      destination TEXT NOT NULL,
      origin TEXT NOT NULL,
      n INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('changes', 'snapshot')),
      code_commit TEXT NOT NULL,
      data_schema INTEGER NOT NULL,
      path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      size INTEGER NOT NULL,
      held_at TEXT NOT NULL,
      PRIMARY KEY (machine, app, destination, origin, n)
    ) STRICT;
    INSERT INTO folder_held_next
      (machine, app, destination, origin, n, kind, code_commit, data_schema, path, sha256, size, held_at)
    SELECT h.machine, h.app, coalesce(${ACTIVE_DESTINATION("h.app")}, 'computers'),
      h.origin, h.n, h.kind, h.code_commit, h.data_schema, h.path, h.sha256, h.size, h.held_at
    FROM folder_held AS h;
    DROP TABLE folder_held;
    ALTER TABLE folder_held_next RENAME TO folder_held;
    CREATE TABLE folder_records_next (
      machine TEXT NOT NULL,
      origin TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('machine', 'app')),
      key TEXT NOT NULL,
      destination TEXT NOT NULL,
      revision INTEGER NOT NULL,
      record TEXT NOT NULL CHECK (json_valid(record)),
      read_at TEXT NOT NULL,
      forgotten_at TEXT,
      PRIMARY KEY (machine, origin, kind, key, destination)
    ) STRICT;
    INSERT INTO folder_records_next
      (machine, origin, kind, key, destination, revision, record, read_at, forgotten_at)
    SELECT machine, origin, kind, key, destination, revision, record, read_at, forgotten_at FROM folder_records;
    DROP TABLE folder_records;
    ALTER TABLE folder_records_next RENAME TO folder_records;
  `,
  },
];
