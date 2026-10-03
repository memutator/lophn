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
];
