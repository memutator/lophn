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
