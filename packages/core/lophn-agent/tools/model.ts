import { err, ok, type Result } from "../../../base/mod.ts";
import type { SchemaStep, SqlParam } from "../../../protocol/server/mod.ts";
import type { ToolCall } from "../../../protocol/lophn-agent/mod.ts";

// 순수 함수만. IO 없다. 표, row↔record mapping, 불변 조건을 여기 둔다.

// domain-model lophn-agent/harness/tools의 표. tool_calls는 시도마다 한 행이고,
// tool_call_supplements는 늦은 사실의 append 표다. 입력·출력 원문은 열에 없고
// redaction을 거친 blob hash만 남는다. turn·model_call FK는 그 표가 같은 wire에
// 있을 때 더한다. 삭제는 RESTRICT로 사실을 남긴다.

export const toolsSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.harness-tools.tables",
    sql: `
create table tool_calls (
  id text primary key,
  turn text not null,
  model_call text not null,
  response_key text not null check (length(trim(response_key)) > 0),
  response_order integer not null check (response_order >= 0),
  tool text not null check (length(trim(tool)) > 0),
  definition_revision text not null check (length(trim(definition_revision)) > 0),
  effect text not null check (effect in ('read', 'write', 'external')),
  app_command text check (app_command is null or json_valid(app_command)),
  confirm integer not null check (confirm in (0, 1)),
  extension text check (extension is null or json_valid(extension)),
  input text not null,
  output text,
  retry_of text references tool_calls (id) on delete restrict,
  attempt integer not null check (attempt in (0, 1)),
  retry_at text,
  decision text check (decision is null or json_valid(decision)),
  state text not null check (state in ('requested', 'started', 'finished')),
  state_seq integer not null check (state_seq >= 0),
  started_at text,
  finished_at text,
  duration_ms integer,
  outcome text check (outcome is null or json_valid(outcome)),
  result text check (result is null or json_valid(result)),
  check ((attempt = 1) = (retry_of is not null)),
  check (retry_at is null or attempt = 1),
  check (
    (state = 'requested' and started_at is null and finished_at is null and outcome is null) or
    (state = 'started' and started_at is not null and finished_at is null and outcome is null) or
    (state = 'finished' and finished_at is not null and outcome is not null)
  ),
  check (output is null or state = 'finished'),
  check (duration_ms is null or duration_ms >= 0)
) strict;
create unique index tool_calls_request
  on tool_calls (model_call, response_key) where retry_of is null;
create unique index tool_calls_attempt
  on tool_calls (model_call, response_key, attempt);
create index tool_calls_turn_state on tool_calls (turn, state);
create index tool_calls_order
  on tool_calls (model_call, response_order, attempt);
create index tool_calls_retry_of on tool_calls (retry_of);
create index tool_calls_tool_outcome
  on tool_calls (tool, json_extract(outcome, '$.kind'));
create trigger tool_calls_no_delete
before delete on tool_calls
when not exists (
  select 1 from turns where id = old.turn and session is not null and state = 'finished'
)
begin
  select raise(abort, 'tool call records are kept');
end;
create table tool_call_supplements (
  tool_call text not null references tool_calls (id) on delete restrict,
  supplement_key text not null check (length(trim(supplement_key)) > 0),
  fact text not null,
  note text,
  event_seq integer not null,
  at text not null,
  primary key (tool_call, supplement_key),
  foreign key (event_seq) references events (seq)
) strict;
create index tool_call_supplements_event
  on tool_call_supplements (tool_call, event_seq);`,
  },
];

export type CallRow = Record<string, SqlParam>;

function parseJson(value: unknown): unknown {
  return value === null || value === undefined
    ? null
    : JSON.parse(String(value));
}

// tool_calls 행을 ToolCall로 옮긴다. 열 값은 입력 schema가 이미 검사했고 여기서는
// bigint 상태·시각·JSON 값만 옮긴다.
export function callFromRow(
  row: CallRow,
  overrides: Partial<ToolCall> = {},
): ToolCall {
  const record: ToolCall = {
    id: String(row["id"]),
    turn: String(row["turn"]),
    model_call: String(row["model_call"]),
    response_key: String(row["response_key"]),
    response_order: Number(row["response_order"]),
    tool: String(row["tool"]),
    definition_revision: String(row["definition_revision"]),
    effect: row["effect"] as ToolCall["effect"],
    app_command: parseJson(row["app_command"]) as ToolCall["app_command"],
    confirm: row["confirm"] === 1 || row["confirm"] === 1n,
    extension: parseJson(row["extension"]) as ToolCall["extension"],
    input: String(row["input"]),
    output: row["output"] === null ? null : String(row["output"]),
    retry_of: row["retry_of"] === null ? null : String(row["retry_of"]),
    attempt: Number(row["attempt"]) as 0 | 1,
    retry_at: row["retry_at"] === null ? null : String(row["retry_at"]),
    decision: parseJson(row["decision"]) as ToolCall["decision"],
    state: row["state"] as ToolCall["state"],
    started_at: row["started_at"] === null ? null : String(row["started_at"]),
    finished_at: row["finished_at"] === null
      ? null
      : String(row["finished_at"]),
    duration_ms: row["duration_ms"] === null
      ? null
      : Number(row["duration_ms"]),
    outcome: parseJson(row["outcome"]) as ToolCall["outcome"],
  };
  return { ...record, ...overrides };
}

const CALL_COLUMNS = `id, turn, model_call, response_key, response_order, tool,
  definition_revision, effect, app_command, confirm, extension, input, output,
  retry_of, attempt, retry_at, decision, state, state_seq, started_at,
  finished_at, duration_ms, outcome, result`;

export const callColumns = CALL_COLUMNS;

// 읽은 ToolCall의 state_seq(CAS 기준). 요청 기록이 0이고 판정·진입·종료 기록마다 하나씩 오른다.
// 요청 상태에서 시작하는 call의 기록 순서(요청 → 판정 → 진입 또는 미실행 종료 → 종료)만 가리킨다.
export function callRevision(
  call: Pick<ToolCall, "decision" | "started_at" | "state">,
): string {
  return String(
    (call.decision !== null ? 1 : 0) + (call.started_at !== null ? 1 : 0) +
      (call.state === "finished" ? 1 : 0),
  );
}

// 다른 leaf가 기다림·복구를 정할 때 읽는 tool call 한 건. 쓰기는 이 concern의 command만 한다.
export function loadToolCall(
  lookup: {
    sql: {
      get: (
        query: string,
        params: SqlParam[],
      ) => Record<string, SqlParam> | undefined;
    };
  },
  id: string,
): ToolCall | undefined {
  const row = lookup.sql.get(
    `select ${CALL_COLUMNS} from tool_calls where id = ?`,
    [id],
  );
  return row === undefined ? undefined : callFromRow(row);
}

// 입력 schema 검사 실패는 보정 없이 invalid_input이다. 숫자 문자열을 숫자로
// 바꾸거나 모르는 필드를 버리지 않는다.
export function invalidInput(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

export function assertRecorded(row: CallRow): Result<ToolCall> {
  return ok(callFromRow(row));
}
