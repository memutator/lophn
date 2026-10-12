import type { SchemaStep } from "../../protocol/server/mod.ts";

// domain-model coding-agent/connection의 표. token 원문 열은 없다.
// principal·scope 짝은 CHECK로 강제하고 command도 같은 규칙을 다시 검사한다.
export const connectionSchemaSteps: readonly SchemaStep[] = [{
  id: "coding-agent.connection.tables",
  sql: `
    CREATE TABLE coding_agent_connections (
      id TEXT PRIMARY KEY NOT NULL,
      label TEXT NOT NULL CHECK (length(trim(label)) > 0),
      scope_kind TEXT NOT NULL CHECK (scope_kind IN ('all', 'app')),
      scope_app TEXT,
      principal TEXT NOT NULL UNIQUE,
      token_hash TEXT NOT NULL UNIQUE,
      state TEXT NOT NULL CHECK (state IN ('active', 'revoked')),
      revision TEXT NOT NULL CHECK (
        length(revision) > 0 AND substr(revision, 1, 1) BETWEEN '1' AND '9'
        AND revision NOT GLOB '*[^0-9]*'
        AND (length(revision) < 19 OR
          (length(revision) = 19 AND revision <= '9223372036854775807'))
      ),
      CHECK (
        (scope_kind = 'all' AND scope_app IS NULL) OR
        (scope_kind = 'app' AND scope_app IS NOT NULL)
      ),
      CHECK (principal = 'coding_agent:' || id)
    ) STRICT;
    CREATE INDEX coding_agent_connections_state_id
      ON coding_agent_connections(state, id);
    CREATE INDEX coding_agent_connections_scope_app_state_id
      ON coding_agent_connections(scope_app, state, id);
    CREATE TRIGGER coding_agent_connections_no_identity_change
      BEFORE UPDATE OF id, principal, token_hash, scope_kind, scope_app
      ON coding_agent_connections
    BEGIN
      SELECT RAISE(ABORT, 'connection identity and scope are immutable');
    END;
    CREATE TRIGGER coding_agent_connections_no_reactivate
      BEFORE UPDATE OF state ON coding_agent_connections
      WHEN OLD.state = 'revoked'
    BEGIN
      SELECT RAISE(ABORT, 'revoked connection cannot be reactivated');
    END;
    CREATE TRIGGER coding_agent_connections_no_delete
      BEFORE DELETE ON coding_agent_connections
    BEGIN
      SELECT RAISE(ABORT, 'connections are revoked, not deleted');
    END;
  `,
}];
