import type { SchemaStep } from "../../../contracts/platform/mod.ts";

// domain-model lophn-agent/harness/waiting-and-recovery의 `run_wait_resolutions` 표.
// 결정 하나는 한 번만 반영된다: `(run, request, decision_seq)`가 키이고 `(request,
// decision_seq)`가 unique다(R5, R11). 행은 한 번 쓰면 바꾸지도 지우지도 않는다. 결정
// 값(답·허락)은 열에 없다. 요청 소유 영역의 `closed_seq`만 가리키고 값은 그 영역의
// ledger에서 다시 읽는다. runs·tool_calls 표 뒤에 만든다.

export const waitSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.waiting-and-recovery.tables",
    sql: `
create table run_wait_resolutions (
  run text not null references runs (id) on delete restrict,
  request text not null check (request glob 'qgr_*' or request glob 'apr_*'),
  decision_seq integer not null references events (seq),
  tool_call text references tool_calls (id) on delete restrict,
  result text not null check (result in ('resumed', 'stopped_no_answer', 'call_started', 'call_not_executed', 'ignored_finished')),
  reason text not null check (length(reason) between 1 and 64),
  resolved_seq integer references events (seq),
  primary key (run, request, decision_seq),
  unique (request, decision_seq),
  check ((request glob 'apr_*') = (tool_call is not null)),
  check (result != 'call_started' or request glob 'apr_*'),
  check (result != 'call_not_executed' or request glob 'apr_*'),
  check (result != 'stopped_no_answer' or request glob 'qgr_*'),
  check (result != 'resumed' or request glob 'qgr_*'),
  check ((result = 'ignored_finished') = (resolved_seq is null))
) strict;
create index run_wait_resolutions_run on run_wait_resolutions (run, decision_seq);
create trigger run_wait_resolutions_no_update
before update on run_wait_resolutions
begin
  select raise(abort, 'a wait resolution is never rewritten');
end;
create trigger run_wait_resolutions_no_delete
before delete on run_wait_resolutions
begin
  select raise(abort, 'wait resolutions are kept');
end;`,
  },
];
