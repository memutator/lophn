import type { SchemaStep } from "../../../protocol/server/mod.ts";

// 적용기가 한 번만 돌리므로 if not exists를 두지 않는다. 앱 problems 표와 cross-owner FK는 만들지 않는다.
// identity는 (source, kind, path, field, rule)을 NUL로 이은 글이다. 같은 identity는 같은 행이다.
// 위반이 사라지면 지우지 않고 resolved로 닫아 두므로 삭제는 막는다.
export const PROJECT_PROBLEMS_SCHEMA_STEPS: SchemaStep[] = [
  {
    id: "problems.project_problems",
    sql: `
create table project_problems (
  id text primary key,
  project text not null,
  identity text not null,
  source text not null check (source in ('kinds_file', 'document')),
  kind text,
  path text,
  field text,
  rule text not null,
  message text not null,
  state text not null check (state in ('open', 'resolved')),
  opened_at text not null,
  state_changed_at text not null,
  last_seen_at text not null,
  seq integer not null check (seq >= 1)
) strict;
create unique index project_problems_identity on project_problems (project, identity);
create index project_problems_state on project_problems (project, state, state_changed_at);
create trigger project_problems_no_delete
before delete on project_problems
begin
  select raise(abort, 'immutable');
end;`,
  },
];
