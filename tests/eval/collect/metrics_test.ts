// 세 질문
// - contract: eval roadmap "공통 수치". 모든 시나리오 비교가 이 숫자에 기댄다.
// - 현실적 회귀: cache_in_input을 보고 cache를 두 번 빼거나 더하는 수정, 막힘(denied)을 분모에서 빼거나 미실행(stopped)을 분모에 넣는 수정.
// - 왜 지금 test로 못 잡나: 계산이 손으로 만든 usage와 outcome 표에서만 보이고, 다른 test는 이 module을 부르지 않는다.
import { assertEquals } from "@std/assert";
import type { SessionRecord } from "../types.ts";
import { metricsOf, sumMetrics, toolRates } from "./metrics.ts";

function model(cacheInInput: boolean) {
  // 같은 숫자: 새 입력 100, cache 읽기 300, 쓰기 50. 저장된 input은 어느 모양이든 새 입력이다.
  return {
    call: {
      state: "finished",
      outcome: { kind: "complete" },
      duration_ms: 10,
      usage: {
        input: 100,
        output: 20,
        cache_read: 300,
        cache_write: 50,
        reasoning: null,
        cache_in_input: cacheInInput,
      },
      cost: { kind: "reported", amount: "0.5", currency: "USD" },
    },
    request: null,
  };
}

function tool(id: string, outcome: unknown, decision?: string) {
  return {
    call: {
      id,
      tool: "x",
      input: id,
      retry_of: null,
      state: "finished",
      outcome,
      decision: decision === undefined ? null : { decision },
    },
    input: null,
    output: null,
    body_truncated: false,
  };
}

const session = (over: Record<string, unknown>) =>
  ({
    turns: [],
    model_calls: [],
    tool_calls: [],
    sent_calls: [],
    ...over,
  }) as unknown as SessionRecord;

Deno.test("Anthropic·OpenAI 모양 usage는 같은 input_total과 cache hit rate를 내고 cache를 두 번 빼지 않는다", () => {
  const a = metricsOf(session({ model_calls: [model(false)] }));
  const b = metricsOf(session({ model_calls: [model(true)] }));
  assertEquals(a.input_total, 450);
  assertEquals(a.input_total, b.input_total);
  assertEquals(a.cache_hit_rate, 300 / 450);
  assertEquals(a.cache_hit_rate, b.cache_hit_rate);
  assertEquals(sumMetrics([a, b]).cache_hit_rate, 300 / 450);
});

Deno.test("막힘은 tool 분모에 들고 미실행은 분모에서 빠진다", () => {
  const m = metricsOf(session({
    tool_calls: [
      tool("a", { kind: "success", code: "ok" }),
      tool("b", { kind: "not_executed", code: "denied" }, "deny"),
      tool("c", { kind: "not_executed", code: "stopped" }),
      tool("d", { kind: "failure", code: "invalid_input" }),
    ],
  }));
  assertEquals(m.tools.counted, 3);
  assertEquals(m.tools.excluded, 1);
  assertEquals(m.tools.success, 1);
  assertEquals(m.tools.blocked, 1);
  assertEquals(m.tools.format, 1);
  assertEquals(toolRates(m.tools).blocked, 1 / 3);
});
