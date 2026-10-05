import {
  type CallCost,
  type ModelCallRecord,
  type TokenUsage,
  type UsageTotal,
  usageTotalSchema,
} from "../../../contracts/lophn-agent/mod.ts";
import type { Result } from "../../../base/mod.ts";
import { ok } from "../../../base/mod.ts";
import { decimalSum } from "./reads.ts";

// derived `usage.sqlite`의 합계 재생성. UsageTotal은 model_calls 원본에서
// 재계산하는 derived 값이다(architecture §3.2, plan 완료 마지막 줄). 독립 ledger
// 표가 없다. 삭제해도 ledger call에서 다시 만든다.

export function usagePaths(dataRoot: string): {
  directory: string;
  usage: string;
} {
  const directory = `${dataRoot}/derived/lophn-agent`;
  return {
    directory,
    usage: `${directory}/usage.sqlite`,
  };
}

// ledger read에서 현재 model_calls rows를 읽어 합계로 모은다.
export type UsageRebuilder = {
  rebuild(): Promise<Result<UsageTotal>>;
};

export function createUsageRebuilder(options: {
  readRows(): Promise<
    Result<readonly { record: ModelCallRecord; cost: CallCost }[]>
  >;
}): UsageRebuilder {
  return {
    async rebuild() {
      const loaded = await options.readRows();
      if (!loaded.ok) return loaded;
      const total = buildTotals(loaded.value.map((item) => item.record));
      return ok(usageTotalSchema.parse(total));
    },
  };
}

// 재계산된 합계. read handler와 같은 근원에서 모은다(Q28).
export function buildTotals(
  records: readonly ModelCallRecord[],
): UsageTotal {
  // call마다 한 번만 센다(R10). distinct model call id다.
  const seen = new Set<string>();
  let duplicates = 0;
  for (const record of records) {
    if (seen.has(record.id)) {
      duplicates += 1;
      continue;
    }
    seen.add(record.id);
  }
  const distinct = records.filter((record) => seen.has(record.id));
  const unknown =
    distinct.filter((record) =>
      record.usage.input === null && record.usage.output === null &&
      record.usage.cache_read === null && record.usage.cache_write === null &&
      record.usage.reasoning === null
    ).length;
  return usageTotalSchema.parse({
    group: {
      run: null,
      session: null,
      role: null,
      model: null,
      credential_key: null,
      from_at: "",
      through_at: "",
      currency: null,
    },
    calls: distinct.length,
    tokens: {
      known: sumKnownTokens(distinct),
      unknown_calls: unknown,
    },
    costs: sumCosts(distinct),
    missing_records: duplicates,
    complete: duplicates === 0,
  });
}

function sumKnownTokens(list: readonly ModelCallRecord[]): TokenUsage {
  const known = list.filter((record) =>
    record.usage.input !== null || record.usage.output !== null ||
    record.usage.cache_read !== null || record.usage.cache_write !== null ||
    record.usage.reasoning !== null
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
      definition_revision: "",
    };
  }
  const pick = (
    field: "input" | "output" | "cache_read" | "cache_write" | "reasoning",
  ): number | null => {
    const values = known.map((record) => record.usage[field]);
    if (values.some((value) => value === null)) return null;
    return values.reduce<number>((total, value) => total + (value ?? 0), 0);
  };
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

function sumCosts(list: readonly ModelCallRecord[]): UsageTotal["costs"] {
  const groups = new Map<string, {
    kind: CallCost["kind"];
    currency: string | null;
    amount: string | null;
    calls: number;
  }>();
  for (const record of list) {
    const cost = record.cost;
    const key = `${cost.kind}\u0000${cost.currency ?? ""}`;
    const found = groups.get(key);
    if (found === undefined) {
      groups.set(key, {
        kind: cost.kind,
        currency: cost.currency,
        amount: cost.amount,
        calls: 1,
      });
      continue;
    }
    found.calls += 1;
    if (found.amount !== null && cost.amount !== null) {
      found.amount = decimalSum(found.amount, cost.amount);
    } else {
      // 하나라도 모르면 그 묶음 금액은 모름이다(R6). 0으로 채우지 않는다.
      found.amount = null;
    }
  }
  return [...groups.values()];
}
