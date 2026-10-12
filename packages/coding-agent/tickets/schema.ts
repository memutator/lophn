import type { SchemaStep } from "../../protocol/platform/mod.ts";

// domain-model coding-agent/tickets의 ledger 표 9개. JSON 열은 command가
// schema.parse한 값만 넣으므로 CHECK는 키·참조·상태 짝만 강제한다.
// cross-owner FK(apps, releases, problems, documents, coding_agent_connections)는
// 그 표가 이 step 이후에도 없을 수 있어 여기서 두지 않는다. 존재·종류·scope는
// command가 port와 같은 transaction에서 검사한다.
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

// 종료가 아닌 repair 예약은 제거하지 않는다. 예약 행 제거는 아래 trigger가
// confirmed·cancelled 상태 전이에서만 허용한다.
const OPEN_REPAIR_GUARD = `
create trigger ticket_open_repair_problems_keep
before delete on ticket_open_repair_problems
when not exists (
  select 1 from tickets
  where tickets.id = old.ticket
    and tickets.state in ('confirmed', 'cancelled')
)
begin
  select raise(abort, 'repair reservation survives until ticket ends');
end;`;

export const ticketSchemaSteps: readonly SchemaStep[] = [{
  id: "coding-agent.tickets.tables",
  sql: `
    CREATE TABLE tickets (
      id TEXT PRIMARY KEY NOT NULL,
      app TEXT NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('implementation', 'repair')),
      title TEXT NOT NULL CHECK (length(trim(title)) > 0),
      what TEXT NOT NULL,
      why TEXT NOT NULL,
      inspect TEXT NOT NULL,
      preserve TEXT NOT NULL,
      problems TEXT NOT NULL,
      state TEXT NOT NULL CHECK (state IN (
        'open', 'claimed', 'reported', 'confirmed', 'check_failed', 'cancelled'
      )),
      readiness TEXT NOT NULL CHECK (readiness IN ('needs_confirmation', 'ready')),
      needs TEXT NOT NULL,
      cancel_reason TEXT,
      completion_seq TEXT,
      revision TEXT NOT NULL,
      CHECK (
        (readiness = 'needs_confirmation' AND needs <> '[]') OR
        (readiness = 'ready' AND needs = '[]')
      ),
      CHECK (
        (state = 'cancelled') = (cancel_reason IS NOT NULL)
      ),
      CHECK (
        (completion_seq IS NOT NULL) OR state NOT IN ('reported', 'confirmed', 'check_failed')
      )
    ) STRICT;
    CREATE INDEX tickets_app_state_id ON tickets(app, state, id);
    CREATE INDEX tickets_state_id ON tickets(state, id);
    CREATE INDEX tickets_completion_seq ON tickets(completion_seq);
    create trigger tickets_no_update
      before update of id on tickets
    begin
      select raise(abort, 'ticket id is immutable');
    end;
    create trigger tickets_no_identity_change
      BEFORE UPDATE OF id, app, kind, title, what, why, problems
      ON tickets
    BEGIN
      SELECT RAISE(ABORT, 'ticket immutable fields are immutable');
    END;
    create trigger tickets_no_readiness_change
      BEFORE UPDATE OF readiness, needs ON tickets
      WHEN OLD.readiness = 'ready'
    BEGIN
      SELECT RAISE(ABORT, 'ready ticket does not return to needs_confirmation');
    END;
    create trigger tickets_no_confirmed_reopen
      BEFORE UPDATE OF state ON tickets
      WHEN OLD.state IN ('confirmed', 'cancelled')
    BEGIN
      SELECT RAISE(ABORT, 'confirmed and cancelled tickets do not reopen');
    END;
    create trigger tickets_no_delete
      BEFORE DELETE ON tickets
    BEGIN
      SELECT RAISE(ABORT, 'tickets are cancelled, not deleted');
    END;

    CREATE TABLE ticket_references (
      ticket TEXT NOT NULL REFERENCES tickets(id),
      position INTEGER NOT NULL CHECK (position >= 0),
      kind TEXT NOT NULL CHECK (kind IN ('version', 'problem', 'ticket', 'release')),
      target TEXT NOT NULL,
      address TEXT,
      section TEXT,
      PRIMARY KEY (ticket, position),
      UNIQUE (ticket, kind, target, address, section),
      CHECK ((kind = 'version') = (address IS NOT NULL)),
      CHECK (section IS NULL OR kind = 'version')
    ) STRICT;
    CREATE INDEX ticket_references_kind_target
      ON ticket_references(kind, target, ticket);
    ${IMMUTABLE("ticket_references")}

    CREATE TABLE ticket_adoption_questions (
      ticket TEXT NOT NULL REFERENCES tickets(id),
      position INTEGER NOT NULL CHECK (position >= 0),
      question TEXT NOT NULL,
      PRIMARY KEY (ticket, position),
      UNIQUE (ticket, question)
    ) STRICT;
    CREATE INDEX ticket_adoption_questions_question
      ON ticket_adoption_questions(question, ticket);
    ${IMMUTABLE("ticket_adoption_questions")}

    CREATE TABLE ticket_conditions (
      ticket TEXT NOT NULL REFERENCES tickets(id),
      position INTEGER NOT NULL CHECK (position >= 0),
      kind TEXT NOT NULL,
      input TEXT NOT NULL,
      condition_hash TEXT NOT NULL,
      PRIMARY KEY (ticket, position)
    ) STRICT;
    ${IMMUTABLE("ticket_conditions")}

    CREATE TABLE ticket_problems (
      ticket TEXT NOT NULL REFERENCES tickets(id),
      position INTEGER NOT NULL CHECK (position >= 0),
      problem TEXT NOT NULL,
      PRIMARY KEY (ticket, position),
      UNIQUE (ticket, problem)
    ) STRICT;
    CREATE INDEX ticket_problems_problem ON ticket_problems(problem, ticket);
    ${IMMUTABLE("ticket_problems")}

    CREATE TABLE ticket_open_repair_problems (
      problem TEXT PRIMARY KEY NOT NULL,
      ticket TEXT NOT NULL,
      UNIQUE (ticket, problem),
      FOREIGN KEY (ticket, problem)
        REFERENCES ticket_problems(ticket, problem)
    ) STRICT;
    CREATE INDEX ticket_open_repair_problems_ticket
      ON ticket_open_repair_problems(ticket);
    ${OPEN_REPAIR_GUARD}

    CREATE TABLE ticket_claims (
      ticket TEXT PRIMARY KEY NOT NULL REFERENCES tickets(id),
      connection TEXT NOT NULL,
      claim_seq TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX ticket_claims_connection ON ticket_claims(connection, ticket);
    CREATE INDEX ticket_claims_expires_at ON ticket_claims(expires_at, ticket);

    CREATE TABLE ticket_completions (
      ticket TEXT NOT NULL REFERENCES tickets(id),
      seq TEXT NOT NULL,
      claim_seq TEXT NOT NULL,
      release TEXT NOT NULL,
      summary_hash TEXT NOT NULL,
      outputs TEXT NOT NULL,
      fix_records TEXT NOT NULL,
      verifications TEXT NOT NULL,
      PRIMARY KEY (ticket, seq),
      UNIQUE (seq)
    ) STRICT;
    CREATE INDEX ticket_completions_release
      ON ticket_completions(release, ticket);
    CREATE INDEX ticket_completions_claim_seq
      ON ticket_completions(claim_seq);
    ${IMMUTABLE("ticket_completions")}

    CREATE TABLE ticket_check_results (
      ticket TEXT NOT NULL REFERENCES tickets(id),
      completion_seq TEXT NOT NULL,
      condition INTEGER NOT NULL,
      result TEXT NOT NULL CHECK (result IN ('pass', 'fail', 'inconclusive')),
      reason TEXT NOT NULL,
      verification TEXT,
      PRIMARY KEY (ticket, completion_seq, condition),
      FOREIGN KEY (ticket, completion_seq)
        REFERENCES ticket_completions(ticket, seq),
      FOREIGN KEY (ticket, condition)
        REFERENCES ticket_conditions(ticket, position)
    ) STRICT;
    CREATE INDEX ticket_check_results_verification
      ON ticket_check_results(verification);
    CREATE INDEX ticket_check_results_result
      ON ticket_check_results(ticket, completion_seq, result);
  `,
}];
