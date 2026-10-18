import { assertEquals } from "@std/assert";
import { validateCatalogResponse } from "../model.ts";
import { modelsDevEntries, parseCatalogBody } from "./models-dev.ts";

const AT = "2026-10-17T00:00:00.000Z";
const text = { input: ["text"], output: ["text"] };

const apiJson = {
  openai: {
    models: {
      "gpt-5": {
        reasoning: true,
        reasoning_options: [{
          type: "effort",
          values: ["minimal", "low", "medium", "high"],
        }],
        tool_call: true,
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
        limit: { context: 400000, input: 272000, output: 128000 },
        cost: { input: 1.25, output: 10, cache_read: 0.125 },
      },
      "gpt-image": {
        reasoning: false,
        tool_call: false,
        modalities: { input: ["text"], output: ["image"] },
        limit: { context: 0, output: 0 },
      },
    },
  },
  anthropic: {
    models: {
      "claude-sonnet-4-5": {
        reasoning: true,
        reasoning_options: [{ type: "budget_tokens", min: 1024 }],
        tool_call: true,
        modalities: text,
        limit: { context: 200000, output: 64000 },
        cost: {
          input: 3,
          output: 15,
          tiers: [{
            input: 6,
            output: 22.5,
            tier: { type: "context", size: 200000 },
          }],
        },
      },
    },
  },
  google: {
    models: {
      "gemini-x": {
        reasoning: true,
        reasoning_options: [{ type: "toggle" }],
        tool_call: true,
        modalities: text,
        limit: { context: 1000, output: 100 },
      },
    },
  },
  "some-other-provider": {
    models: {
      m: {
        tool_call: true,
        modalities: text,
        limit: { context: 1, output: 1 },
      },
    },
  },
};

// 지금 snapshot의 option 축(openai effort, anthropic thinking 예산)이 변환에서 그대로 나와야 한다.
Deno.test("models.dev 응답이 lophn 항목으로 바뀐다", () => {
  const result = modelsDevEntries(apiJson, AT);
  if (!result.ok) throw new Error(result.error.message);
  // lophn 정의에 없는 provider와 text 출력·한도가 없는 model은 버린다.
  const entries = result.value as Record<string, unknown>[];
  assertEquals(
    entries.map((e) => `${e.provider_definition}/${e.model_name}`),
    ["anthropic/claude-sonnet-4-5", "openai/gpt-5", "google-gemini/gemini-x"],
  );
  const [claude, gpt5, gemini] = entries;
  assertEquals(
    (gpt5.options as { values: { value: string }[]; default_value: string }[])
      .map((axis) => [axis.values.map((v) => v.value), axis.default_value]),
    [[["minimal", "low", "medium", "high"], "medium"]],
  );
  assertEquals(gpt5.input_media, ["text", "image", "pdf"]);
  assertEquals(gpt5.input_limit, 272000);
  const axis = (claude.options as {
    values: { value: string }[];
    default_value: string | null;
    budget: unknown;
  }[])[0];
  assertEquals(axis.values.map((v) => v.value), [
    "off",
    "low",
    "medium",
    "high",
    "maximum",
  ]);
  assertEquals(axis.default_value, null);
  assertEquals(axis.budget, { minimum: 1024, maximum: 64000 });
  // limit.input이 없으면 input_limit은 context 한도다(null이면 한도가 확인되지 않은 model이 된다).
  assertEquals(claude.input_limit, 200000);
  // 모르는 option 형은 option 없음(null)이다.
  assertEquals(gemini.options, null);
  // context tier는 겹치지 않는 두 구간이 된다.
  const rates = (claude.price_basis as { rates: Record<string, unknown>[] })
    .rates;
  assertEquals(
    rates.map((r) => [r.context_from, r.context_through, r.input]),
    [[null, 200000, "3"], [200001, null, "6"]],
  );
  // 갱신 검증을 그대로 넘는다.
  assertEquals(validateCatalogResponse(entries).ok, true);
});

Deno.test("항목 배열 응답은 거절한다", () => {
  assertEquals(parseCatalogBody("[]", AT).ok, false);
  assertEquals(parseCatalogBody("not json", AT).ok, false);
  assertEquals(parseCatalogBody(JSON.stringify(apiJson), AT).ok, true);
});
