import type { SchemaStep } from "../../../contracts/platform/mod.ts";

// domain-model lophn-agent/harness/run-loop의 `runs` 표. assignment 뒤에 만든다.
// assignment당 running·waiting_user는 partial unique 하나이고, 같은 출처 key는
// 한 run이다. finished 행은 trigger가 다시 바꾸지 못하게 막아 결과를 한 번만
// 확정한다(R18). session·message는 그 표를 소유한 concern이 생길 때까지
// 참조 검사 없이 ID만 둔다.

export const runSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.run-loop.tables",
    sql: `
create table runs (
  id text primary key,
  assignment text not null references assignments (id) on delete restrict,
  session text,
  source text not null,
  source_kind text not null check (source_kind in ('message', 'schedule', 'handoff')),
  source_message text,
  source_assignment_revision integer,
  source_scheduled_at text,
  source_sender_run text references runs (id) on delete restrict,
  source_original_message text,
  source_dedup_key text,
  continued_from text references runs (id) on delete restrict,
  start_after text references runs (id) on delete restrict,
  start_confirmed_seq integer,
  state text not null check (state in ('accepted', 'running', 'waiting_user', 'finished')),
  basis text,
  waiting_on text,
  started_at text,
  limits text,
  elapsed_active_ms integer not null default 0 check (elapsed_active_ms >= 0),
  elapsed_stall_ms integer not null default 0 check (elapsed_stall_ms >= 0),
  elapsed_checkpoint_at text,
  finished_at text,
  outcome_kind text check (outcome_kind in ('completed', 'failed', 'stopped')),
  outcome_reason text,
  result text,
  stop_request_key text,
  result_facts text,
  state_seq integer not null check (state_seq >= 1),
  accepted_seq integer not null check (accepted_seq >= 1 and accepted_seq <= state_seq),
  check ((basis is not null) = (started_at is not null)),
  check ((state = 'waiting_user') = (waiting_on is not null)),
  check ((state = 'finished') = (finished_at is not null)),
  check ((state = 'finished') = (outcome_kind is not null)),
  check ((state = 'finished') = (result is not null)),
  check (outcome_kind is null or outcome_reason is not null),
  check (state != 'accepted' or started_at is null),
  check (state not in ('running', 'waiting_user') or started_at is not null),
  check (start_confirmed_seq is null or start_after is not null),
  check (id != continued_from and id != start_after),
  check (
    (source_kind = 'message' and source_message is not null and source_sender_run is null and source_scheduled_at is null)
    or (source_kind = 'schedule' and source_assignment_revision is not null and source_scheduled_at is not null and source_message is null and source_sender_run is null)
    or (source_kind = 'handoff' and source_sender_run is not null and source_original_message is not null and source_dedup_key is not null and source_message is null and source_scheduled_at is null)
  )
) strict;
create unique index runs_active_assignment
  on runs (assignment) where state in ('running', 'waiting_user');
create unique index runs_source_message
  on runs (source_message) where source_message is not null;
create unique index runs_source_schedule
  on runs (assignment, source_assignment_revision, source_scheduled_at)
  where source_kind = 'schedule';
create unique index runs_source_handoff
  on runs (source_sender_run, source_dedup_key) where source_kind = 'handoff';
create index runs_assignment_state on runs (assignment, state, accepted_seq);
create index runs_session on runs (session, accepted_seq);
create index runs_original_message on runs (source_original_message);
create index runs_sender on runs (source_sender_run);
create index runs_start_after on runs (start_after);
create trigger runs_identity_immutable
before update of id, assignment, session, source, source_kind, source_message,
  source_assignment_revision, source_scheduled_at, source_sender_run,
  source_original_message, source_dedup_key, continued_from, start_after,
  accepted_seq on runs
begin
  select raise(abort, 'run identity and source are immutable');
end;
create trigger runs_started_immutable
before update of basis, started_at, limits on runs
when old.basis is not null
  and (new.basis is not old.basis or new.started_at is not old.started_at or new.limits is not old.limits)
begin
  select raise(abort, 'run basis, start and limits are fixed once started');
end;
create trigger runs_finished_terminal
before update on runs
when old.state = 'finished'
begin
  select raise(abort, 'a finished run is never reopened');
end;
create trigger runs_active_elapsed_monotonic
before update of elapsed_active_ms on runs
when new.elapsed_active_ms < old.elapsed_active_ms
begin
  select raise(abort, 'active time never decreases');
end;
create trigger runs_no_delete
before delete on runs
begin
  select raise(abort, 'runs are kept');
end;`,
  },
];
