import type { SchemaStep } from "../../contracts/platform/mod.ts";

// domain-model lophn-agent/scheduling의 `assignment_schedule_occurrences` 표.
// assignment_revisions와 runs 뒤에 만든다. 회차마다 한 행이고 한 번 쓰면 바꾸지도
// 지우지도 않는다(R4). 같은 판의 같은 회차는 primary key가 한 행으로 막는다.

export const schedulingSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.scheduling.tables",
    sql: `
create table assignment_schedule_occurrences (
  assignment_id text not null references assignments (id) on delete restrict,
  assignment_revision integer not null check (assignment_revision >= 1),
  due_at text not null,
  previous_due_at text,
  outcome text not null check (outcome in ('accepted', 'skipped')),
  run_id text references runs (id) on delete restrict,
  skip_reason text check (skip_reason in ('unfinished_run')),
  blocking_runs text not null,
  missed_first_at text,
  missed_last_at text,
  missed_count integer not null check (missed_count >= 0),
  event_seq integer not null check (event_seq >= 1),
  primary key (assignment_id, assignment_revision, due_at),
  foreign key (assignment_id, assignment_revision)
    references assignment_revisions (assignment_id, revision) on delete restrict,
  check (previous_due_at is null or previous_due_at < due_at),
  check ((outcome = 'accepted') = (run_id is not null)),
  check ((outcome = 'skipped') = (skip_reason is not null)),
  check ((outcome = 'skipped') = (json_array_length(blocking_runs) > 0)),
  check ((missed_count = 0) = (missed_first_at is null)),
  check ((missed_first_at is null) = (missed_last_at is null))
) strict;
create unique index assignment_schedule_occurrences_run
  on assignment_schedule_occurrences (run_id) where run_id is not null;
create unique index assignment_schedule_occurrences_event
  on assignment_schedule_occurrences (event_seq);
create index assignment_schedule_occurrences_due
  on assignment_schedule_occurrences (assignment_id, due_at);
create index assignment_schedule_occurrences_outcome
  on assignment_schedule_occurrences (outcome, due_at);
create trigger assignment_schedule_occurrences_no_update
before update on assignment_schedule_occurrences
begin
  select raise(abort, 'a schedule occurrence record is never changed');
end;
create trigger assignment_schedule_occurrences_no_delete
before delete on assignment_schedule_occurrences
begin
  select raise(abort, 'schedule occurrence records are kept');
end;`,
  },
];
