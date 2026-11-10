import type { SchemaStep } from "../../../protocol/server/mod.ts";

// SDK ledger 표. release 참조는 releases 표의 위치가 다른
// 조립이므로 물리 FK를 두지 않고, bundle_hash·guide_hash의 실제 byte는 blob이다.
// 공개한 name·version은 바꾸거나 지우지 않는다 — trigger가 update·delete를 막는다.
export const sdkSchemaSteps: readonly SchemaStep[] = [
  {
    id: "apps.sdk.tables",
    sql: `
    CREATE TABLE packages (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE CHECK (name GLOB '@me/*' OR name GLOB '@lophn/*'),
      description TEXT NOT NULL CHECK (
        length(description) > 0 AND instr(description, char(10)) = 0
        AND instr(description, char(13)) = 0
      ),
      owner_app TEXT
    ) STRICT;
    CREATE INDEX packages_name ON packages (name);
    CREATE TRIGGER packages_no_delete BEFORE DELETE ON packages
    BEGIN SELECT RAISE(ABORT, 'packages are published, not deleted'); END;
    CREATE TABLE package_versions (
      package TEXT NOT NULL,
      version TEXT NOT NULL CHECK (
        version GLOB '[0-9]*.[0-9]*.[0-9]*'
        AND version NOT GLOB '*[^0-9.]*'
      ),
      bundle_hash TEXT NOT NULL CHECK (
        length(bundle_hash) = 64 AND bundle_hash GLOB '*[0-9a-f]*'
        AND bundle_hash NOT GLOB '*[^0-9a-f]*'
      ),
      guide_hash TEXT NOT NULL CHECK (
        length(guide_hash) = 64 AND guide_hash GLOB '*[0-9a-f]*'
        AND guide_hash NOT GLOB '*[^0-9a-f]*'
      ),
      permissions TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(permissions)),
      PRIMARY KEY (package, version),
      FOREIGN KEY (package) REFERENCES packages (id)
    ) STRICT;
    CREATE TRIGGER package_versions_no_update BEFORE UPDATE ON package_versions
    BEGIN SELECT RAISE(ABORT, 'published version bytes are immutable'); END;
    CREATE TRIGGER package_versions_no_delete BEFORE DELETE ON package_versions
    BEGIN SELECT RAISE(ABORT, 'published version bytes are immutable'); END;
  `,
  },
];

// 앱을 지우면 그 앱이 주인인 package는 주인 없음(null)이 되어 다음에 publish한 앱이 이어받는다. 이 step 전에 지운 앱이
// 주인으로 남은 package를 같은 상태로 옮긴다. 남겨 두면 지운 앱 id는 다시 쓰이지 않아 누구도 새 판을 내지 못한다.
// WIRINGS 맨 뒤 wiring(domains-retire)의 schemaStepsAfterTeams에서 잇는다(schema-steps.lock.json 끝).
export const packagesDeletedOwnerSchemaSteps: readonly SchemaStep[] = [
  {
    id: "apps.packages.release-deleted-owners",
    sql: "UPDATE packages SET owner_app = NULL WHERE owner_app IS NOT NULL AND owner_app NOT IN (SELECT id FROM apps);",
  },
];
