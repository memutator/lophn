import type { SchemaStep } from "../../../protocol/server/mod.ts";
import { defineBlobField } from "../../../protocol/storage/mod.ts";

// sync 앱의 순서 있는 sync log. seq는 모든 앱에 걸쳐 늘기만 하고(AUTOINCREMENT라 지운 번호를 다시 쓰지 않는다)
// 한 앱 안에서는 그 앱 DB에 적용된 순서다. 폰의 cursor가 이 seq다.
// kind:
// - change: 폰에 보낼 변경. changeset bytes는 blob store에 두고(invocation이 쥔 blob과 같은 hash면 같은 file) 행에는
//   hash와 크기만 둔다.
// - skipped: 폰에서 온 변경이 제약에 걸려 컴퓨터가 건너뛰었다. 보내지 않고, 같은 id를 다시 받았을 때 알아보는 데만 쓴다.
// - snapshot: 여기까지 받은 폰은 새 snapshot을 받아야 한다(activation이 옛 줄을 지웠거나 보낼 수 없는 변경이 있었다).
// device·change_id는 폰에서 온 줄에만 있고, 기기마다 같은 change_id는 한 줄이다.
// 낸 때 step 목록의 끝에 붙어야 해서(schema-steps.lock.json) WIRINGS 맨 뒤 wiring(remote)의 schemaStepsAfterTeams에서 잇는다.
export const SYNC_LOG_SCHEMA_STEPS: readonly SchemaStep[] = [
  {
    id: "apps.sync-log",
    sql: `
    CREATE TABLE app_sync_log (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      app TEXT NOT NULL,
      release TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('change', 'skipped', 'snapshot')),
      origin TEXT NOT NULL CHECK (origin IN ('computer', 'device', 'rewind')),
      device TEXT,
      change_id TEXT,
      hlc TEXT,
      changeset_hash TEXT,
      changeset_size INTEGER,
      invocation TEXT,
      created_at TEXT NOT NULL,
      CHECK ((origin = 'device') = (device IS NOT NULL)),
      CHECK ((device IS NULL) = (change_id IS NULL)),
      CHECK ((kind = 'change') = (changeset_hash IS NOT NULL)),
      CHECK ((changeset_hash IS NULL) = (changeset_size IS NULL)),
      CHECK (kind = 'snapshot' OR hlc IS NOT NULL)
    ) STRICT;
    CREATE INDEX app_sync_log_app_seq ON app_sync_log (app, seq);
    CREATE UNIQUE INDEX app_sync_log_device_change ON app_sync_log (device, change_id)
      WHERE device IS NOT NULL;
    CREATE INDEX app_sync_log_invocation ON app_sync_log (invocation)
      WHERE invocation IS NOT NULL;
  `,
  },
];

