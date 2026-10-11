import type { SchemaStep } from "../../contracts/platform/mod.ts";

// domain-model lophn-agent/revert의 ledger 표. run과 event 표 뒤에 만든다.
// 최종 결과 행은 trigger가 다시 바꾸거나 지우지 못하게 막아 복원 사실을 한 번만 확정한다.
// 원래 event와 보상 event는 이 표가 가리키기만 하고 복사하지 않는다(source·compensation 표).
// applying 헤더는 최종 outcome·result_seq로 한 번만 바뀐다(앱 단계가 있는 revert, 앱 복원 작업).
export const revertSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.revert.tables",
    sql: `
create table reverts (
  id text primary key,
  run text not null references runs (id) on delete restrict,
  allow_partial integer not null check (allow_partial in (0, 1)),
  outcome text not null check (outcome in ('applying', 'applied', 'partial', 'uncertain', 'blocked')),
  preview_hash text not null check (length(preview_hash) = 64),
  created_seq integer not null unique references events (seq),
  state_seq integer not null check (state_seq >= created_seq),
  result_seq integer unique references events (seq),
  check ((outcome = 'applying') = (result_seq is null))
) strict;
create unique index reverts_run_active on reverts (run)
  where outcome in ('applying', 'applied', 'partial', 'uncertain');
create index reverts_run_result on reverts (run, result_seq);
create trigger reverts_identity_immutable
before update of id, run, allow_partial, preview_hash, created_seq on reverts
begin
  select raise(abort, 'a revert attempt is never rewritten');
end;
create trigger reverts_result_terminal
before update on reverts
when old.outcome != 'applying'
begin
  select raise(abort, 'a revert result is final');
end;
create trigger reverts_no_delete
before delete on reverts
when not exists (
  select 1 from runs where id = old.run and session is not null and state = 'finished'
)
begin
  select raise(abort, 'reverts are kept');
end;
create table revert_changes (
  revert text not null references reverts (id) on delete restrict,
  ordinal integer not null check (ordinal >= 0),
  owner text not null check (length(owner) > 0),
  target text,
  capability text not null check (capability in ('reversible', 'retained', 'irreversible', 'conflict')),
  result text not null check (result in ('restored', 'retained', 'irreversible', 'conflict', 'unchanged', 'failure', 'uncertain')),
  reason text check (reason is null or reason in ('audit_fact', 'external_effect', 'later_change', 'linked_document', 'not_agent_output', 'title_change', 'no_previous_version', 'unclassified_document_event', 'unclassified_event', 'blocked_conflict', 'blocked_irreversible', 'blocked_dependency', 'blocked_not_prepared', 'stale_preview', 'app_failed', 'app_uncertain', 'app_not_started')),
  app_revert text check (app_revert is null or json_valid(app_revert)),
  primary key (revert, ordinal),
  check (result = 'restored' or reason is not null),
  check (capability != 'retained' or result = 'retained'),
  check (capability != 'irreversible' or result = 'irreversible'),
  check (capability != 'conflict' or result in ('conflict', 'unchanged', 'failure', 'uncertain')),
  check (capability != 'reversible' or result in ('restored', 'unchanged', 'failure', 'uncertain'))
) strict;
create index revert_changes_owner_target on revert_changes (owner, target);
create trigger revert_changes_final_rows
before update on revert_changes
when (select outcome from reverts where id = old.revert) != 'applying'
  or old.result != 'unchanged'
begin
  select raise(abort, 'a revert result is final');
end;
create trigger revert_changes_no_delete
before delete on revert_changes
when not exists (
  select 1 from reverts v join runs r on r.id = v.run
  where v.id = old.revert and r.session is not null and r.state = 'finished'
)
begin
  select raise(abort, 'revert changes are kept');
end;
create table revert_change_sources (
  revert text not null,
  ordinal integer not null,
  source_seq integer not null references events (seq),
  primary key (revert, source_seq),
  foreign key (revert, ordinal) references revert_changes (revert, ordinal) on delete restrict
) strict;
create index revert_change_sources_order on revert_change_sources (revert, ordinal, source_seq);
create index revert_change_sources_seq on revert_change_sources (source_seq);
create trigger revert_change_sources_immutable
before update on revert_change_sources
begin
  select raise(abort, 'revert sources are never rewritten');
end;
create trigger revert_change_sources_no_delete
before delete on revert_change_sources
when not exists (
  select 1 from reverts v join runs r on r.id = v.run
  where v.id = old.revert and r.session is not null and r.state = 'finished'
)
begin
  select raise(abort, 'revert sources are kept');
end;
create table revert_change_compensations (
  revert text not null,
  ordinal integer not null,
  restored_seq integer not null references events (seq),
  primary key (revert, ordinal, restored_seq),
  foreign key (revert, ordinal) references revert_changes (revert, ordinal) on delete restrict
) strict;
create index revert_change_compensations_seq on revert_change_compensations (restored_seq);
create trigger revert_change_compensations_immutable
before update on revert_change_compensations
begin
  select raise(abort, 'revert compensations are never rewritten');
end;
create trigger revert_change_compensations_no_delete
before delete on revert_change_compensations
when not exists (
  select 1 from reverts v join runs r on r.id = v.run
  where v.id = old.revert and r.session is not null and r.state = 'finished'
)
begin
  select raise(abort, 'revert compensations are kept');
end;`,
  },
];
