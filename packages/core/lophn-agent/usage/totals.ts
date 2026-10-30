import type {
  CallCost,
  TokenUsage,
  UsageTotal,
} from "../../../protocol/lophn-agent/mod.ts";

// model_calls 행의 usage·cost를 합치는 규칙. ReadAgentUsage와 ReadSessionStatus가 같은 규칙을 쓴다.
// 모르는 값은 0으로 채우지 않고 모름으로 남긴다.

// token 합계. 알려진 token이 하나도 없으면 합계도 전부 모름이다.
export function sumTokens(list: readonly { usage: TokenUsage }[]): TokenUsage {
  const known = list.filter(
    (row) =>
      row.usage.input !== null ||
      row.usage.output !== null ||
      row.usage.cache_read !== null ||
      row.usage.cache_write !== null ||
      row.usage.reasoning !== null,
  );
  const first = known[0]?.usage ?? null;
  if (first === null) {
    return {
      input: null,
      output: null,
      cache_read: null,
      cache_write: null,
      reasoning: null,
      cache_in_input: null,
      reasoning_in_output: null,
      definition_revision: "unknown",
    };
  }
  // 하나라도 모르면 그 칸의 합은 모름이다(0으로 채우지 않는다).
  const pick = (
    field: "input" | "output" | "cache_read" | "cache_write" | "reasoning",
  ): number | null =>
    known.some((row) => row.usage[field] === null)
      ? null
      : known.reduce<number>(
          (total, row) => total + (row.usage[field] ?? 0),
          0,
        );
  return {
    input: pick("input"),
    output: pick("output"),
    cache_read: pick("cache_read"),
    cache_write: pick("cache_write"),
    reasoning: pick("reasoning"),
    cache_in_input: first.cache_in_input,
    reasoning_in_output: first.reasoning_in_output,
    definition_revision: first.definition_revision,
  };
}

// 비용 합계. kind·currency별로 나눈다. 다른 통화는 합치거나 환산하지 않는다.
export function sumCosts(
  list: readonly { cost: CallCost }[],
): UsageTotal["costs"] {
  const groups = new Map<
    string,
    {
      kind: CallCost["kind"];
      currency: string | null;
      amount: string | null;
      calls: number;
    }
  >();
  for (const row of list) {
    const key = `${row.cost.kind}\u0000${row.cost.currency ?? ""}`;
    const found = groups.get(key);
    if (found === undefined) {
      groups.set(key, {
        kind: row.cost.kind,
        currency: row.cost.currency,
        amount: row.cost.amount,
        calls: 1,
      });
      continue;
    }
    found.calls += 1;
    if (found.amount !== null && row.cost.amount !== null) {
      // 같은 kind·통화 안에서만 십진수를 더한다.
      found.amount = decimalSum(found.amount, row.cost.amount);
      continue;
    }
    // 하나라도 모르면 그 묶음 금액은 모름이다. 0으로 채우지 않는다.
    found.amount = null;
  }
  return [...groups.values()];
}

// 십진수 문자열 더하기. 소수 자릿수는 양쪽 중 큰 값이고 값은 정확하다.
export function decimalSum(a: string, b: string): string {
  const [aInt, aFrac = ""] = a.split(".");
  const [bInt, bFrac = ""] = b.split(".");
  const width = Math.max(aFrac.length, bFrac.length);
  const scale = 10n ** BigInt(width);
  const total =
    BigInt(aInt) * scale +
    (aFrac === "" ? 0n : BigInt(aFrac.padEnd(width, "0"))) +
    BigInt(bInt) * scale +
    (bFrac === "" ? 0n : BigInt(bFrac.padEnd(width, "0")));
  const whole = total / scale;
  const frac = total % scale;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(width, "0").replace(/0+$/, "")}`;
}
