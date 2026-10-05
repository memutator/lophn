import type { SchemaStep } from "../../contracts/platform/mod.ts";

// domain-model lophn-agent/assignments의 표. preset_revision은 lophn-agent/presets의
// immutable 판을 참조한다. 현재 남길 문서·앱 목록·명령 쌍은 같은 transaction에
// 갱신하고 과거 내용은 assignment_revisions blob에 보존한다. 실패 counter·run
// 상태는 여기 두지 않고 lophn-agent/harness/run-loop를 조회한다(assignments#R1).

export const assignmentSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.assignments.tables",
    sql: `
create table assignments (
  id text primary key,
  preset_id text not null references presets (id) on delete restrict,
  preset_revision integer not null check (preset_revision >= 1),
  role text not null check (role in ('lophn', 'app_engineer', 'context_engineer', 'operator')),
  scope_kind text not null check (scope_kind in ('all', 'project', 'app')),
  scope_id text,
  state text not null check (state in ('enabled', 'paused', 'withdrawn')),
  pause_reason_kind text check ((pause_reason_kind is null) = (state != 'paused')),
  pause_detail text,
  pause_runs text,
  pause_target text,
  last_due_at text,
  approval text,
  revision integer not null check (revision >= 1),
  check ((scope_kind = 'all') = (scope_id is null))
) strict;
create unique index assignments_builtin_state
  on assignments (role) where state != 'withdrawn' and role in ('lophn', 'context_engineer');
create unique index assignments_app_engineer_state
  on assignments (role, scope_id) where state != 'withdrawn' and role = 'app_engineer';
create index assignments_state_role on assignments (state, role);
create index assignments_scope on assignments (scope_kind, scope_id);
create trigger assignments_no_identity_change
before update of id on assignments
begin
  select raise(abort, 'assignment identity is immutable');
end;
create table assignment_revisions (
  assignment_id text not null references assignments (id) on delete restrict,
  revision integer not null check (revision >= 1),
  definition text not null,
  definition_hash text not null check (length(definition_hash) = 64),
  decided_by text not null check (length(decided_by) > 0),
  reason text not null check (length(trim(reason)) > 0),
  created_at text not null check (length(created_at) > 0),
  primary key (assignment_id, revision)
) strict;
create trigger assignment_revisions_no_update
before update on assignment_revisions
begin
  select raise(abort, 'past assignment revisions are immutable');
end;
create trigger assignment_revisions_no_delete
before delete on assignment_revisions
begin
  select raise(abort, 'past assignment revisions are kept');
end;
create table assignment_outputs (
  assignment_id text not null references assignments (id) on delete restrict,
  document_id text not null,
  content text not null check (length(trim(content)) > 0),
  owns_output integer not null check (owns_output in (0, 1)),
  primary key (assignment_id, document_id)
) strict;
create unique index assignment_outputs_owner
  on assignment_outputs (document_id) where owns_output = 1;
create index assignment_outputs_document on assignment_outputs (document_id);
create table assignment_read_apps (
  assignment_id text not null references assignments (id) on delete restrict,
  app_id text not null,
  primary key (assignment_id, app_id)
) strict;
create index assignment_read_apps_app on assignment_read_apps (app_id);
create table assignment_read_commands (
  assignment_id text not null references assignments (id) on delete restrict,
  app_id text not null,
  command text not null check (length(trim(command)) > 0),
  primary key (assignment_id, app_id, command)
) strict;
create index assignment_read_commands_app on assignment_read_commands (app_id, command);`,
  },
];
