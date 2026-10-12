import type { SchemaStep } from "../../../protocol/server/mod.ts";

// domain-model lophn-agent/assignments의 표. assignment는 실행 정체(role·자리·상태·revision)만
// 담는다. 설정은 agent 정의 파일이, 실행 상태는 run-loop가 맡는다.
// 멈춤 근거의 kind는 `scope_archived` 하나라 칸을 두지 않는다.

export const assignmentSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.assignments.tables",
    sql: `
create table assignments (
  id text primary key,
  role text not null check (role in ('lophn', 'app_engineer', 'context_engineer', 'operator')),
  scope_kind text not null check (scope_kind in ('all', 'project', 'app')),
  scope_id text,
  state text not null check (state in ('enabled', 'paused', 'withdrawn')),
  pause_detail text check ((pause_detail is null) = (state != 'paused')),
  pause_target text check ((pause_target is null) = (state != 'paused')),
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
end;`,
  },
];
