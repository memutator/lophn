import type { SchemaStep } from "../../../protocol/server/mod.ts";

// domain-model apps/sdk의 ledger 표. release 참조는 releases 표의 위치가 다른
// 조립이므로 물리 FK를 두지 않고, bundle_hash·guide_hash의 실제 byte는 blob이다.
// 공개한 name·version은 바꾸거나 지우지 않는다 — trigger가 update·delete를 막는다.
export const sdkSchemaSteps: readonly SchemaStep[] = [{
  id: "apps.sdk.tables",
  sql: `
    CREATE TABLE packages (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE CHECK (name GLOB '@me/*' OR name GLOB '@lophn/*'),
      description TEXT NOT NULL CHECK (
        length(description) > 0 AND instr(description, char(10)) = 0
        AND instr(description, char(13)) = 0
      ),
      kind TEXT NOT NULL CHECK (
        kind IN ('component', 'capability', 'domain', 'format')
      )
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
      PRIMARY KEY (package, version),
      FOREIGN KEY (package) REFERENCES packages (id)
    ) STRICT;
    CREATE TRIGGER package_versions_no_update BEFORE UPDATE ON package_versions
    BEGIN SELECT RAISE(ABORT, 'published version bytes are immutable'); END;
    CREATE TRIGGER package_versions_no_delete BEFORE DELETE ON package_versions
    BEGIN SELECT RAISE(ABORT, 'published version bytes are immutable'); END;
    CREATE TRIGGER packages_no_kind_change BEFORE UPDATE ON packages
    WHEN NEW.kind <> OLD.kind
    BEGIN SELECT RAISE(ABORT, 'package kind is immutable'); END;
  `,
}];
