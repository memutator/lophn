import {
  type CatalogEntry,
  type ModelChoice,
  MESSAGE_BODY_FIELD,
  MESSAGE_BODY_OWNER_KIND,
  MESSAGE_IMAGE_FIELD,
  type TokenUsage,
} from "../../../protocol/lophn-agent/mod.ts";
import type { ReadSnapshot } from "../../../protocol/server/mod.ts";
import { loadUserModel } from "../models/store.ts";
import {
  UNLISTED_LIMITS,
  userEntryOf,
  withDefaultLimits,
} from "../models/user-entry.ts";
import { BYTES_PER_TOKEN, IMAGE_TOKENS } from "../prompt-assembly/mod.ts";
import type { AgentSessionRow } from "./model.ts";

// `/status`의 창 점유. omp(session-stats.ts getContextBreakdown)와 같은 셈이다: 마지막 판단 call이 provider에게서
// 받은 실제 prompt token에, 그 call 뒤에 쌓여 다음 call에 들어갈 것(그 call의 답, 그 call의 tool 결과, 뒤에 받은
// 메시지)을 byte로 센 token을 더한다. 한도는 지금 session이 쓸 model의 것이다.
// Compact나 rewind가 그 call 뒤에 이전 대화를 바꿨으면 그 call의 token은 지금 창을 말하지 않는다. 다음 call이
// 올 때까지 모름(null)이다.

type Sql = ReadSnapshot["sql"];

export type CallModel = {
  provider: string;
  name: string;
  option_values: { applied: Record<string, string> };
  limits: { context_limit: number };
};

export type Anchor = {
  id: string;
  turn: string;
  started_seq: number;
  finished_at: string;
  usage: TokenUsage;
  model: CallModel;
};

export type ContextDeps = {
  // 저장 검사·catalog 읽기와 같은 바탕(derived catalog, 없으면 동봉 snapshot)이다.
  catalog(sql: Sql): readonly CatalogEntry[];
};

// 저장한 input은 cache를 뺀 새 입력이라 cache 읽기·쓰기를 더한다(prompt-assembly/budget.ts의 PromptAnchor와 같은 셈).
function promptTokens(usage: TokenUsage): number | null {
  if (usage.input === null) return null;
  return usage.input + (usage.cache_read ?? 0) + (usage.cache_write ?? 0);
}

// 실패한 call은 provider가 usage를 주지 않아 창 크기를 모른다. usage가 있는 마지막 call이다.
export function lastAnchor(sql: Sql, session: string): Anchor | null {
  const row = sql.get(
    `select id, turn, started_seq, finished_at, usage, call_model from model_calls
      where session = ? and model_use = 'judgment' and state = 'finished'
        and json_extract(usage, '$.input') is not null
      order by started_seq desc limit 1`,
    [session],
  );
  if (row === undefined) return null;
  return {
    id: String(row["id"]),
    turn: String(row["turn"]),
    started_seq: Number(row["started_seq"]),
    finished_at: String(row["finished_at"]),
    usage: JSON.parse(String(row["usage"])) as TokenUsage,
    model: JSON.parse(String(row["call_model"])) as CallModel,
  };
}

// 그 call 뒤에 Compact가 이어졌거나, 그 call의 turn 입력을 덮는 rewind가 그 뒤에 적용됐다.
function stale(sql: Sql, session: AgentSessionRow, anchor: Anchor): boolean {
  if (session.compaction_summary_call !== null) {
    const summary = sql.get(
      "select started_seq from model_calls where id = ?",
      [session.compaction_summary_call],
    );
    if (
      summary !== undefined &&
      Number(summary["started_seq"]) > anchor.started_seq
    ) {
      return true;
    }
  }
  const input = sql.get(
    `select m.created_seq as seq from turns t join messages m on m.id = t.input_message
      where t.id = ?`,
    [anchor.turn],
  );
  if (input === undefined) return false;
  return (
    sql.get(
      `select 1 as found from reverts
        where session = ? and outcome in ('applied', 'partial', 'uncertain')
          and boundary_seq <= ? and result_seq >= ? limit 1`,
      [session.id, Number(input["seq"]), Number(input["seq"])],
    ) !== undefined
  );
}