// 다른 기계에서 폴더로 온 변경(origin machine, 칸 machine)과 held 줄(kind held, 칸 resolved_at)을 받으려 CHECK를 바꾼다.
// - machine·change_id는 다른 기계에서 온 줄에만 있고, 기계마다 같은 change_id(주인 log의 seq)는 한 줄이다.
// - held: 정리된 흔적과 안전하게 합칠 수 없어 적용하지도 내보내지도 않는 변경. changeset blob을 쥐고 폰에 가지 않는다.
//   풀면 resolved_at을 적고 bytes는 남긴다.
// 표를 다시 만들어도 seq를 그대로 옮긴다: blob 참조의 owner_key와 폰의 cursor가 seq다. 다음 번호도 이어야 해서(지운 번호를
// 다시 쓰면 cursor가 그 줄을 건너뛴다) 옛 표의 sqlite_sequence 행을 새 표의 것으로 옮긴다. AUTOINCREMENT라 그 값은
// 언제나 옛 max(seq) 이상이다. 이 표를 가리키는 FK·trigger·view는 없다.
export const SYNC_LOG_MACHINE_STEPS: readonly SchemaStep[] = [
  {
    id: "apps.sync-log.machine",
    sql: `
    CREATE TABLE app_sync_log_next (
      seq INTEGER PRIMARY KEY AUTOINCREMENT,
      app TEXT NOT NULL,
      release TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('change', 'skipped', 'snapshot', 'held')),
      origin TEXT NOT NULL CHECK (origin IN ('computer', 'device', 'rewind', 'machine')),
      device TEXT,
      machine TEXT,
      change_id TEXT,
      hlc TEXT,
      changeset_hash TEXT,
      changeset_size INTEGER,
      invocation TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      CHECK ((origin = 'device') = (device IS NOT NULL)),
      CHECK ((origin = 'machine') = (machine IS NOT NULL)),
      CHECK ((device IS NULL AND machine IS NULL) = (change_id IS NULL)),
      CHECK ((kind IN ('change', 'held')) = (changeset_hash IS NOT NULL)),
      CHECK ((changeset_hash IS NULL) = (changeset_size IS NULL)),
      CHECK (kind = 'snapshot' OR hlc IS NOT NULL),
      CHECK (kind = 'held' OR resolved_at IS NULL)
    ) STRICT;
    INSERT INTO app_sync_log_next
      (seq, app, release, kind, origin, device, machine, change_id, hlc, changeset_hash, changeset_size, invocation,
       resolved_at, created_at)
    SELECT seq, app, release, kind, origin, device, NULL, change_id, hlc, changeset_hash, changeset_size, invocation,
      NULL, created_at
    FROM app_sync_log ORDER BY seq;
    DELETE FROM sqlite_sequence WHERE name = 'app_sync_log_next';
    UPDATE sqlite_sequence SET name = 'app_sync_log_next' WHERE name = 'app_sync_log';
    DROP TABLE app_sync_log;
    ALTER TABLE app_sync_log_next RENAME TO app_sync_log;
    CREATE INDEX app_sync_log_app_seq ON app_sync_log (app, seq);
    CREATE UNIQUE INDEX app_sync_log_device_change ON app_sync_log (device, change_id)
      WHERE device IS NOT NULL;
    CREATE UNIQUE INDEX app_sync_log_machine_change ON app_sync_log (machine, change_id)
      WHERE machine IS NOT NULL;
    CREATE INDEX app_sync_log_invocation ON app_sync_log (invocation)
      WHERE invocation IS NOT NULL;
  `,
  },
];

// 줄이 가는 destination(roadmap sync-tables 2단계). 한 앱이 표마다 다른 destination으로 보내면 write 하나가 destination마다 줄이
// 된다(hold와 held가 줄 단위라). NULL은 모든 destination의 줄이다: 폰 앱의 줄(폰 길이 모든 표를 다룬다), '다시 snapshot'
// 줄, 건너뛴 줄. 이미 있는 change·held 줄은 그 줄 release의 선언이 고른 destination 하나(옛 `sync_to`나 `sync`의 값.
// 1단계까지는 앱에 하나였다)로 채우고 폰 앱의 줄은 NULL로 둔다. `folder.destination` 앞에 낸 step 목록의 끝에 잇는다.
export const SYNC_LOG_DESTINATION_STEPS: readonly SchemaStep[] = [
  {
    id: "apps.sync-log.destination",
    sql: `
    ALTER TABLE app_sync_log ADD COLUMN destination TEXT;
    UPDATE app_sync_log SET destination = (
      SELECT coalesce(
        json_extract(r.declaration, '$.sync_to'),
        (SELECT s.value FROM json_each(r.declaration, '$.sync') AS s ORDER BY s.key LIMIT 1))
      FROM releases AS r
      WHERE r.id = app_sync_log.release
        AND NOT EXISTS (
          SELECT 1 FROM json_each(r.declaration, '$.runs_on') AS p WHERE p.value = 'phone'))
    WHERE kind IN ('change', 'held');
  `,
  },
];

export const SYNC_LOG_OWNER_KIND = "app_sync_log";
export const SYNC_LOG_FIELD_NAME = "changeset";

export const SYNC_LOG_BLOB_FIELDS = [
  defineBlobField({
    owner_kind: SYNC_LOG_OWNER_KIND,
    field: SYNC_LOG_FIELD_NAME,
    retention: { kind: "permanent" },
    general_read: false,
  }),
];
