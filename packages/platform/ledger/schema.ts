import type { SchemaStep } from "../../contracts/platform/mod.ts";

// domain-model platform/ledger의 공통 표. run FK는 runs 표가 생길 때 더한다(계획 Q5).
// 적용기가 한 번만 돌리므로 if not exists를 두지 않는다.

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

export const LEDGER_SCHEMA_STEPS: SchemaStep[] = [
  {
    id: "common-tables",
    sql: `
create table events (
  seq integer primary key autoincrement,
  type text not null,
  subject text,
  actor text not null,
  run text,
  payload text not null,
  at text not null
);
create index events_subject_seq on events (subject, seq);
create index events_run_seq on events (run, seq);
create index events_type_seq on events (type, seq);
${IMMUTABLE("events")}
create table command_results (
  principal text not null,
  idempotency_key text not null,
  fingerprint text not null,
  result text not null,
  first_seq integer,
  last_seq integer,
  at text not null,
  primary key (principal, idempotency_key),
  foreign key (first_seq) references events (seq),
  foreign key (last_seq) references events (seq),
  check (
    (first_seq is null and last_seq is null) or
    (first_seq is not null and last_seq is not null and last_seq >= first_seq)
  )
);
create index command_results_at on command_results (at);
${IMMUTABLE("command_results")}
create table subscriber_cursors (
  subscriber text primary key,
  processed_through_seq integer not null check (processed_through_seq >= 0)
);`,
  },
  {
    id: "immutable-insert-guards",
    sql: `
create trigger events_no_duplicate_insert
before insert on events
when exists (select 1 from events where seq = new.seq)
begin
  select raise(abort, 'immutable');
end;
create trigger command_results_no_duplicate_insert
before insert on command_results
when exists (
  select 1 from command_results
  where principal = new.principal and idempotency_key = new.idempotency_key
)
begin
  select raise(abort, 'immutable');
end;
create trigger if not exists schema_migrations_no_duplicate_insert
before insert on schema_migrations
when exists (select 1 from schema_migrations where version = new.version)
begin
  select raise(abort, 'immutable');
end;`,
  },
  {
    // 질문 option의 user 기록은 command transaction 안에서 한 번만 남긴다(identity R14).
    // rollback이면 행이 없고, 재시작·다른 writer에서도 같은 key는 거절된다.
    id: "question-evidence",
    sql: `
create table question_evidence (
  evidence_key text primary key,
  question text not null,
  option text not null,
  at text not null
);
${IMMUTABLE("question_evidence")}`,
  },
];
