import {
  builtinListsModels,
  type ProviderAccount,
  type ProviderRecord,
  type ReportedModelLimits,
} from "../../../protocol/lophn-agent/mod.ts";
import { CLAUDE_OAUTH_BETA } from "./adapters/claude-code.ts";
import { codexModelsHeaders, codexModelsUrl } from "./adapters/codex.ts";
import {
  OPENCODE_GO_CLIENT,
  OPENCODE_GO_DEFINITION,
} from "./adapters/opencode-go.ts";
import { builtinProviderDefinition } from "./definitions.ts";
import type { IssuerFetch } from "./issuer-http.ts";
import { readAntigravityModels } from "./oauth-antigravity.ts";

// provider가 알려 주는 model 목록이다. custom provider와 내장 API provider는 OpenAI 꼴(`GET …/models`, `data[].id`)이고,
// ChatGPT 구독 계정은 Codex backend(`GET {endpoint}/models?client_version=…`, `models[].slug`)다. 둘 다 `visibility`가
// "list"가 아닌 것은 숨긴 model이라 뺀다.
const LISTS = [
  { list: "data", id: "id" },
  { list: "models", id: "slug" },
] as const;
const VISIBILITY_FIELD = "visibility";
const VISIBLE = "list";
// Codex 목록이 model마다 싣는 token 한도다. 밝히지 않은 것은 null로 둔다.
const CONTEXT_WINDOW_FIELD = "context_window";
const MAX_CONTEXT_WINDOW_FIELD = "max_context_window";
const MAX_OUTPUT_TOKENS_FIELD = "max_output_tokens";
// RecordProviderModels가 받는 개수 상한이다.
const MODELS_MAX = 2000;

// 한 번의 목록 읽기 결과다. limits는 provider가 그 model에 밝힌 token 한도이고, 밝히지 않은 provider는 빈 객체다.
export type ReportedModelRoster = {
  models: string[];
  limits: ReportedModelLimits;
};

// 양의 정수만 받는다. 0·음수·소수·문자열·null은 그 값을 모른다는 뜻이라 버린다.
function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : null;
}

// Codex row 하나의 한도다. context_window가 없으면 그 model의 한도를 모르는 것이므로 싣지 않는다.
function codexModelLimit(
  entry: Record<string, unknown>,
): ReportedModelLimits[string] | null {
  const context = positiveInteger(entry[CONTEXT_WINDOW_FIELD]);
  if (context === null) return null;
  return {
    context_limit: context,
    max_context_limit: positiveInteger(entry[MAX_CONTEXT_WINDOW_FIELD]),
    output_limit: positiveInteger(entry[MAX_OUTPUT_TOKENS_FIELD]),
  };
}

// 보이는 id가 하나도 없으면 칸 이름이 틀렸거나 body가 다른 모양이다. 그때는 목록을 모른다고 본다(null):
// 잘못 읽어서 model을 전부 숨기는 쪽이 못 읽는 쪽보다 나쁘다.
export function parseReportedRoster(body: string): ReportedModelRoster | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const root = parsed as Record<string, unknown> | null;
  const shape = LISTS.find(({ list }) => Array.isArray(root?.[list]));
  if (shape === undefined) return null;
  const list = root![shape.list] as unknown[];
  const names = new Set<string>();
  const limits: ReportedModelLimits = {};
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    const id = entry[shape.id];
    const visibility = entry[VISIBILITY_FIELD];
    if (typeof id !== "string" || id.trim() === "") continue;
    if (visibility !== undefined && visibility !== VISIBLE) continue;
    names.add(id);
    // Codex 꼴(models[].slug)만 row에 한도를 싣는다.
    if (shape.list === "models") {
      const limit = codexModelLimit(entry);
      if (limit !== null) limits[id] = limit;
    }
  }
  if (names.size === 0) return null;
  const models = [...names].sort().slice(0, MODELS_MAX);
  const kept = new Set(models);
  return {
    models,
    limits: Object.fromEntries(
      Object.entries(limits).filter(([name]) => kept.has(name)),
    ),
  };
}

type ListTarget = Pick<ProviderRecord, "definition" | "endpoint"> & {
  kind: string;
  account: ProviderAccount | null;
};

const ANTHROPIC_VERSION = "2023-06-01";
// OpenAI 꼴 `/models`에 같이 오는 채팅 밖 model(embedding, 음성, 그림·영상 생성, moderation)이다. 고를 목록에 섞이지 않게 뺀다.
const NOT_CHAT =
  /embed|tts|whisper|transcribe|dall-e|gpt-image|imagen|imagine|veo|sora|moderation|realtime|rerank|babbage|davinci|^aqa/;
// Anthropic `/v1/models`는 날짜 붙은 id만 준다(claude-haiku-4-5-20251001). 날짜 뺀 alias도 같은 model이고 catalog와
// 저장된 선택이 그 이름을 쓰므로 같이 둔다. 구독 계정에서는 이 목록이 허락 목록이라 alias가 빠지면 선택이 막힌다.
const DATED = /-\d{8}$/;

function withAliases(models: string[]): string[] {
  return [
    ...new Set([...models, ...models.map((id) => id.replace(DATED, ""))]),
  ].sort();
}

function chatOnly(models: string[] | null): string[] | null {
  const kept = models?.filter((id) => !NOT_CHAT.test(id)) ?? [];
  return kept.length === 0 ? null : kept;
}

// gateway가 client를 알아보게 하는 User-Agent다. OpenCode Go는 SDK 기본 User-Agent를 403으로 막는다.
const OPENCODE_GO_LIST_HEADERS: Readonly<Record<string, string>> = {
  accept: "application/json",
  "user-agent": OPENCODE_GO_CLIENT,
};

