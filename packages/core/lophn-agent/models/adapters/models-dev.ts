import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  catalogEntrySchema,
  EFFORT_LABELS,
  EFFORT_VALUES,
  MODEL_MEDIA,
  OPTION_AXIS_EFFORT,
  type OptionAxis,
  type PriceRate,
} from "../../../../protocol/lophn-agent/mod.ts";

// 공개 catalog 목적지. 응답 해석만이 목적이며 개인 자료를 싣지 않는다.
const MODELS_DEV_URL = "https://models.dev/api.json";

// catalog 갱신은 세션·key·token·model 선택·계정 정보를 싣지 않는 공개 GET이다.
// ETag는 현재 catalog 판 확인용이며 조건부 GET의 If-None-Match로만 쓴다.
type FetchResult =
  | { kind: "received"; body: string; etag: string | null }
  | { kind: "unchanged" }
  | { kind: "failed"; code: "invalid_input" | "unavailable" };

// fetchImpl은 테스트가 끼운다. 실제 network은 여기서만 만난다.
export type HttpFetch = (
  url: string,
  init: RequestInit,
) => Promise<{ status: number; etag: string | null; bytes: Uint8Array }>;

// 2026-10의 api.json이 5.7MB다. 커져도 받도록 넉넉히 둔다.
const MAX_BODY_BYTES = 16 * 1024 * 1024;

// 요청은 method·URL·Accept·선택적 If-None-Match뿐이다. credential·선택·세션은 없다.
function buildRequest(etag: string | null): RequestInit {
  return {
    method: "GET",
    headers:
      etag === null
        ? { accept: "application/json" }
        : { accept: "application/json", "if-none-match": etag },
  };
}

export async function fetchCatalog(
  etag: string | null,
  fetchImpl: HttpFetch,
): Promise<FetchResult> {
  let response: { status: number; etag: string | null; bytes: Uint8Array };
  try {
    response = await fetchImpl(MODELS_DEV_URL, buildRequest(etag));
  } catch {
    return { kind: "failed", code: "unavailable" };
  }
  if (response.status === 304) return { kind: "unchanged" };
  if (response.status !== 200) {
    return { kind: "failed", code: "unavailable" };
  }
  if (response.bytes.byteLength > MAX_BODY_BYTES) {
    return { kind: "failed", code: "invalid_input" };
  }
  const body = new TextDecoder().decode(response.bytes);
  // UTF-8 복호화 실패·분할된 응답은 여기서 잡지 않는다. 해석 판정은 해석 단계에서 한다.
  return { kind: "received", body, etag: response.etag };
}

// models.dev provider id → lophn 내장 provider 정의 key. 표에 없는 provider는 버린다.
// budget은 thinking 예산 축(anthropic-messages 표만 예산을 번역한다)을 받는 정의다.
const PROVIDERS: Readonly<
  Record<string, { definition: string; budget: boolean }>
> = {
  anthropic: { definition: "anthropic", budget: true },
  openai: { definition: "openai", budget: false },
  xai: { definition: "xai", budget: false },
  openrouter: { definition: "openrouter", budget: false },
  groq: { definition: "groq", budget: false },
  deepseek: { definition: "deepseek", budget: false },
  google: { definition: "google-gemini", budget: false },
};

type Json = Record<string, unknown>;

function obj(value: unknown): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Json)
    : undefined;
}

