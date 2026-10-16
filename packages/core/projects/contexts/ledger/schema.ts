// context ledger 표(domain-model/documents/contexts, documents/terms의 "ledger 표")의 SQL이다.
// 새 모델의 표라서 옛 `contexts`·`context_items`·`terms` 표와 이름이 겹친다. 옛 표는 옮기지 않는다
// (개발 ledger는 초기화한다). 그래서 step id도 옛 id와 다르게 둔다.
//
// 표는 걸 수 있는 제약을 모두 건다. handler가 먼저 거절하므로 이 제약은 마지막 방어선이고,
// adapter가 잘못된 행을 쓰려 하면 transaction 전체가 rollback된다.
//
// 순환 참조: contexts.applied_bundle → context_bundles → contexts, context_bundles.check →
// context_checks → context_bundles. 순환하는 두 열은 DEFERRABLE INITIALLY DEFERRED라서
// 한 transaction 안에서 어떤 순서로 쓰든 commit 때 맞으면 된다.
import type { SchemaStep } from "../../../../protocol/server/mod.ts";

// GLOB은 문자 클래스 하나마다 패턴 길이를 세므로 긴 패턴은 거절된다. 접두사·길이·ULID 문자 집합을
// 나누어 검사한다. 첫 글자는 시각 48bit의 상위 bit라 0~7이다(contracts/platform/ids.ts).
const idCheck = (column: string, prefix: string) =>
  `${column} GLOB '${prefix}_*' AND length(${column}) = ${
    prefix.length + 1 + 26
  }` +
  ` AND substr(${column}, ${prefix.length + 2}, 1) BETWEEN '0' AND '7'` +
  ` AND substr(${column}, ${
    prefix.length + 2
  }) NOT GLOB '*[^0-9a-hjkmnp-tv-z]*'`;

const optionalId = (column: string, prefix: string) =>
  `${column} IS NULL OR (${idCheck(column, prefix)})`;

// SQLite trim은 기본으로 공백만 자른다. 탭·줄바꿈까지 자르도록 문자 집합을 준다.
const WS = "char(9, 10, 11, 12, 13, 32)";
const nonblank = (column: string) => `length(trim(${column}, ${WS})) > 0`;
const trimmed = (column: string) => `${column} = trim(${column}, ${WS})`;

const SEQ =
  "length(revision) > 0 AND substr(revision, 1, 1) BETWEEN '1' AND '9'" +
  " AND revision NOT GLOB '*[^0-9]*'" +
  " AND (length(revision) < 19 OR" +
  " (length(revision) = 19 AND revision <= '9223372036854775807'))";

const sha256 = (column: string) =>
  `length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*'`;
const optionalSha256 = (column: string) =>
  `${column} IS NULL OR (${sha256(column)})`;

// atSchema: 2026-10-12T00:00:00.000Z
const AT_GLOB =
  "'[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'";
const at = (column: string) =>
  `${column} GLOB ${AT_GLOB} AND length(${column}) = 24`;

const GLOSSARY_ENTRY_LIMIT = 200;

