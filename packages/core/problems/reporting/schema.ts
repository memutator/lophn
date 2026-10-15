import type { SchemaStep } from "../../../protocol/server/mod.ts";

// 적용기가 한 번만 돌리므로 if not exists를 두지 않는다.
// apps·releases 같은 cross-owner FK는 그 표가 아직 없을 수 있으므로 만들지 않는다.
// SQLite는 check에 하위 질의를 금지하므로 reports.problem → problems.id와
// reports.snapshot → snapshots.id 참조는 handler가 같은 transaction 안에서
// 확인한다. snapshot은 Report 하나에만 연결한다(unique).
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

// 문제 표는 id·group_key를 해결·무시 뒤에도 유지하고 상태는 open/resolved/ignored 세 가지다.
// 상태 전환은 problems/grouping의 command와 접수 handler가 update로 쓰므로 update 트리거를 두지 않고,
// 삭제는 막아 보존한다. (app, group_key) unique는 상태와 무관하게 같은 문제를 찾는다.
// 발생 수·처음/마지막 시각은 reports에서 읽고 복제하지 않는다.
// seq는 문제가 만들어질 때 1이고 상태가 바뀔 때마다 1씩 오른다. recurred_*는 해결됨이던 문제가
// 새 release의 발생으로 다시 열렸을 때의 이전 해결 시각과 그 release이고, 상태가 바뀌면 비운다.
export const REPORTS_SCHEMA_STEPS: SchemaStep[] = [
  {
    id: "problems.problems",
    sql: `
create table problems (
  id text primary key,
  app text not null,
  group_key text not null,
  name text not null check (length(name) > 0),
  state text not null check (state in ('open', 'resolved', 'ignored')),
  state_changed_at text not null,
  seq integer not null check (seq >= 1),
  recurred_resolved_at text,
  recurred_release text,
  check ((recurred_resolved_at is null) = (recurred_release is null))
) strict;
create unique index problems_app_group_key on problems (app, group_key);
create index problems_app_state on problems (app, state);
create trigger problems_no_delete
before delete on problems
begin
  select raise(abort, 'immutable');
end;`,
  },
  {
    id: "problems.reports",
    sql: `
create table reports (
  id text primary key,
  app text not null,
  problem text,
  source text not null check (source in ('app', 'exception', 'feedback')),
  mode text not null check (mode in ('live', 'preview', 'test')),
  diagnostic_scope text,
  release text,
  release_missing_reason text,
  bundle_hash text,
  name text not null check (length(name) > 0),
  message text,
  details text,
  snapshot text not null,
  observed_at text not null,
  principal text not null check (length(principal) > 0),
  content_hash text not null check (length(content_hash) = 64),
  check ((mode = 'live') = (diagnostic_scope is null)),
  check ((release is null) <> (release_missing_reason is null)),
  check ((mode = 'live') = (problem is not null)),
  check (problem is null or length(problem) > 0)
) strict;
create unique index reports_snapshot on reports (snapshot);
create index reports_problem_observed_at on reports (problem, observed_at);
create index reports_app_mode_observed_at on reports (app, mode, observed_at);
create index reports_diagnostic_scope on reports (diagnostic_scope);
${IMMUTABLE("reports")}
create trigger reports_no_replace
before insert on reports
when exists (select 1 from reports where id = new.id)
begin
  select raise(abort, 'immutable');
end;`,
  },
];
