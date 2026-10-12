import type { SchemaStep } from "../../../protocol/platform/mod.ts";

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

// 증거 값은 항목별로 값 또는 공백 아닌 이유 하나다(domain-model problems/snapshots).
// 부분 수집 실패도 나머지 자료와 함께 확정하므로 항목 열은 null을 허용하고
// 값과 이유의 짝을 check로 막는다.
export const SNAPSHOTS_SCHEMA_STEPS: SchemaStep[] = [
  {
    id: "problems.snapshots",
    sql: `
create table snapshots (
  id text primary key,
  captured_at text not null,
  invocation text,
  invocation_binding text,
  invocation_record_missing_reason text,
  invocation_missing_reason text,
  error_name text,
  error_missing_reason text,
  error_message text,
  error_message_missing_reason text,
  error_frames text,
  error_source_missing_reason text,
  error_stack text,
  error_stack_missing_reason text,
  error_truncation_notes text not null check (json_valid(error_truncation_notes)),
  logs_blob text,
  logs_line_count integer,
  logs_truncated integer,
  logs_scope text,
  logs_from_at text,
  logs_to_at text,
  logs_collected_at text,
  logs_missing_reason text,
  screen_name text,
  screen_observed_at text,
  screen_state text,
  screen_state_missing_reason text,
  screen_screenshot text,
  screen_screenshot_missing_reason text,
  screen_missing_reason text,
  check ((invocation is not null) = (invocation_missing_reason is null)),
  check ((invocation is not null) or (invocation_missing_reason is not null)),
  check ((invocation is not null) = (invocation_binding is not null)),
  check (invocation is null or length(invocation) > 0),
  check ((error_name is not null) = (error_missing_reason is null)),
  check ((error_name is not null) or (error_missing_reason is not null)),
  check ((logs_blob is not null) = (logs_missing_reason is null)),
  check ((logs_blob is not null) or (logs_missing_reason is not null)),
  check ((screen_name is not null) = (screen_missing_reason is null)),
  check ((screen_name is not null) or (screen_missing_reason is not null)),
  check (error_name is null or length(error_name) > 0),
  check (error_frames is null or json_valid(error_frames)),
  check (logs_line_count is null or logs_line_count >= 0),
  check (logs_truncated is null or logs_truncated in (0, 1)),
  check (error_stack is null or (length(error_stack) = 64 AND error_stack GLOB '*[0-9a-f]*' AND error_stack NOT GLOB '*[^0-9a-f]*')),
  check (logs_blob is null or (length(logs_blob) = 64 AND logs_blob GLOB '*[0-9a-f]*' AND logs_blob NOT GLOB '*[^0-9a-f]*')),
  check (screen_state is null or (length(screen_state) = 64 AND screen_state GLOB '*[0-9a-f]*' AND screen_state NOT GLOB '*[^0-9a-f]*')),
  check (screen_screenshot is null or (length(screen_screenshot) = 64 AND screen_screenshot GLOB '*[0-9a-f]*' AND screen_screenshot NOT GLOB '*[^0-9a-f]*'))
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
