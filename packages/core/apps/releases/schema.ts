import type { SchemaStep } from "../../../protocol/server/mod.ts";

// releases 표. 준비 뒤 내용 열은 불변이고
// status·activation·activated_at·failure만 activation 결정이 바꾼다.
//
// 정규 선언 JSON(`declaration`)과 거기서 만든 선언 사실(`facts`)을 준비 때 한 번 같이 둔다.
// core는 파일을 읽지 않고 command·read는 동기라서 현재 release의 선언·설명·비교를 읽을 자리가
// ledger뿐이다. 선언 blob이 정본이고 이 열은 `declaration_hash`와 같은 byte의 사본이다.
// app·backup 참조는 다른 표의 생성 순서에 기대지 않으려고 물리 FK를 두지 않는다.
export const releasesSchemaSteps: readonly SchemaStep[] = [
  {
    id: "apps.releases.tables",
    sql: `
    CREATE TABLE releases (
      id TEXT PRIMARY KEY NOT NULL,
      app TEXT NOT NULL,
      number INTEGER NOT NULL CHECK (number > 0),
      code_commit TEXT NOT NULL CHECK (length(code_commit) = 40),
      bundle_hash TEXT NOT NULL CHECK (length(bundle_hash) = 64),
      declaration_hash TEXT NOT NULL CHECK (length(declaration_hash) = 64),
      data_schema INTEGER NOT NULL CHECK (data_schema >= 0),
      data_changes TEXT NOT NULL CHECK (json_valid(data_changes)),
      created_by TEXT NOT NULL CHECK (length(created_by) > 0),
      created_at TEXT NOT NULL CHECK (length(created_at) > 0),
      status TEXT NOT NULL CHECK (status IN (
        'prepared', 'activating', 'active', 'failed', 'superseded'
      )),
      activation TEXT CHECK (activation IS NULL OR json_valid(activation)),
      activated_at TEXT,
      failure TEXT CHECK (failure IS NULL OR json_valid(failure)),
      declaration TEXT NOT NULL CHECK (json_valid(declaration)),
      facts TEXT NOT NULL CHECK (json_valid(facts)),
      UNIQUE (app, id),
      UNIQUE (app, number),
      CHECK (status NOT IN ('activating', 'failed') OR activation IS NOT NULL),
      CHECK (status <> 'failed' OR failure IS NOT NULL),
      CHECK (status NOT IN ('active', 'superseded') OR activated_at IS NOT NULL)
    ) STRICT;
    CREATE UNIQUE INDEX releases_one_active ON releases(app)
      WHERE status = 'active';
    CREATE UNIQUE INDEX releases_one_activating ON releases(app)
      WHERE status = 'activating';
    CREATE INDEX releases_app_created ON releases(app, created_at, id);
    CREATE INDEX releases_app_status ON releases(app, status);
    CREATE TRIGGER releases_immutable BEFORE UPDATE ON releases
    WHEN NEW.id <> OLD.id OR NEW.app <> OLD.app OR NEW.number <> OLD.number
      OR NEW.code_commit <> OLD.code_commit
      OR NEW.bundle_hash <> OLD.bundle_hash
      OR NEW.declaration_hash <> OLD.declaration_hash
      OR NEW.data_schema <> OLD.data_schema
      OR NEW.data_changes <> OLD.data_changes
      OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at
      OR NEW.declaration <> OLD.declaration OR NEW.facts <> OLD.facts
    BEGIN SELECT RAISE(ABORT, 'prepared release content is immutable'); END;
    CREATE TRIGGER releases_no_delete BEFORE DELETE ON releases
    BEGIN SELECT RAISE(ABORT, 'releases are kept'); END;
    -- 이전 release로 돌아가기 요청. activate_previous가 쓰고 activation driver가 읽어 시작하고 activation.start가 지운다.
    CREATE TABLE activation_requests (
      release TEXT PRIMARY KEY NOT NULL REFERENCES releases(id),
      requested_at TEXT NOT NULL CHECK (length(requested_at) > 0)
    ) STRICT;
    -- activation 동의. 선언이 넓어진 release는 사람이 허락해야 시작한다. allowed_at이 NULL이면 사람을 기다리고,
    -- 값이 있으면 사람이 허락했고 아직 시작하지 않은 것이다(driver sweep이 시작하고 activation.start가 지운다).
    -- 표에 둔 이유: 재시작을 넘어야 한다. comparison은 canonicalize한 선언 비교다.
    CREATE TABLE activation_consents (
      release TEXT PRIMARY KEY NOT NULL REFERENCES releases(id),
      app TEXT NOT NULL,
      comparison TEXT NOT NULL CHECK (json_valid(comparison)),
      requested_at TEXT NOT NULL CHECK (length(requested_at) > 0),
      allowed_at TEXT
    ) STRICT;
    CREATE INDEX activation_consents_app ON activation_consents(app);
  `,
  },
  // 선언의 `tools`가 operations와 commands로 갈렸다. 옛 선언의 tool은 모두 command다(title과 outputSchema는 버린다).
  // 선언 사실(`facts`)의 모양은 그대로다. declaration_hash는 준비 때 낸 값이라 바꾸지 않는다.
  {
    id: "apps.releases.declaration-layers",
    sql: `
    DROP TRIGGER releases_immutable;
    UPDATE releases
       SET declaration = json_remove(
         json_insert(
           declaration,
           '$.operations', json('[]'),
           '$.commands', (
             SELECT json_group_array(json_remove(tool.value, '$.title', '$.outputSchema'))
               FROM json_each(releases.declaration, '$.tools') AS tool
           )
         ),
         '$.tools'
       )
     WHERE json_type(declaration, '$.tools') IS NOT NULL;
    UPDATE releases
       SET declaration = json_set(
         declaration,
         '$.app_connections', (
           SELECT json_group_array(json_object(
             'app', json_extract(use.value, '$.app'),
             'commands', json_extract(use.value, '$.tools'),
             'reason', json_extract(use.value, '$.reason')
           ))
             FROM json_each(releases.declaration, '$.app_connections') AS use
         )
       )
     WHERE json_type(declaration, '$.app_connections[0].tools') IS NOT NULL;
    CREATE TRIGGER releases_immutable BEFORE UPDATE ON releases
    WHEN NEW.id <> OLD.id OR NEW.app <> OLD.app OR NEW.number <> OLD.number
      OR NEW.code_commit <> OLD.code_commit
      OR NEW.bundle_hash <> OLD.bundle_hash
      OR NEW.declaration_hash <> OLD.declaration_hash
      OR NEW.data_schema <> OLD.data_schema
      OR NEW.data_changes <> OLD.data_changes
      OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at
      OR NEW.declaration <> OLD.declaration OR NEW.facts <> OLD.facts
    BEGIN SELECT RAISE(ABORT, 'prepared release content is immutable'); END;
  `,
  },
  // command의 `domain` 칸이 없어졌다. 칸이 남은 선언은 새 검사가 알 수 없는 칸으로 거절한다.
  // declaration_hash는 준비 때 낸 값이라 바꾸지 않는다.
  {
    id: "apps.releases.declaration-no-domain",
    sql: `
    DROP TRIGGER releases_immutable;
    UPDATE releases
       SET declaration = json_set(
         declaration,
         '$.commands', (
           SELECT json_group_array(json_remove(command.value, '$.domain'))
             FROM json_each(releases.declaration, '$.commands') AS command
         )
       )
     WHERE json_type(declaration, '$.commands[0].domain') IS NOT NULL;
    CREATE TRIGGER releases_immutable BEFORE UPDATE ON releases
    WHEN NEW.id <> OLD.id OR NEW.app <> OLD.app OR NEW.number <> OLD.number
      OR NEW.code_commit <> OLD.code_commit
      OR NEW.bundle_hash <> OLD.bundle_hash
      OR NEW.declaration_hash <> OLD.declaration_hash
      OR NEW.data_schema <> OLD.data_schema
      OR NEW.data_changes <> OLD.data_changes
      OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at
      OR NEW.declaration <> OLD.declaration OR NEW.facts <> OLD.facts
    BEGIN SELECT RAISE(ABORT, 'prepared release content is immutable'); END;
  `,
  },
  // 화면의 `sizes`가 `places`가 됐다(`full`은 `tab`). `sizes`가 남은 선언은 새 검사가 알 수 없는 칸으로 거절한다.
  // declaration_hash는 준비 때 낸 값이라 바꾸지 않는다.
  {
    id: "apps.releases.declaration-places",
    sql: `
    DROP TRIGGER releases_immutable;
    UPDATE releases
       SET declaration = json_set(
         declaration,
         '$.screens', (
           SELECT json_group_array(json_remove(
             json_set(
               screen.value,
               '$.places', (
                 SELECT json_group_array(CASE place.value WHEN 'full' THEN 'tab' ELSE place.value END)
                   FROM json_each(screen.value, '$.sizes') AS place
               )
             ),
             '$.sizes'
           ))
             FROM json_each(releases.declaration, '$.screens') AS screen
         )
       )
     WHERE json_type(declaration, '$.screens[0].sizes') IS NOT NULL;
    CREATE TRIGGER releases_immutable BEFORE UPDATE ON releases
    WHEN NEW.id <> OLD.id OR NEW.app <> OLD.app OR NEW.number <> OLD.number
      OR NEW.code_commit <> OLD.code_commit
      OR NEW.bundle_hash <> OLD.bundle_hash
      OR NEW.declaration_hash <> OLD.declaration_hash
      OR NEW.data_schema <> OLD.data_schema
      OR NEW.data_changes <> OLD.data_changes
      OR NEW.created_by <> OLD.created_by OR NEW.created_at <> OLD.created_at
      OR NEW.declaration <> OLD.declaration OR NEW.facts <> OLD.facts
    BEGIN SELECT RAISE(ABORT, 'prepared release content is immutable'); END;
  `,
  },
];
