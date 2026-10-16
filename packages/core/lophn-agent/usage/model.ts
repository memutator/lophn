import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type ModelCallRecord,
  modelCallRecordSchema,
} from "../../../protocol/lophn-agent/mod.ts";
import type { SchemaStep, SqlParam } from "../../../protocol/server/mod.ts";

// 순수 함수만. IO 없다. 표, row↔record mapping, 불변 조건을 여기 둔다.

// domain-model lophn-agent/harness/usage의 표. model_calls는 실제 전송 시도마다
// 한 행이고, model_call_supplements는 보완 근거의 append 표다. credential 값은
// 열에 없고 참조만 남는다. turn·session FK는 turns·sessions 표가 생길 때 더한다
// (platform ledger schema와 같은 근원). 삭제는 RESTRICT로 사실을 남긴다.
// turn이 없는 call은 Compact의 요약 call이다. 요약 call은 turn과 agent 대신 session을 가리키고
// session을 지울 때 함께 지운다. provider는 Disconnect로 지워지므로 provider와 credential은
// 외래 키가 아니라 그 시점의 값으로 남긴다.

export const usageSchemaSteps: readonly SchemaStep[] = [
  {
    id: "lophn-agent.harness-usage.tables",
    sql: `
create table model_calls (
  id text primary key,
  turn text,
  session text,
  model_use text check (model_use in ('judgment', 'organizing')),
  agent_hash text check (agent_hash is null or length(agent_hash) = 64),
  purpose text not null check (purpose in ('judgment', 'title_summary', 'conversation_compression')),
  attempt_kind text not null check (attempt_kind in ('initial', 'retry')),
  attempt_order integer not null check (attempt_order >= 1),
  retry_of text references model_calls (id) on delete restrict,
  provider text not null,
  credential_revision integer,
  model_name text not null check (length(trim(model_name)) > 0),
  protocol text not null check (protocol in ('anthropic-messages', 'openai-responses', 'openai-chat-completions')),
  call_model text not null check (json_valid(call_model)),
  input text not null,
  context_basis text not null,
  output text,
  state text not null check (state in ('started', 'finished')),
  state_seq integer not null check (state_seq >= 0),
  started_seq integer not null check (started_seq >= 0),
  started_at text not null,
  finished_at text,
  duration_ms integer,
  first_output_ms integer,
  outcome text check (outcome is null or json_valid(outcome)),
  usage text not null check (json_valid(usage)),
  cost text not null check (json_valid(cost)),
  check (
    (turn is not null and session is not null and model_use is not null and agent_hash is not null) or
    (turn is null and session is not null and model_use is 'organizing' and agent_hash is null and purpose = 'conversation_compression')
  ),
  check (
    (attempt_kind = 'retry') = (retry_of is not null)
  ),
  check (
    (state = 'finished') = (finished_at is not null and outcome is not null)
  ),
  check (output is null or state = 'finished'),
  check (
    (duration_ms is null or duration_ms >= 0) and
    (first_output_ms is null or first_output_ms >= 0)
  )
) strict;
create unique index model_calls_turn_attempt
  on model_calls (turn, attempt_order) where turn is not null;
create unique index model_calls_session_attempt
  on model_calls (session, attempt_order) where turn is null and session is not null;
create index model_calls_turn_state on model_calls (turn, state);
create index model_calls_session_started on model_calls (session, started_at);
create index model_calls_model_use_purpose_started
  on model_calls (model_use, purpose, started_at);
create index model_calls_provider_model_started
  on model_calls (provider, model_name, started_at);
create index model_calls_retry_of on model_calls (retry_of);
create trigger model_calls_no_delete
before delete on model_calls
when not exists (
  select 1 from turns where id = old.turn and session is not null and state = 'finished'
) and not (
  old.turn is null and old.session is not null and
  not exists (select 1 from turns where session = old.session and state <> 'finished')
)
begin
  select raise(abort, 'model call records are kept');
end;
create table model_call_supplements (
  call text not null references model_calls (id) on delete restrict,
  supplement_key text not null check (length(trim(supplement_key)) > 0),
  usage text check (usage is null or json_valid(usage)),
  cost text check (cost is null or json_valid(cost)),
  outcome text check (outcome is null or json_valid(outcome)),
  basis text,
  seq integer not null,
  at text not null,
  primary key (call, supplement_key)
) strict;
create index model_call_supplements_seq
  on model_call_supplements (call, seq);`,
  },
];