// OpenCode Go 목록(OpenAI base)은 model마다 `api` 객체에 native wire를 싣는다. lophn이 부를 수 있는 wire의 model만
// 남긴다. `api`가 없으면 어느 wire인지 모르므로 버린다.
const OPENCODE_GO_WIRES = [
  "chat-completions",
  "responses",
  "messages",
  "generate-content",
];

function opencodeGoModels(body: string): string[] | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const list = (parsed as { data?: unknown })?.data;
  if (!Array.isArray(list)) return null;
  const names = new Set<string>();
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    if (!("id" in item) || typeof item.id !== "string") continue;
    if (item.id.trim() === "") continue;
    if (!("api" in item) || typeof item.api !== "object" || item.api === null) {
      continue;
    }
    const api = item.api;
    if (!OPENCODE_GO_WIRES.some((wire) => Object.hasOwn(api, wire))) continue;
    names.add(item.id);
  }
  return names.size === 0 ? null : [...names].sort();
}

// 내장 정의의 목록 읽기. 주소는 정의의 models_endpoint다. Anthropic은 x-api-key·버전 header를 쓰고 page 상한을 올린다.
async function readBuiltinModels(
  http: IssuerFetch,
  target: ListTarget,
  access: string,
): Promise<string[] | null> {
  const endpoint = target.definition.models_endpoint;
  if (endpoint === null) return null;
  const accept = { accept: "application/json" };
  switch (target.definition.key) {
    case "anthropic": {
      const headers =
        target.kind === "oauth"
          ? {
              ...accept,
              authorization: `Bearer ${access}`,
              "anthropic-beta": CLAUDE_OAUTH_BETA,
            }
          : { ...accept, "x-api-key": access };
      const roster = await readReportedRoster(
        http,
        `${endpoint}?limit=1000`,
        null,
        { ...headers, "anthropic-version": ANTHROPIC_VERSION },
      );
      return roster === null ? null : withAliases(roster.models);
    }
    case "google-gemini": {
      // Gemini의 OpenAI 호환 목록은 id 앞에 `models/`를 붙인다.
      const roster = await readReportedRoster(http, endpoint, access);
      return chatOnly(
        roster?.models.map((id) => id.replace(/^models\//, "")) ?? null,
      );
    }
    case OPENCODE_GO_DEFINITION: {
      const body = await readModelsBody(
        http,
        endpoint,
        access,
        OPENCODE_GO_LIST_HEADERS,
      );
      return body === null ? null : opencodeGoModels(body);
    }
    default: {
      const roster = await readReportedRoster(http, endpoint, access);
      return chatOnly(roster?.models ?? null);
    }
  }
}

// custom provider(내장 정의가 아니고 OAuth도 아님)의 주소다. 정의의 models_endpoint는 https만 담아 local http 주소를 못 담으므로
// provider.endpoint에서 만든다.
export function customModelsEndpoint(
  provider: Pick<ProviderRecord, "definition" | "endpoint">,
): string | null {
  const { definition } = provider;
  if (
    definition.oauth !== null ||
    builtinProviderDefinition(definition.key).ok
  ) {
    return null;
  }
  return `${provider.endpoint.replace(/\/+$/, "")}/models`;
}

// 목록 응답 원문이다. 실패·발급자 대기열 기한·runtime 없음·200 아님·던짐은 모두 null이다. token은
// 요청 header에만 두고 오류나 log에 싣지 않는다. access가 null이면 authorization header 없이 보낸다.
async function readModelsBody(
  http: IssuerFetch,
  endpoint: string,
  access: string | null,
  headers: Readonly<Record<string, string>> = { accept: "application/json" },
): Promise<string | null> {
  try {
    const response = await http(endpoint, {
      method: "GET",
      headers: {
        ...headers,
        ...(access === null ? {} : { authorization: `Bearer ${access}` }),
      },
    });
    return response.status === 200 ? await response.text() : null;
  } catch {
    return null;
  }
}

// 몸통에서 model 이름과 한도를 읽는다. OpenCode Go는 본문을 wire로 거르므로 readModelsBody를 따로 쓴다.
export async function readReportedRoster(
  http: IssuerFetch,
  endpoint: string,
  access: string | null,
  headers: Record<string, string> = { accept: "application/json" },
): Promise<ReportedModelRoster | null> {
  const body = await readModelsBody(http, endpoint, access, headers);
  return body === null ? null : parseReportedRoster(body);
}

// 이 provider의 model 목록을 읽는 곳이 있는가. Antigravity는 계정 project의 roster(POST)라 project가 있어야 한다.
export function readsModels(target: ListTarget): boolean {
  if (customModelsEndpoint(target) !== null) return true;
  if (!builtinListsModels(target.definition.key, target.kind)) return false;
  return target.definition.oauth?.product === "antigravity"
    ? target.account?.project_id != null
    : true;
}

// access는 API key 또는 구독 access token이다. custom provider의 key 없는 연결이면 null이다.
export async function readProviderModels(
  http: IssuerFetch,
  target: ListTarget,
  access: string | null,
): Promise<ReportedModelRoster | null> {
  const custom = customModelsEndpoint(target);
  if (custom !== null) return await readReportedRoster(http, custom, access);
  if (access === null || !readsModels(target)) return null;
  const product =
    target.kind === "oauth" ? target.definition.oauth?.product : undefined;
  if (product === "antigravity") {
    const models = await readAntigravityModels(
      http,
      target.endpoint,
      target.account!.project_id!,
      access,
    );
    return models === null ? null : { models, limits: {} };
  }
  if (product === "chatgpt") {
    return await readReportedRoster(
      http,
      codexModelsUrl(target.endpoint),
      access,
      codexModelsHeaders(target.account),
    );
  }
  const models = await readBuiltinModels(http, target, access);
  return models === null ? null : { models, limits: {} };
}
