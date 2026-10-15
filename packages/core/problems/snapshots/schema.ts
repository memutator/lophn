import type { SchemaStep } from "../../../protocol/server/mod.ts";

// 적용기가 한 번만 돌리므로 if not exists를 두지 않는다.
// apps·releases·invocations 같은 cross-owner FK는 그 표가 아직 없을 수 있으므로
// 만들지 않는다. reports.snapshot → snapshots.id는 같은 변경의 표이므로 건다.
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

// 발생 근거는 값이 없으면 열이 null이다. invocation·error·logs가 각각 한 덩어리이고,
// 화면 증거와 값·이유 짝은 두지 않는다.
export const SNAPSHOTS_SCHEMA_STEPS: SchemaStep[] = [
  {
    id: "problems.snapshots",
    sql: `
create table snapshots (
  id text primary key,
  captured_at text not null,
  invocation text,
  invocation_record_missing_reason text,
  error_name text,
  error_message text,
  error_frames text,
  error_stack text,
  error_truncation_notes text,
  logs_blob text,
  logs_line_count integer,
  logs_truncated integer,
  logs_scope text,
  logs_from_at text,
  logs_to_at text,
  logs_collected_at text,
  check (invocation is null or length(invocation) > 0),
  check (invocation is not null or invocation_record_missing_reason is null),
  check (error_name is null or length(error_name) > 0),
  check ((error_name is null) = (error_frames is null)),
  check ((error_name is null) = (error_truncation_notes is null)),
  check (error_frames is null or json_valid(error_frames)),
  check (error_truncation_notes is null or json_valid(error_truncation_notes)),
  check (error_name is not null or (error_message is null and error_stack is null)),
  check ((logs_blob is null) = (logs_line_count is null)),
  check (logs_line_count is null or logs_line_count >= 0),
  check (logs_truncated is null or logs_truncated in (0, 1)),
  check (error_stack is null or (length(error_stack) = 64 AND error_stack GLOB '*[0-9a-f]*' AND error_stack NOT GLOB '*[^0-9a-f]*')),
  check (logs_blob is null or (length(logs_blob) = 64 AND logs_blob GLOB '*[0-9a-f]*' AND logs_blob NOT GLOB '*[^0-9a-f]*'))
) strict;
${IMMUTABLE("snapshots")}
create trigger snapshots_no_replace
before insert on snapshots
when exists (select 1 from snapshots where id = new.id)
begin
  select raise(abort, 'immutable');
end;`,
  },
];
