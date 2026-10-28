import type { Metrics, SessionRecord } from "../types.ts";

// 저장된 usage.input은 어떤 adapter에서든 cache를 뺀 새 입력이다. cache_in_input은 provider가 보고한 모양일 뿐이라
// 여기서 빼거나 더하지 않는다.
const PRICED = ["reported", "estimated", "free"];
const BLOCK_CODES = ["denied", "rejected"];

function zero(): Metrics {
  return {
    tokens: {
      input: 0,
      output: 0,
      cache_read: 0,
      cache_write: 0,
      reasoning: 0,
      unknown_calls: 0,
    },
    input_total: 0,
    cache_hit_rate: null,
    cost_usd: 0,
    unpriced_calls: 0,
    time_ms: { turns: 0, model_calls: 0 },
    tools: {
      counted: 0,
      excluded: 0,
      format: 0,
      success: 0,
      blocked: 0,
      repeated_calls: 0,
      repeat_groups: 0,
      max_repeat: 0,
      repeated_failure_turns: 0,
    },
    truncated_calls: 0,
    agent_calls: [],
  };
}

const rate = (read: number, total: number) =>
  total === 0 ? null : read / total;

export function metricsOf(session: SessionRecord): Metrics {
  const m = zero();
  for (const { call } of session.model_calls) {
    if (call.outcome?.kind === "partial") m.truncated_calls++;
    m.time_ms.model_calls += call.duration_ms ?? 0;
    if (call.state !== "finished") continue;
    const { usage, cost } = call;
    if (usage.input === null) {
      m.tokens.unknown_calls++;
    } else {
      m.tokens.input += usage.input;
      m.tokens.cache_read += usage.cache_read ?? 0;
      m.tokens.cache_write += usage.cache_write ?? 0;
      m.tokens.output += usage.output ?? 0;
      m.tokens.reasoning += usage.reasoning ?? 0;
      m.input_total +=
        usage.input + (usage.cache_read ?? 0) + (usage.cache_write ?? 0);
    }
    if (
      PRICED.includes(cost.kind) &&
      cost.currency === "USD" &&
      cost.amount !== null
    ) {
      m.cost_usd += Number(cost.amount);
    } else {
      m.unpriced_calls++;
    }
  }
  m.cache_hit_rate = rate(m.tokens.cache_read, m.input_total);

  for (const turn of session.turns) {
    if (turn.finished_at !== null) {
      m.time_ms.turns +=
        Date.parse(turn.finished_at) - Date.parse(turn.started_at);
    }
    if (
      turn.outcome?.kind === "failed" &&
      turn.outcome.reason === "repeated_tool_failure"
    )
      m.tools.repeated_failure_turns++;
  }

  // 재시도에 밀린 행은 뺀다. 같은 입력의 재시도 행이 되풀이로 세어지면 안 된다.
  const superseded = new Set(
    session.tool_calls.map((t) => t.call.retry_of).filter((id) => id !== null),
  );
  const live = session.tool_calls
    .map((t) => t.call)
    .filter((c) => !superseded.has(c.id));
  for (const c of live) {
    const { outcome } = c;
    if (c.state !== "finished" || outcome === null) continue;
    const notExecuted = outcome.kind === "not_executed";
    const blockedCode = BLOCK_CODES.includes(outcome.code);
    if (notExecuted && !blockedCode) {
      m.tools.excluded++;
      continue;
    }
    m.tools.counted++;
    if (outcome.kind === "success") m.tools.success++;
    if (
      outcome.kind === "failure" &&
      (outcome.code === "invalid_input" || outcome.code === "not_found")
    )
      m.tools.format++;
    if (
      c.decision?.decision === "deny" ||
      c.decision?.decision === "ask" ||
      (notExecuted && blockedCode)
    )
      m.tools.blocked++;
  }

  const groups = new Map<string, number>();
  for (const c of live) {
    const key = `${c.tool}\n${c.input}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  for (const size of groups.values()) {
    if (size < 2) continue;
    m.tools.repeat_groups++;
    m.tools.repeated_calls += size - 1;
    m.tools.max_repeat = Math.max(m.tools.max_repeat, size);
  }

  m.agent_calls = session.sent_calls.map((s) => {
    const to = s.to as { agent?: unknown } | null;
    return {
      receiver_agent:
        s.receiver_name ?? (typeof to?.agent === "string" ? to.agent : null),
      reply: s.reply,
      state: s.state,
      failed: s.outcome?.kind !== "success" || s.state === "failed",
    };
  });
  return m;
}

export function sumMetrics(list: Metrics[]): Metrics {
  const sum = zero();
  for (const m of list) {
    for (const key of Object.keys(sum.tokens) as (keyof Metrics["tokens"])[]) {
      sum.tokens[key] += m.tokens[key];
    }
    sum.input_total += m.input_total;
    sum.cost_usd += m.cost_usd;
    sum.unpriced_calls += m.unpriced_calls;
    sum.time_ms.turns += m.time_ms.turns;
    sum.time_ms.model_calls += m.time_ms.model_calls;
    for (const key of Object.keys(sum.tools) as (keyof Metrics["tools"])[]) {
      if (key === "max_repeat") {
        sum.tools.max_repeat = Math.max(
          sum.tools.max_repeat,
          m.tools.max_repeat,
        );
      } else sum.tools[key] += m.tools[key];
    }
    sum.truncated_calls += m.truncated_calls;
    sum.agent_calls.push(...m.agent_calls);
  }
  sum.cache_hit_rate = rate(sum.tokens.cache_read, sum.input_total);
  return sum;
}

export function toolRates(tools: Metrics["tools"]): {
  format: number | null;
  success: number | null;
  blocked: number | null;
} {
  const { counted } = tools;
  if (counted === 0) return { format: null, success: null, blocked: null };
  return {
    format: tools.format / counted,
    success: tools.success / counted,
    blocked: tools.blocked / counted,
  };
}
