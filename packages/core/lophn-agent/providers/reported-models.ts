import {
  builtinListsModels,
  type ProviderAccount,
  type ProviderRecord,
} from "../../../protocol/lophn-agent/mod.ts";
import { CLAUDE_OAUTH_BETA } from "./adapters/claude-code.ts";
import { codexModelsHeaders, codexModelsUrl } from "./adapters/codex.ts";
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
// RecordProviderModels가 받는 개수 상한이다.
const MODELS_MAX = 2000;

// 보이는 id가 하나도 없으면 칸 이름이 틀렸거나 body가 다른 모양이다. 그때는 목록을 모른다고 본다(null):
// 잘못 읽어서 model을 전부 숨기는 쪽이 못 읽는 쪽보다 나쁘다.
export function parseReportedModels(body: string): string[] | null {
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
  for (const item of list) {
    if (typeof item !== "object" || item === null) continue;
    const entry = item as Record<string, unknown>;
    const id = entry[shape.id];
    const visibility = entry[VISIBILITY_FIELD];
    if (typeof id !== "string" || id.trim() === "") continue;
    if (visibility !== undefined && visibility !== VISIBLE) continue;
    names.add(id);
  }
  return names.size === 0 ? null : [...names].sort().slice(0, MODELS_MAX);
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
      const models = await readReportedModels(
        http,
        `${endpoint}?limit=1000`,
        null,
        { ...headers, "anthropic-version": ANTHROPIC_VERSION },
      );
      return models === null ? null : withAliases(models);
    }
    case "google-gemini": {
      // Gemini의 OpenAI 호환 목록은 id 앞에 `models/`를 붙인다.
      const models = await readReportedModels(http, endpoint, access);
      return chatOnly(models?.map((id) => id.replace(/^models\//, "")) ?? null);
    }
    default:
      return chatOnly(await readReportedModels(http, endpoint, access));
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

// 어떤 실패든 null이다(발급자 대기열 기한, runtime 없음, 200이 아님, 큰 body). token을 오류나 log에 싣지 않는다.
// access가 null이면 authorization header 없이 보낸다.
export async function readReportedModels(
  http: IssuerFetch,
  endpoint: string,
  access: string | null,
  headers: Record<string, string> = { accept: "application/json" },
): Promise<string[] | null> {
  try {
    const response = await http(endpoint, {
      method: "GET",
      headers: {
        ...headers,
        ...(access === null ? {} : { authorization: `Bearer ${access}` }),
      },
    });
    return response.status === 200
      ? parseReportedModels(await response.text())
      : null;
  } catch {
    return null;
  }
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
): Promise<string[] | null> {
  const custom = customModelsEndpoint(target);
  if (custom !== null) return await readReportedModels(http, custom, access);
  if (access === null || !readsModels(target)) return null;
  if (target.kind === "oauth") {
    const product = target.definition.oauth?.product;
    if (product === "antigravity") {
      return await readAntigravityModels(
        http,
        target.endpoint,
        target.account!.project_id!,
        access,
      );
    }
    if (product === "chatgpt") {
      return await readReportedModels(
        http,
        codexModelsUrl(target.endpoint),
        access,
        codexModelsHeaders(target.account),
      );
    }
  }
  return await readBuiltinModels(http, target, access);
}