// 그 call 뒤에 쌓인 것의 token 추정. 이미지 base64는 wire에서 빠지고 이미지 하나로 센다(budget.ts estimateTokens).
function tailTokens(sql: Sql, session: string, anchor: Anchor): number {
  const output = sql.get(
    `select coalesce(sum(size_bytes), 0) as bytes from blob_refs
      where owner_kind = 'model_call' and owner_key = ? and field = 'output'`,
    [anchor.id],
  );
  const tools = sql.get(
    `select
        coalesce(sum(length(result)
          - coalesce(length(json_extract(result, '$.content.image.data_base64')), 0)), 0) as bytes,
        coalesce(sum(json_extract(result, '$.content.image.data_base64') is not null), 0) as images
      from tool_calls where model_call = ? and result is not null`,
    [anchor.id],
  );
  // 그 call의 답은 session 자신의 메시지로도 남는다. 답 blob으로 이미 셌으므로 뺀다.
  const messages = sql.get(
    `select coalesce(sum(b.size_bytes), 0) as bytes
      from messages m join blob_refs b
        on b.owner_kind = ? and b.owner_key = m.id and b.field = ?
      where m.session = ? and m.created_at > ?
        and not (m.from_kind = 'agent' and m.from_ref = ? and m.turn is ?)`,
    [
      MESSAGE_BODY_OWNER_KIND,
      MESSAGE_BODY_FIELD,
      session,
      anchor.finished_at,
      session,
      anchor.turn,
    ],
  );
  // 뒤에 받은 메시지의 이미지도 wire에서 base64가 빠지고 하나로 센다.
  const received = sql.get(
    `select count(*) as images
      from messages m join blob_refs b
        on b.owner_kind = ? and b.owner_key = m.id and b.field = ?
      where m.session = ? and m.created_at > ?`,
    [MESSAGE_BODY_OWNER_KIND, MESSAGE_IMAGE_FIELD, session, anchor.finished_at],
  );
  const bytes =
    Number(output?.["bytes"] ?? 0) +
    Number(tools?.["bytes"] ?? 0) +
    Number(messages?.["bytes"] ?? 0);
  return (
    Math.ceil(bytes / BYTES_PER_TOKEN) +
    (Number(tools?.["images"] ?? 0) + Number(received?.["images"] ?? 0)) *
      IMAGE_TOKENS
  );
}

// 지금 고른 model이 그 call의 model과 다르면 다음 call의 한도는 catalog에서 읽는다. resolve.ts와 같은 순서다:
// 사람이 적은 정보, catalog, 둘 다 없으면 기본 한계.
function contextLimit(
  sql: Sql,
  deps: ContextDeps,
  model: ModelChoice,
  anchor: Anchor,
): number {
  if (
    model.provider === anchor.model.provider &&
    model.model_name === anchor.model.name
  ) {
    return anchor.model.limits.context_limit;
  }
  const provider = sql.get(
    "select definition_key from providers where id = ?",
    [model.provider],
  );
  if (provider === undefined) return anchor.model.limits.context_limit;
  const definition = String(provider["definition_key"]);
  const record = loadUserModel(sql, definition, model.model_name);
  const entry =
    record !== undefined
      ? withDefaultLimits(userEntryOf(record))
      : deps
          .catalog(sql)
          .find(
            (candidate) =>
              candidate.provider_definition === definition &&
              candidate.model_name === model.model_name,
          );
  return entry?.context_limit ?? UNLISTED_LIMITS.context_limit;
}

export function contextUsage(
  sql: Sql,
  deps: ContextDeps,
  session: AgentSessionRow,
  model: ModelChoice | null,
  anchor: Anchor | null,
): { tokens: number; limit: number } | null {
  if (anchor === null || model === null) return null;
  const base = promptTokens(anchor.usage);
  if (base === null || stale(sql, session, anchor)) return null;
  return {
    tokens: base + tailTokens(sql, session.id, anchor),
    limit: contextLimit(sql, deps, model, anchor),
  };
}