// setReadBigInts가 INTEGER 열을 bigint로 준다. handler가
// 매개변수로 넘기는 STATE 열 값은 Number()-변환 후 그대로 쓴다.
export type CallRow = Record<string, SqlParam>;

function bool(value: unknown): boolean {
  return value === 1 || value === 1n || value === true;
}

function stored(state: unknown): unknown {
  return state;
}

// model_calls 행을 ModelCallRecord로 옮긴다. 열 값은 입력 schema가 이미 검사했고
// 여기서는 bigint 상태·시각·JSON 값만 옮긴다.
export function callFromRow(
  row: CallRow,
  overrides: {
    output?: string | null;
    state?: "finished";
    state_seq?: string;
    finished_at?: string;
    duration_ms?: number | null;
    first_output_ms?: number | null;
    outcome?: ModelCallRecord["outcome"];
    usage?: ModelCallRecord["usage"];
    cost?: ModelCallRecord["cost"];
  } = {},
): ModelCallRecord {
  const parseJson = (value: unknown): unknown => {
    return value === null || value === undefined
      ? null
      : JSON.parse(String(value));
  };
  const model = parseJson(row["call_model"]) as ModelCallRecord["model"];
  const record: ModelCallRecord = {
    id: String(row["id"]),
    turn: row["turn"] === null ? null : String(row["turn"] as string),
    session: row["session"] === null ? null : String(row["session"] as string),
    model_use: row["model_use"] === null
      ? null
      : row["model_use"] as ModelCallRecord["model_use"],
    agent_hash: row["agent_hash"] === null ? null : String(row["agent_hash"]),
    purpose: row["purpose"] as ModelCallRecord["purpose"],
    attempt_kind: row["attempt_kind"] as ModelCallRecord["attempt_kind"],
    attempt_order: Number(row["attempt_order"]),
    retry_of: row["retry_of"] === null
      ? null
      : String(row["retry_of"] as string),
    model,
    input: String(row["input"]),
    context_basis: String(row["context_basis"]),
    output: overrides.output === undefined
      ? row["output"] === null ? null : String(row["output"])
      : overrides.output,
    state: overrides.state ?? row["state"] as ModelCallRecord["state"],
    started_at: String(row["started_at"]),
    finished_at: overrides.finished_at ??
      (row["finished_at"] === null
        ? null
        : String(row["finished_at"] as string)),
    duration_ms: overrides.duration_ms ??
      (row["duration_ms"] === null ? null : Number(row["duration_ms"])),
    first_output_ms: overrides.first_output_ms ??
      (row["first_output_ms"] === null ? null : Number(row["first_output_ms"])),
    outcome: overrides.outcome ??
      (row["outcome"] === null
        ? null
        : parseJson(row["outcome"]) as ModelCallRecord["outcome"]),
    usage: overrides.usage ??
      parseJson(row["usage"]) as ModelCallRecord["usage"],
    cost: overrides.cost ?? parseJson(row["cost"]) as ModelCallRecord["cost"],
  };
  return record;
}

// 시작 기록은 turn·purpose·target 별 한 번이다.
export function assertCall(
  record: unknown,
): Result<ModelCallRecord> {
  const parsed = modelCallRecordSchema.safeParse(record);
  if (!parsed.success) {
    return err({
      code: "internal",
      message: "model call record가 schema와 다르다",
    });
  }
  return ok(parsed.data);
}

export const rowHelpers = { bool, stored, callFromRow };
