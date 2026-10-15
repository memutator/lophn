import {
  type CallCost,
  type ModelCallRecord,
  type TokenUsage,
  type UsageTotal,
  usageTotalSchema,
} from "../../../protocol/lophn-agent/mod.ts";
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

// ledger read에서 현재 model_calls rows를 읽어 합계로 모은다. 기간은 재산
// 기록에서 모은다(from_at은 가장 이른 시작, through_at은 마지막 기록보다 뒤).
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
      return ok(buildTotals(loaded.value.map((item) => item.record)));
    },
  };
}

// 재계산된 합계. read handler와 같은 근원에서 모은다. group 기간은
// 기록에서 모은다. 기록이 하나도 없으면 1970 기준 폐구간이다.
export function buildTotals(
  records: readonly ModelCallRecord[],
  options: {
    epochMs?: number;
  } = {},
): UsageTotal {
  // call마다 한 번만 센다. distinct model call id다.
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
  const epoch = options.epochMs ?? 0;
  const started = distinct.map((record) => Date.parse(record.started_at));
  const last = distinct.map((record) =>
    Date.parse(record.finished_at ?? record.started_at)
  );
  // 구간은 기록 경계보다 살짝 넓게 둔다. from_at == through_at은 거절이다.
  const fromAt = new Date(
    Math.min(...(started.length > 0 ? started : [epoch])),
  );
  const throughCandidate = Math.max(
    ...(last.length > 0 ? last : [epoch]),
    epoch,
  );
  const throughAt = new Date(
    fromAt.getTime() >= throughCandidate
      ? fromAt.getTime() + 1
      : throughCandidate,
  );
  return usageTotalSchema.parse({
    group: {
      turn: null,
      session: null,
      role: null,
      model: null,
      from_at: fromAt.toISOString(),
      through_at: throughAt.toISOString(),
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
    // 알려진 token이 없으면 합계도 전부 모름이고 판 기록은 없다(unknown,
    // cost·billing_route와 같은 표기). 빈 문자열은 schema를 넘지 못한다.
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
      // 하나라도 모르면 그 묶음 금액은 모름이다. 0으로 채우지 않는다.
      found.amount = null;
    }
  }
  return [...groups.values()];
}
