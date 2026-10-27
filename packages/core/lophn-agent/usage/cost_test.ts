import assert from "node:assert/strict";
import { test } from "node:test";

import type {
  PriceBasis,
  TokenUsage,
} from "../../../protocol/lophn-agent/mod.ts";
import { estimatedCost } from "./cost.ts";

function basis(cache: {
  read: string | null;
  write: string | null;
}): PriceBasis {
  return {
    currency: "USD",
    source: "test",
    revision: "r1",
    checked_at: "2026-10-01T00:00:00.000Z",
    rates: [
      {
        context_from: null,
        context_through: null,
        cache_ttl_ms: null,
        input: "3",
        output: "15",
        cache_read: cache.read,
        cache_write: cache.write,
        reasoning: null,
      },
    ],
  };
}

// adapter는 저장 전에 input에서 cache를 뺀다. OpenAI 계열(`cache_in_input: true`)도 Anthropic(`false`)도
// 저장된 input은 새 입력뿐이다.
function usage(cacheInInput: boolean): TokenUsage {
  return {
    input: 1_000,
    output: 500,
    cache_read: 200_000,
    cache_write: 10_000,
    reasoning: null,
    cache_in_input: cacheInInput,
    reasoning_in_output: null,
    definition_revision: "test",
  };
}

test("저장된 input에서 cache를 다시 빼지 않고 cache는 각자 요율로 센다", () => {
  const distinct = basis({ read: "0.3", write: "3.75" });
  // 0.003 + 0.06 + 0.0375 + 0.0075
  assert.deepStrictEqual(estimatedCost(usage(true), distinct).amount, "0.108");
  assert.deepStrictEqual(estimatedCost(usage(false), distinct).amount, "0.108");
});

test("cache 요율이 없으면 input 요율로 센다", () => {
  const none = basis({ read: null, write: null });
  // (1000 + 200000 + 10000) × 3 ÷ 1e6 + 0.0075
  assert.deepStrictEqual(estimatedCost(usage(true), none).amount, "0.6405");
  assert.deepStrictEqual(estimatedCost(usage(false), none).amount, "0.6405");
});
