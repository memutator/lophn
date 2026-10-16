import type { SchemaStep } from "../../../protocol/server/mod.ts";

// ticket 표. 내용(goal, acceptance_check, 근거)은 닫히기(verified, cancelled) 전까지 고칠 수 있고
// 닫힌 뒤에는 trigger가 막는다. 보고(completion)와 결과는 쌓이기만 한다.
// cross-owner FK(apps, releases, problems)는 그 표가 이 step 이후에도 없을 수 있어 두지 않는다.
// 존재·범위는 command가 같은 transaction에서 검사한다.
const IMMUTABLE = (table: string) => `
create trigger ${table}_no_update
before update on ${table}
begin
  select raise(abort, 'immutable');
end;
create trigger ${table}_no_delete
before delete on ${table}
begin
  select raise(abort, 'immutable');
end;`;

export const ticketSchemaSteps: readonly SchemaStep[] = [{
  id: "coding-agent.tickets.tables",
  sql: `
    CREATE TABLE tickets (
      id TEXT PRIMARY KEY NOT NULL,
      app TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN (
        'open', 'claimed', 'reported', 'verified', 'failed', 'cancelled'
      )),
      goal TEXT NOT NULL CHECK (length(trim(goal)) > 0),
      acceptance_check TEXT NOT NULL CHECK (json_valid(acceptance_check)),
      cancel_reason TEXT,
      completion_seq TEXT,
      revision TEXT NOT NULL,
      CHECK ((state = 'cancelled') = (cancel_reason IS NOT NULL)),
      CHECK (completion_seq IS NOT NULL OR state NOT IN ('reported', 'verified', 'failed'))
    ) STRICT;
    CREATE INDEX tickets_app_state_id ON tickets(app, state, id);
    CREATE INDEX tickets_state_id ON tickets(state, id);
    create trigger tickets_no_id_change
      before update of id, app on tickets
    begin
      select raise(abort, 'ticket id and app are immutable');
    end;
    create trigger tickets_closed_content
      BEFORE UPDATE OF goal, acceptance_check ON tickets
      WHEN OLD.state IN ('verified', 'cancelled')
    BEGIN
      SELECT RAISE(ABORT, 'a closed ticket cannot be edited');
    END;
    create trigger tickets_no_reopen
      BEFORE UPDATE OF state ON tickets
      WHEN OLD.state IN ('verified', 'cancelled')
    BEGIN
      SELECT RAISE(ABORT, 'verified and cancelled tickets do not reopen');
    END;
    create trigger tickets_no_delete
      BEFORE DELETE ON tickets
    BEGIN
      SELECT RAISE(ABORT, 'tickets are cancelled, not deleted');
    END;

    CREATE TABLE ticket_references (
      ticket TEXT NOT NULL REFERENCES tickets(id),
      position INTEGER NOT NULL CHECK (position >= 0),
      kind TEXT NOT NULL CHECK (kind IN ('problem', 'ticket', 'release', 'file', 'annotation')),
      target TEXT NOT NULL,
      PRIMARY KEY (ticket, position),
      UNIQUE (ticket, kind, target)
    ) STRICT;
    CREATE INDEX ticket_references_kind_target
      ON ticket_references(kind, target, ticket);

    CREATE TABLE ticket_claims (
      ticket TEXT PRIMARY KEY NOT NULL REFERENCES tickets(id),
      session TEXT NOT NULL,
      claim_seq TEXT NOT NULL,
      expires_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX ticket_claims_session ON ticket_claims(session, ticket);
    CREATE INDEX ticket_claims_expires_at ON ticket_claims(expires_at, ticket);

    CREATE TABLE ticket_completions (
      ticket TEXT NOT NULL REFERENCES tickets(id),
      seq TEXT NOT NULL,
      session TEXT NOT NULL,
      claim_seq TEXT NOT NULL,
      release TEXT NOT NULL,
      summary_hash TEXT NOT NULL,
      fix_records TEXT NOT NULL,
      verifications TEXT NOT NULL,
      PRIMARY KEY (ticket, seq),
      UNIQUE (seq)
    ) STRICT;
    CREATE INDEX ticket_completions_session ON ticket_completions(session, seq);
    ${IMMUTABLE("ticket_completions")}

    CREATE TABLE ticket_check_results (
      ticket TEXT NOT NULL REFERENCES tickets(id),
      completion_seq TEXT NOT NULL,
      result TEXT NOT NULL CHECK (result IN ('pass', 'fail', 'inconclusive')),
      reason TEXT NOT NULL,
      verification TEXT,
      PRIMARY KEY (ticket, completion_seq),
      FOREIGN KEY (ticket, completion_seq)
        REFERENCES ticket_completions(ticket, seq)
    ) STRICT;

    CREATE TABLE ticket_verdicts (
      ticket TEXT NOT NULL REFERENCES tickets(id),
      completion_seq TEXT NOT NULL,
      result TEXT NOT NULL CHECK (result IN ('verified', 'failed')),
      note TEXT,
      PRIMARY KEY (ticket, completion_seq),
      FOREIGN KEY (ticket, completion_seq)
        REFERENCES ticket_completions(ticket, seq)
    ) STRICT;
    ${IMMUTABLE("ticket_verdicts")}
  `,
}];
