import type { SchemaStep } from "../../../protocol/platform/mod.ts";

// domain-model apps/releases의 releases·release_tests 표. 준비 뒤 내용 열은 불변이고
// status·activation·failure만 activation 결정(apps#T18)이 바꾼다.
//
// 정규 blueprint JSON(`blueprint`)과 거기서 만든 선언 사실(`declarations`)을 준비 때 한 번 같이 둔다.
// core는 파일을 읽지 않고 command·read는 동기라서 현재 release의 선언·설명·비교를 읽을 자리가
// ledger뿐이다. blueprint blob이 정본이고 이 열은 `blueprint_hash`와 같은 byte의 사본이다.
// app·approval·backup 참조는 다른 표의 생성 순서에 기대지 않으려고 물리 FK를 두지 않는다.
export const releasesSchemaSteps: readonly SchemaStep[] = [{
  id: "apps.releases.tables",
  sql: `
    CREATE TABLE releases (
      id TEXT PRIMARY KEY NOT NULL,
      app TEXT NOT NULL,
      number INTEGER NOT NULL CHECK (number > 0),
      code_commit TEXT NOT NULL CHECK (length(code_commit) = 40),
      bundle_hash TEXT NOT NULL CHECK (length(bundle_hash) = 64),
      blueprint_hash TEXT NOT NULL CHECK (length(blueprint_hash) = 64),
      data_schema INTEGER NOT NULL CHECK (data_schema >= 0),
      data_changes TEXT NOT NULL CHECK (json_valid(data_changes)),
      ticket_source TEXT CHECK (ticket_source IS NULL OR json_valid(ticket_source)),
      created_by TEXT NOT NULL CHECK (length(created_by) > 0),
      created_at TEXT NOT NULL CHECK (length(created_at) > 0),
      status TEXT NOT NULL CHECK (status IN (
        'prepared', 'activating', 'active', 'failed', 'superseded'
      )),
      activation TEXT CHECK (activation IS NULL OR json_valid(activation)),
      failure TEXT CHECK (failure IS NULL OR json_valid(failure)),
      blueprint TEXT NOT NULL CHECK (json_valid(blueprint)),
      declarations TEXT NOT NULL CHECK (json_valid(declarations)),
      UNIQUE (app, id),
      UNIQUE (app, number),
      CHECK (status NOT IN ('activating', 'failed') OR activation IS NOT NULL),
      CHECK (status <> 'failed' OR failure IS NOT NULL)
    ) STRICT;
    CREATE UNIQUE INDEX releases_one_active ON releases(app)
      WHERE status = 'active';
    CREATE UNIQUE INDEX releases_one_activating ON releases(app)
      WHERE status = 'activating';
    CREATE INDEX releases_app_created ON releases(app, created_at, id);
    CREATE INDEX releases_app_status ON releases(app, status);
    CREATE INDEX releases_ticket_source ON releases(
      json_extract(ticket_source, '$.ticket'),
      json_extract(ticket_source, '$.claim_seq')
    );
    CREATE TRIGGER releases_immutable BEFORE UPDATE ON releases
    WHEN NEW.id <> OLD.id OR NEW.app <> OLD.app OR NEW.number <> OLD.number
      OR NEW.code_commit <> OLD.code_commit
      OR NEW.bundle_hash <> OLD.bundle_hash
      OR NEW.blueprint_hash <> OLD.blueprint_hash
      OR NEW.data_schema <> OLD.data_schema
      OR NEW.data_changes <> OLD.data_changes
      OR NEW.ticket_source IS NOT OLD.ticket_source
      OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at
      OR NEW.blueprint <> OLD.blueprint OR NEW.declarations <> OLD.declarations
    BEGIN SELECT RAISE(ABORT, 'prepared release content is immutable'); END;
    CREATE TRIGGER releases_no_delete BEFORE DELETE ON releases
    BEGIN SELECT RAISE(ABORT, 'releases are kept'); END;
    CREATE TABLE release_tests (
      release TEXT NOT NULL REFERENCES releases(id),
      verification TEXT NOT NULL CHECK (length(verification) > 0),
      PRIMARY KEY (release, verification)
    ) STRICT;
    CREATE INDEX release_tests_verification ON release_tests(verification, release);
    CREATE TRIGGER release_tests_immutable BEFORE UPDATE ON release_tests
    BEGIN SELECT RAISE(ABORT, 'release tests are immutable'); END;
    CREATE TRIGGER release_tests_no_delete BEFORE DELETE ON release_tests
    BEGIN SELECT RAISE(ABORT, 'release tests are kept'); END;
  `,
}];
