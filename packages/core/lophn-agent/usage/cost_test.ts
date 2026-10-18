import { assertEquals } from "@std/assert";
import type {
  PriceBasis,
  TokenUsage,
} from "../../../protocol/lophn-agent/mod.ts";
import { estimatedCost } from "./cost.ts";

function basis(
  cache: { read: string | null; write: string | null },
): PriceBasis {
  return {
    currency: "USD",
    source: "test",
    revision: "r1",
    checked_at: "2026-10-01T00:00:00.000Z",
    rates: [{
      context_from: null,
      context_through: null,
      cache_ttl_ms: null,
      input: "3",
      output: "15",
      cache_read: cache.read,
      cache_write: cache.write,
      reasoning: null,
    }],
  };
}

// 같은 call을 OpenAI 계열은 input에 cache를 포함해, Anthropic은 따로 보고한다.
function usage(cacheInInput: boolean): TokenUsage {
  return {
    input: cacheInInput ? 211_000 : 1_000,
    output: 500,
    cache_read: 200_000,
    cache_write: 10_000,
    reasoning: null,
    cache_in_input: cacheInInput,
    reasoning_in_output: null,
    definition_revision: "test",
  };
}

Deno.test("cache는 두 번 세지 않고 각자 요율로 센다", () => {
  const distinct = basis({ read: "0.3", write: "3.75" });
  // 0.003 + 0.06 + 0.0375 + 0.0075
  assertEquals(estimatedCost(usage(true), distinct).amount, "0.108");
  assertEquals(estimatedCost(usage(false), distinct).amount, "0.108");
});

Deno.test("cache 요율이 없으면 input 요율로 센다", () => {
  const none = basis({ read: null, write: null });
  // (1000 + 200000 + 10000) × 3 ÷ 1e6 + 0.0075
  assertEquals(estimatedCost(usage(true), none).amount, "0.6405");
  assertEquals(estimatedCost(usage(false), none).amount, "0.6405");
});