function positive(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

// models.dev effort 값 → lophn effort 값. 모르는 값(예: groq의 default)은 버린다.
const EFFORT_NAMES: Readonly<Record<string, string>> = {
  none: "off",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "very_high",
  max: "maximum",
};
// 예산 축이 가진 effort 값(끔과 예산이 있는 넷)이다.
const BUDGET_VALUES = ["off", "low", "medium", "high", "maximum"];

function axisOf(
  values: readonly string[],
  defaultValue: string | null,
  budget: OptionAxis["budget"],
): OptionAxis[] {
  return [
    {
      id: OPTION_AXIS_EFFORT,
      label: "Effort",
      values: values.map((value) => ({
        value,
        label: EFFORT_LABELS[value as keyof typeof EFFORT_LABELS],
        wire: null,
      })),
      default_value: defaultValue,
      budget,
    },
  ];
}

// option 축 규칙. reasoning이 아니면 축이 없다고 확인된 것([])이다.
// effort 형은 축 하나로 옮기고 default는 medium이 있으면 medium이다(models.dev에는 default가 없다).
// budget_tokens 형은 예산 축이다(max가 없으면 output 한도까지). toggle 같은 모르는 형은 null이다.
// effort와 budget_tokens가 함께 있으면 effort를 쓴다(축 id가 같아 하나만 둔다).
function optionsOf(
  model: Json,
  budgetAxis: boolean,
  outputLimit: number,
): OptionAxis[] | null {
  if (model.reasoning !== true) return [];
  const raw = Array.isArray(model.reasoning_options)
    ? model.reasoning_options.map(obj)
    : [];
  const effort = raw.find((option) => option?.type === "effort");
  if (effort !== undefined && Array.isArray(effort.values)) {
    const mapped = new Set(
      effort.values.map((value) => EFFORT_NAMES[String(value)]),
    );
    const values = EFFORT_VALUES.filter((value) => mapped.has(value));
    if (values.length === 0) return null;
    return axisOf(values, values.includes("medium") ? "medium" : null, null);
  }
  const budget = raw.find((option) => option?.type === "budget_tokens");
  if (budget !== undefined && budgetAxis) {
    const minimum = positive(budget.min);
    const maximum = positive(budget.max) ?? outputLimit;
    if (minimum === null || minimum > maximum) return null;
    return axisOf(BUDGET_VALUES, null, { minimum, maximum });
  }
  return null;
}

function decimal(value: unknown): string | null {
  return typeof value === "number" ? String(value) : null;
}

// cost(100만 token당 USD) → 가격 구간. context tier가 있으면 구간을 나눈다(경계는 포함 쪽이 아래 구간).
function ratesOf(cost: Json): PriceRate[] {
  const tiers = (Array.isArray(cost.tiers) ? cost.tiers.map(obj) : [])
    .flatMap((tier) => {
      const size = positive(obj(tier?.tier)?.size);
      return tier !== undefined &&
        obj(tier.tier)?.type === "context" &&
        size !== null
        ? [{ size, cost: tier }]
        : [];
    })
    .sort((a, b) => a.size - b.size);
  const rate = (
    source: Json,
    from: number | null,
    through: number | null,
  ): PriceRate => ({
    context_from: from,
    context_through: through,
    cache_ttl_ms: null,
    input: decimal(source.input),
    output: decimal(source.output),
    cache_read: decimal(source.cache_read),
    cache_write: decimal(source.cache_write),
    reasoning: decimal(source.reasoning),
  });
  const rates = [rate(cost, null, tiers[0]?.size ?? null)];
  tiers.forEach((tier, index) =>
    rates.push(rate(tier.cost, tier.size + 1, tiers[index + 1]?.size ?? null)),
  );
  return rates;
}

function mediaOf(value: unknown): (typeof MODEL_MEDIA)[number][] {
  const list = Array.isArray(value) ? value : [];
  return MODEL_MEDIA.filter((media) => list.includes(media));
}

// models.dev api.json 전체를 lophn 항목 배열로 바꾼다. at은 확인 시각(YYYY-MM-DDTHH:mm:ss.sssZ)이다.
// 한도가 없거나 text 입출력이 없는 model은 버린다. 항목 하나가 schema를 못 넘으면 갱신 전체가
// 거절되므로 넘지 못하는 항목도 여기서 버린다.
export function modelsDevEntries(
  apiJson: unknown,
  at: string,
): Result<unknown[]> {
  const root = obj(apiJson);
  if (root === undefined) {
    return err({
      code: "invalid_input",
      message: "catalog 응답은 provider 객체여야 한다",
    });
  }
  const entries: unknown[] = [];
  for (const [providerId, target] of Object.entries(PROVIDERS)) {
    const models = obj(obj(root[providerId])?.models) ?? {};
    for (const [modelName, value] of Object.entries(models)) {
      const model = obj(value);
      const limit = obj(model?.limit);
      const modalities = obj(model?.modalities);
      const context = positive(limit?.context);
      const output = positive(limit?.output);
      const inputMedia = mediaOf(modalities?.input);
      const outputMedia = mediaOf(modalities?.output);
      if (
        model === undefined ||
        context === null ||
        output === null ||
        !inputMedia.includes("text") ||
        !outputMedia.includes("text")
      )
        continue;
      const cost = obj(model.cost);
      const rates = cost === undefined ? [] : ratesOf(cost);
      const entry = {
        provider_definition: target.definition,
        model_name: modelName,
        context_limit: context,
        input_limit: positive(limit?.input) ?? context,
        output_limit: output,
        supports_tools: model.tool_call === true,
        input_media: inputMedia,
        output_media: outputMedia,
        options: optionsOf(model, target.budget, output),
        preview: model.status === "beta",
        deprecated: model.status === "deprecated",
        source: "models_dev",
        source_revision: `models.dev@${at.slice(0, 10)}`,
        checked_at: at,
        received_at: at,
        price_basis:
          cost?.input === undefined
            ? null
            : {
                currency: "USD",
                rates,
                source: "models.dev",
                revision: `models.dev@${at.slice(0, 10)}`,
                checked_at: at,
              },
      };
      if (catalogEntrySchema.safeParse(entry).success) entries.push(entry);
    }
  }
  return ok(entries);
}

// 응답 body를 해석한다. 잘못된 JSON은 갱신 전체 거절 사유다.
// at은 호출한 쪽 clock의 시각이다.
export function parseCatalogBody(body: string, at: string): Result<unknown[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return err({
      code: "invalid_input",
      message: "catalog 응답을 해석하지 못했다",
    });
  }
  return modelsDevEntries(parsed, at);
}
