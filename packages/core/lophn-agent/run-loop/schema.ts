import type { SchemaStep } from "../../../protocol/server/mod.ts";

// `turns` 표. 입력함의 입력이 turn이 되는 순간 행이 생기므로 접수 상태가 없다. 같은 session에
// running인 turn은 하나뿐이다. 권한·질문 대기는 turn이 running인 채 session snapshot이 가진다.
// finished 행은 trigger가 다시 바꾸지 못하게 막아 결과를 한 번만 확정한다. session·message는 그 표를
// 소유한 concern에서 오므로 참조 검사 없이 ID만 둔다. turn은 끝난 session을 지울 때만 함께 지운다.

export const turnSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.turns.tables",
    sql: `
create table turns (
  id text primary key,
  session text not null,
  input_message text not null,
  state text not null check (state in ('running', 'finished')),
  basis text not null,
  started_at text not null,
  limits text not null,
  elapsed_active_ms integer not null default 0 check (elapsed_active_ms >= 0),
  elapsed_stall_ms integer not null default 0 check (elapsed_stall_ms >= 0),
  elapsed_checkpoint_at text,
  finished_at text,
  outcome_kind text check (outcome_kind in ('completed', 'failed', 'interrupted')),
  outcome_reason text,
  result text,
  stop_request_key text,
  result_facts text,
  state_seq integer not null check (state_seq >= 1),
  check ((state = 'finished') = (finished_at is not null)),
  check ((state = 'finished') = (outcome_kind is not null)),
  check ((state = 'finished') = (result is not null)),
  check (outcome_kind is null or outcome_reason is not null)
) strict;
create unique index turns_running_session
  on turns (session) where state = 'running';
create unique index turns_input_message on turns (input_message);
create index turns_session on turns (session, started_at);
create trigger turns_identity_immutable
before update of id, session, input_message on turns
begin
  select raise(abort, 'turn identity is immutable');
end;
create trigger turns_started_immutable
before update of basis, started_at, limits on turns
begin
  select raise(abort, 'turn basis, start and limits are fixed once started');
end;
create trigger turns_finished_terminal
before update on turns
when old.state = 'finished'
begin
  select raise(abort, 'a finished turn is never reopened');
end;
create trigger turns_active_elapsed_monotonic
before update of elapsed_active_ms on turns
when new.elapsed_active_ms < old.elapsed_active_ms
begin
  select raise(abort, 'active time never decreases');
end;
create trigger turns_no_delete
before delete on turns
when old.state != 'finished'
begin
  select raise(abort, 'only finished turns of a deleted session are removed');
end;`,
  },
];

// 옛 이름. 다른 단위가 import하는 동안 남긴다.
export const runSchemaSteps = turnSchemaSteps;
