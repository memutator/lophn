import type { SchemaStep } from "../../protocol/server/mod.ts";

// domain은 project나 app 하나에 속한다. owner는 다른 module의 표라 물리 FK를 두지 않는다.
// 이름은 보관한 것까지 전 domain에서 하나다. 이름 바꾸기와 owner 옮기기는 없다. 보관은 삭제가 아니라 status다.
export const domainsSchemaSteps: readonly SchemaStep[] = [
  {
    id: "domains.tables",
    sql: `
    CREATE TABLE domains (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL CHECK (length(title) > 0),
      purpose TEXT NOT NULL,
      owner_kind TEXT NOT NULL CHECK (owner_kind IN ('project', 'app')),
      owner_id TEXT NOT NULL CHECK (length(owner_id) > 0),
      revision TEXT NOT NULL CHECK (
        length(revision) > 0 AND substr(revision, 1, 1) BETWEEN '1' AND '9'
        AND revision NOT GLOB '*[^0-9]*'
        AND (length(revision) < 19 OR
          (length(revision) = 19 AND revision <= '9223372036854775807'))
      ),
      status TEXT NOT NULL CHECK (status IN ('active', 'archived'))
    ) STRICT;
    CREATE INDEX domains_owner ON domains(owner_kind, owner_id, status);
    CREATE TRIGGER domains_no_identity_change
    BEFORE UPDATE OF id, name, owner_kind, owner_id ON domains
    WHEN NEW.id <> OLD.id OR NEW.name <> OLD.name
      OR NEW.owner_kind <> OLD.owner_kind OR NEW.owner_id <> OLD.owner_id
    BEGIN SELECT RAISE(ABORT, 'domain identity is immutable'); END;
    CREATE TRIGGER domains_no_delete BEFORE DELETE ON domains
    BEGIN SELECT RAISE(ABORT, 'domains are archived, not deleted'); END;
  `,
  },
];
