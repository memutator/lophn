import type { SchemaStep } from "../../../protocol/server/mod.ts";

// 터미널 GUI 탭(harness-gui)이 lophn 팀원 session이 된다. 낸 step의 SQL은 고치지 않고 새 step으로 더한다. 낸 때 step 목록의 끝에
// 붙어야 해서(schema-steps.lock.json) WIRINGS 맨 뒤 wiring(remote)의 schemaStepsAfterTeams 끝에서 잇는다.
//
// - `harness`가 GUI harness 다섯(omp, antigravity를 더한다)을 받는다. check를 넓히는 것이라 표를 다시 짠다. 다른 칸, index, trigger는
//   그대로 옮긴다.
// - `harness_gui`: 이 session의 turn은 GUI 탭이 돌린다(headless host가 가져가지 않는다). 열 때 정해 바뀌지 않는다.
export const guiMemberSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.sessions.gui-member",
    foreignKeys: "off",
    sql: `
create table sessions_new (
  id text primary key,
  agent text not null,
  project text,
  app text,
  workspace_kind text check (workspace_kind is null or workspace_kind in ('project', 'app')),
  workspace_id text,
  title text check (title is null or length(trim(title)) > 0),
  lifecycle text not null default 'open' check (lifecycle in ('open', 'archived')),
  forked_from_session text,
  forked_from_through_seq integer,
  model_selection text check (model_selection is null or json_valid(model_selection)),
  compaction_through_seq integer,
  compaction_summary_call text,
  skip integer not null default 0 check (skip in (0, 1)),
  created_seq integer not null check (created_seq >= 1),
  state_seq integer not null check (state_seq >= created_seq),
  harness text check (harness is null or harness in ('claude-code', 'codex', 'opencode', 'omp', 'antigravity')),
  harness_session text check (harness_session is null or (harness is not null and length(harness_session) > 0)),
  called_from_kind text check (called_from_kind is null or called_from_kind in ('project', 'app')),
  called_from_id text check ((called_from_kind is null) = (called_from_id is null)),
  spawned_by text,
  opened_by_app text,
  harness_gui integer not null default 0 check (harness_gui in (0, 1)),
  check ((workspace_kind is null) = (workspace_id is null)),
  check (project is (case when workspace_kind = 'project' then workspace_id end)),
  check (app is (case when workspace_kind = 'app' then workspace_id end)),
  check ((forked_from_session is null) = (forked_from_through_seq is null)),
  check (forked_from_session is null or forked_from_session != id),
  check ((compaction_through_seq is null) = (compaction_summary_call is null)),
  check (harness_gui = 0 or harness is not null)
) strict;
insert into sessions_new (id, agent, project, app, workspace_kind, workspace_id, title, lifecycle,
  forked_from_session, forked_from_through_seq, model_selection, compaction_through_seq, compaction_summary_call,
  skip, created_seq, state_seq, harness, harness_session, called_from_kind, called_from_id, spawned_by, opened_by_app)
select id, agent, project, app, workspace_kind, workspace_id, title, lifecycle,
  forked_from_session, forked_from_through_seq, model_selection, compaction_through_seq, compaction_summary_call,
  skip, created_seq, state_seq, harness, harness_session, called_from_kind, called_from_id, spawned_by, opened_by_app
from sessions;
drop table sessions;
alter table sessions_new rename to sessions;
create index sessions_agent on sessions (agent, workspace_kind, workspace_id, lifecycle);
create trigger sessions_archived_terminal
before update of lifecycle on sessions
when old.lifecycle = 'archived' and new.lifecycle != 'archived'
begin
  select raise(abort, 'an archived session is never reopened');
end;
create trigger sessions_harness_immutable
before update of harness, harness_gui on sessions
begin
  select raise(abort, 'session harness is immutable');
end;
create trigger sessions_called_from_immutable
before update of called_from_kind, called_from_id on sessions
begin
  select raise(abort, 'session call origin is immutable');
end;
create trigger sessions_spawned_by_immutable
before update of spawned_by on sessions
begin
  select raise(abort, 'session spawn origin is immutable');
end;
create trigger sessions_identity_immutable
before update of id, agent, project, app, workspace_kind, workspace_id,
  forked_from_session, forked_from_through_seq,
  created_seq on sessions
begin
  select raise(abort, 'session identity is immutable');
end;
create trigger sessions_opened_by_app_immutable
before update of opened_by_app on sessions
begin
  select raise(abort, 'session opener is immutable');
end;`,
  },
];