export const contextsLedgerSchemaSteps: readonly SchemaStep[] = [{
  // contexts: Context(id, project, title, purpose, status, applied_bundle, violation_mark, revision).
  // 보관만 하고 삭제는 없다. project는 생성 뒤 바뀌지 않는다.
  id: "documents.contexts.ledger.contexts",
  sql: `
    CREATE TABLE contexts (
      id TEXT PRIMARY KEY NOT NULL CHECK (${idCheck("id", "ctx")}),
      project TEXT NOT NULL REFERENCES projects(id)
        CHECK (${idCheck("project", "prj")}),
      title TEXT NOT NULL CHECK (${nonblank("title")}),
      purpose TEXT NOT NULL CHECK (${nonblank("purpose")}),
      status TEXT NOT NULL CHECK (status IN ('drafting', 'active', 'archived')),
      applied_bundle TEXT REFERENCES context_bundles(id)
        DEFERRABLE INITIALLY DEFERRED
        CHECK (${optionalId("applied_bundle", "cbn")}),
      violation_mark INTEGER NOT NULL DEFAULT 0 CHECK (violation_mark >= 0),
      revision TEXT NOT NULL CHECK (${SEQ}),
      CHECK (status <> 'drafting' OR applied_bundle IS NULL),
      CHECK (status <> 'active' OR applied_bundle IS NOT NULL)
    ) STRICT;
    -- (project, title) 유일. handler가 다듬은 글로 비교하므로 index도 다듬은 글로 건다.
    CREATE UNIQUE INDEX contexts_project_title
      ON contexts(project, trim(title, ${WS}));
    CREATE INDEX contexts_project_status ON contexts(project, status);
    CREATE TRIGGER contexts_no_identity_change
      BEFORE UPDATE OF id, project ON contexts
      WHEN NEW.id <> OLD.id OR NEW.project <> OLD.project
      BEGIN SELECT RAISE(ABORT, 'context identity and project are immutable'); END;
    CREATE TRIGGER contexts_no_delete BEFORE DELETE ON contexts
      BEGIN SELECT RAISE(ABORT, 'contexts are archived, not deleted'); END;
    -- context_violation_keys: context.record_violations가 마지막으로 기록한 위반 키들(JSON 배열 글).
    -- 다음 기록이 새 위반이 생겼는지를 집합으로 가리는 기준이다.
    CREATE TABLE context_violation_keys (
      context TEXT PRIMARY KEY NOT NULL REFERENCES contexts(id)
        CHECK (${idCheck("context", "ctx")}),
      keys TEXT NOT NULL
        CHECK (json_valid(keys) AND json_type(keys) = 'array')
    ) STRICT;
    -- context_app_data: 적용된 판의 계약이 app-data source로 읽는 앱 slug들. 판을 적용할 때(적용·되돌리기)
    -- 같은 transaction에서 그 판의 content로 다시 채운다. 읽기 권한(앱 하나에 묶인 agent)이 판의
    -- content blob을 열지 않고 이 표만 본다.
    CREATE TABLE context_app_data (
      context TEXT NOT NULL REFERENCES contexts(id)
        CHECK (${idCheck("context", "ctx")}),
      app TEXT NOT NULL
        CHECK (length(app) BETWEEN 1 AND 63 AND app GLOB '[a-z]*'
          AND app NOT GLOB '*[^a-z0-9-]*'),
      PRIMARY KEY (context, app)
    ) STRICT, WITHOUT ROWID;
  `,
}, {
  // context_bundles: 판. content는 blob이라 참조(hash, size)만 둔다. 번호 있는 판은 submit 뒤 불변이다.
  id: "documents.contexts.ledger.context-bundles",
  sql: `
    CREATE TABLE context_bundles (
      id TEXT PRIMARY KEY NOT NULL CHECK (${idCheck("id", "cbn")}),
      context TEXT NOT NULL REFERENCES contexts(id)
        CHECK (${idCheck("context", "ctx")}),
      number INTEGER CHECK (number IS NULL OR number >= 1),
      parent TEXT REFERENCES context_bundles(id)
        CHECK (${optionalId("parent", "cbn")}),
      content_hash TEXT NOT NULL CHECK (${sha256("content_hash")}),
      content_size INTEGER NOT NULL CHECK (content_size >= 0),
      bundle_hash TEXT CHECK (${optionalSha256("bundle_hash")}),
      status TEXT NOT NULL CHECK (status IN (
        'draft', 'checking', 'failed', 'applied', 'superseded', 'discarded'
      )),
      "check" TEXT REFERENCES context_checks(id)
        DEFERRABLE INITIALLY DEFERRED
        CHECK (${optionalId('"check"', "chk")}),
      created_by TEXT NOT NULL CHECK (length(created_by) > 0),
      revision TEXT NOT NULL CHECK (${SEQ}),
      -- 번호·hash·check는 submit한 판(checking 이후)에만 있다.
      CHECK (
        (status IN ('draft', 'discarded')
          AND number IS NULL AND bundle_hash IS NULL AND "check" IS NULL) OR
        (status IN ('checking', 'failed', 'applied', 'superseded')
          AND number IS NOT NULL AND bundle_hash IS NOT NULL
          AND "check" IS NOT NULL)
      ),
      UNIQUE (context, number)
    ) STRICT;
    CREATE INDEX context_bundles_context_status ON context_bundles(context, status);
    -- 한 context에 draft·checking·applied는 많아야 하나다. 적용과 물러남은 한 transaction이므로
    -- 쓰는 쪽은 물러나는 행을 먼저 갱신한다.
    CREATE UNIQUE INDEX context_bundles_one_draft
      ON context_bundles(context) WHERE status = 'draft';
    CREATE UNIQUE INDEX context_bundles_one_checking
      ON context_bundles(context) WHERE status = 'checking';
    CREATE UNIQUE INDEX context_bundles_one_applied
      ON context_bundles(context) WHERE status = 'applied';
    CREATE TRIGGER context_bundles_no_identity_change
      BEFORE UPDATE OF id, context, parent ON context_bundles
      WHEN NEW.id <> OLD.id OR NEW.context <> OLD.context
        OR NEW.parent IS NOT OLD.parent
      BEGIN SELECT RAISE(ABORT, 'bundle identity, context and parent are immutable'); END;
    CREATE TRIGGER context_bundles_no_delete BEFORE DELETE ON context_bundles
      BEGIN SELECT RAISE(ABORT, 'bundles are never deleted'); END;
    -- 버린 draft와 실패한 판은 더 바뀌지 않는다.
    CREATE TRIGGER context_bundles_terminal BEFORE UPDATE ON context_bundles
      WHEN OLD.status IN ('discarded', 'failed')
      BEGIN SELECT RAISE(ABORT, 'a discarded or failed bundle does not change'); END;
    CREATE TRIGGER context_bundles_transition BEFORE UPDATE OF status ON context_bundles
      WHEN NEW.status <> OLD.status AND (OLD.status || '>' || NEW.status) NOT IN (
        'draft>discarded', 'draft>checking', 'checking>failed',
        'checking>applied', 'applied>superseded', 'superseded>applied'
      )
      BEGIN SELECT RAISE(ABORT, 'bundle status transition is not allowed'); END;
    -- submit 뒤 content·hash·번호·check는 바뀌지 않는다.
    CREATE TRIGGER context_bundles_frozen
      BEFORE UPDATE OF number, bundle_hash, content_hash, content_size, "check"
      ON context_bundles
      WHEN OLD.number IS NOT NULL AND (
        NEW.number IS NOT OLD.number OR NEW.bundle_hash IS NOT OLD.bundle_hash
        OR NEW.content_hash <> OLD.content_hash
        OR NEW.content_size <> OLD.content_size
        OR NEW."check" IS NOT OLD."check")
      BEGIN SELECT RAISE(ABORT, 'a submitted bundle is frozen'); END;
    -- 번호는 context 안에서 늘기만 한다.
    CREATE TRIGGER context_bundles_number_grows BEFORE UPDATE OF number ON context_bundles
      WHEN OLD.number IS NULL AND NEW.number IS NOT NULL AND NEW.number <=
        COALESCE((SELECT max(number) FROM context_bundles
                  WHERE context = NEW.context), 0)
      BEGIN SELECT RAISE(ABORT, 'bundle numbers only grow'); END;
  `,
}, {
  // context_checks: 판 하나에 검사 하나. running에서 passed·failed로 한 번만 바뀐다.
  // findings는 JSON 배열 글이다(큰 내용을 blob으로 빼는 일은 열린 질문: findings 크기).
  id: "documents.contexts.ledger.context-checks",
  sql: `
    CREATE TABLE context_checks (
      id TEXT PRIMARY KEY NOT NULL CHECK (${idCheck("id", "chk")}),
      context TEXT NOT NULL REFERENCES contexts(id)
        CHECK (${idCheck("context", "ctx")}),
      bundle TEXT NOT NULL UNIQUE REFERENCES context_bundles(id)
        CHECK (${idCheck("bundle", "cbn")}),
      status TEXT NOT NULL CHECK (status IN ('running', 'passed', 'failed')),
      snapshot_hash TEXT CHECK (${optionalSha256("snapshot_hash")}),
      findings TEXT NOT NULL
        CHECK (json_valid(findings) AND json_type(findings) = 'array'),
      violation_count INTEGER CHECK (violation_count IS NULL OR violation_count >= 0),
      started_at TEXT NOT NULL CHECK (${at("started_at")}),
      finished_at TEXT CHECK (finished_at IS NULL OR (${at("finished_at")})),
      CHECK (
        (status = 'running' AND finished_at IS NULL AND violation_count IS NULL
          AND snapshot_hash IS NULL AND json_array_length(findings) = 0) OR
        (status = 'passed' AND finished_at IS NOT NULL
          AND violation_count IS NOT NULL AND snapshot_hash IS NOT NULL
          AND json_array_length(findings) = 0) OR
        (status = 'failed' AND finished_at IS NOT NULL
          AND violation_count IS NOT NULL AND snapshot_hash IS NOT NULL
          AND json_array_length(findings) >= 1)
      )
    ) STRICT;
    CREATE INDEX context_checks_context_status ON context_checks(context, status);
    CREATE TRIGGER context_checks_no_identity_change
      BEFORE UPDATE OF id, context, bundle, started_at ON context_checks
      WHEN NEW.id <> OLD.id OR NEW.context <> OLD.context
        OR NEW.bundle <> OLD.bundle OR NEW.started_at <> OLD.started_at
      BEGIN SELECT RAISE(ABORT, 'check identity is immutable'); END;
    CREATE TRIGGER context_checks_finished BEFORE UPDATE ON context_checks
      WHEN OLD.status <> 'running'
      BEGIN SELECT RAISE(ABORT, 'a finished check does not change'); END;
    CREATE TRIGGER context_checks_no_delete BEFORE DELETE ON context_checks
      BEGIN SELECT RAISE(ABORT, 'checks are never deleted'); END;
  `,
}, {
  // saved_views: 선언된 검색의 호출. inputs는 JSON 객체 글이다. 이름은 context 안에서 유일하다.
  id: "documents.contexts.ledger.saved-views",
  sql: `
    CREATE TABLE saved_views (
      id TEXT PRIMARY KEY NOT NULL CHECK (${idCheck("id", "viw")}),
      context TEXT NOT NULL REFERENCES contexts(id)
        CHECK (${idCheck("context", "ctx")}),
      name TEXT NOT NULL CHECK (${nonblank("name")}),
      search TEXT NOT NULL
        CHECK (search GLOB '[a-z]*' AND search NOT GLOB '*[^a-z0-9_]*'),
      inputs TEXT NOT NULL
        CHECK (json_valid(inputs) AND json_type(inputs) = 'object'),
      origin TEXT NOT NULL CHECK (origin IN ('user', 'project_manager')),
      revision TEXT NOT NULL CHECK (${SEQ})
    ) STRICT;
    CREATE UNIQUE INDEX saved_views_context_name ON saved_views(context, name);
    CREATE INDEX saved_views_context ON saved_views(context);
    CREATE TRIGGER saved_views_no_identity_change
      BEFORE UPDATE OF id, context ON saved_views
      WHEN NEW.id <> OLD.id OR NEW.context <> OLD.context
      BEGIN SELECT RAISE(ABORT, 'saved view identity and context are immutable'); END;
  `,
}, {
  // glossary_entries: 용어집. 용어는 앞뒤 공백을 자른 1~80자, 뜻은 1~1000자이고 한 context에 200개
  // 이하다. 같은 context의 용어는 ASCII 대소문자를 무시하고 유일하다(SQLite lower()는 ASCII만 바꾼다).
  // 읽기 순서(lower(term)의 byte 순, 같으면 id)는 이 index가 받친다.
  id: "documents.contexts.ledger.glossary-entries",
  sql: `
    CREATE TABLE glossary_entries (
      id TEXT PRIMARY KEY NOT NULL CHECK (${idCheck("id", "trm")}),
      context TEXT NOT NULL REFERENCES contexts(id)
        CHECK (${idCheck("context", "ctx")}),
      term TEXT NOT NULL
        CHECK (${trimmed("term")} AND length(term) BETWEEN 1 AND 80),
      meaning TEXT NOT NULL
        CHECK (${trimmed("meaning")} AND length(meaning) BETWEEN 1 AND 1000),
      set_by TEXT NOT NULL CHECK (set_by IN ('user', 'project_manager')),
      updated_at TEXT NOT NULL CHECK (${at("updated_at")}),
      revision TEXT NOT NULL CHECK (${SEQ})
    ) STRICT;
    CREATE UNIQUE INDEX glossary_entries_context_term
      ON glossary_entries(context, lower(term));
    CREATE TRIGGER glossary_entries_no_identity_change
      BEFORE UPDATE OF id, context ON glossary_entries
      WHEN NEW.id <> OLD.id OR NEW.context <> OLD.context
      BEGIN SELECT RAISE(ABORT, 'glossary entry identity and context are immutable'); END;
    CREATE TRIGGER glossary_entries_limit BEFORE INSERT ON glossary_entries
      WHEN (SELECT count(*) FROM glossary_entries WHERE context = NEW.context)
        >= ${GLOSSARY_ENTRY_LIMIT}
      BEGIN SELECT RAISE(ABORT, 'a context holds at most ${GLOSSARY_ENTRY_LIMIT} glossary entries'); END;
  `,
}];
