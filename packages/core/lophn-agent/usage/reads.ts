import { err, ok, type Result } from "../../../base/mod.ts";
import {
  agentUsageRead,
  type CallCost,
  modelCallList,
  modelCallRead,
  type ModelCallRecord,
  type TokenUsage,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  type UsageTotal,
  usageTotalSchema,
} from "../../../protocol/lophn-agent/mod.ts";
import type { ReadDefinition, SqlRow } from "../../../protocol/server/mod.ts";
import { callFromRow, type CallRow } from "./model.ts";

// read·list는 pool read다. handler는 동기 Result를 돌려주며 setReadBigInts가
// 켜진 snapshot.sql을 쓴다. 합계는 model_calls 원본에서
// 재계산하는 derived 값이다(plan 합계 완료).

const PAGE = 50;
const MS = 1;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "model call not found" });
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll(
    "_",
    "\\_",
  );
}

// 정렬은 id 오름차순이다. cursor는 base64 {after_id}다(provider read와 같은 길).
function cursorAfter(cursor: string | undefined): Result<string | null> {
  if (cursor === undefined) return ok(null);
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as { after_id?: unknown };
    if (typeof parsed["after_id"] !== "string") return invalidCursor();
    return ok(parsed["after_id"]);
  } catch {
    return invalidCursor();
  }
}

function invalidCursor(): Result<never> {
  return err({ code: "invalid_input", message: "invalid model call cursor" });
}

function cursorOf(afterId: string): string {
  const text = JSON.stringify({ after_id: afterId });
  return btoa(text);
}

function loadRows(
  sql: { all(query: string, params?: readonly unknown[]): SqlRow[] },
  where: {
    clause: string;
    params: unknown[];
  },
): Result<ModelCallRecord[]> {
  const rows = sql.all(
    `select id, run, session, model_use, agent_hash, purpose,
       attempt_kind, attempt_order, retry_of,
       provider, credential_revision, model_name, protocol,
       call_model, input, context_basis, output, state, state_seq,
       started_at, finished_at, duration_ms, first_output_ms, outcome,
       usage, cost
     from model_calls ${where.clause}
     order by id`,
    where.params as never,
  );
  const records: ModelCallRecord[] = [];
  for (const row of rows) {
    const parsed = callFromRow(row as CallRow);
    records.push(parsed);
  }
  return ok(records);
}

// token 합계. 모르는 필드는 그대로 모름으로 남긴다. 0으로 바꾸지 않는다.
// 알려진 token이 하나도 없으면 합계도 전부 모름이고 판 기록은 없다(unknown,
// cost·billing_route와 같은 표기). 빈 문자열은 schema를 넘지 못한다.
function sumTokens(list: readonly { usage: TokenUsage }[]): TokenUsage {
  const known = list.filter((row) =>
    row.usage.input !== null || row.usage.output !== null ||
    row.usage.cache_read !== null || row.usage.cache_write !== null ||
    row.usage.reasoning !== null
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
  const pick = (
    field: "input" | "output" | "cache_read" | "cache_write" | "reasoning",
  ): number | null => {
    const values = known.map((row) => row.usage[field]);
    if (values.some((value) => value === null)) {
      return values.every((value) => value === null) ? null : null;
    }
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

// 비용 합계. kind·currency별로 나눈다. 다른 통화는 합치거나 환산하지 않는다.
function sumCosts(list: readonly { cost: CallCost }[]): UsageTotal["costs"] {
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
  const total = BigInt(aInt) * scale +
    (aFrac === "" ? 0n : BigInt(aFrac.padEnd(width, "0"))) +
    BigInt(bInt) * scale +
    (bFrac === "" ? 0n : BigInt(bFrac.padEnd(width, "0")));
  const whole = total / scale;
  const frac = total % scale;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(width, "0").replace(/0+$/, "")}`;
}

export function createUsageReads(): {
  read: ReadDefinition<typeof modelCallRead>;
  list: ReadDefinition<typeof modelCallList>;
  usage: ReadDefinition<typeof agentUsageRead>;
} {
  return {
    read: {
      route: modelCallRead,
      handle(snapshot, _ctx, input) {
        const row = snapshot.sql.get(
          `select id, run, session, model_use, agent_hash, purpose,
             attempt_kind, attempt_order, retry_of,
             provider, credential_revision, model_name, protocol,
             call_model, input, context_basis, output, state, state_seq,
             started_at, finished_at, duration_ms, first_output_ms, outcome,
             usage, cost
           from model_calls where id = ?`,
          [input.call],
        );
        if (row === undefined) return notFound();
        return ok({
          call: callFromRow(row as CallRow),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    list: {
      route: modelCallList,
      handle(snapshot, _ctx, input) {
        const clauses: string[] = [];
        const params: unknown[] = [];
        if (input.run !== undefined) {
          clauses.push("run = ?");
          params.push(input.run);
        }
        if (input.session !== undefined) {
          clauses.push("session = ?");
          params.push(input.session);
        }
        const after = cursorAfter(input.cursor);
        if (!after.ok) return after;
        if (after.value !== null) {
          clauses.push("id > ?");
          params.push(after.value);
        }
        const clause = clauses.length === 0
          ? ""
          : `where ${clauses.join(" and ")}`;
        const loaded = loadRows(snapshot.sql, { clause, params });
        if (!loaded.ok) return loaded;
        const page = loaded.value.slice(0, PAGE);
        const followUp = after.value === null && page.length === PAGE
          ? cursorOf(page[page.length - 1]!.id)
          : page.length === PAGE
          ? cursorOf(page[page.length - 1]!.id)
          : null;
        return ok({
          calls: page,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: followUp,
        });
      },
    },
    usage: {
      route: agentUsageRead,
      handle(snapshot, _ctx, input) {
        // role은 model_calls 행에 기록이 없다. 지원하지 않는다는 의사를
        // invalid_input으로 남긴다(module_calls에 role 열이 생길 때 다시 본다).
        if (input.role !== undefined) {
          return err({
            code: "invalid_input",
            message: "role filter is not supported on model call records yet",
          });
        }
        const clauses: string[] = [
          "started_at >= ?",
          "started_at < ?",
        ];
        const params: unknown[] = [input.from_at, input.through_at];
        if (input.run !== undefined) {
          clauses.push("run = ?");
          params.push(input.run);
        }
        if (input.session !== undefined) {
          clauses.push("session = ?");
          params.push(input.session);
        }
        if (input.model !== undefined) {
          clauses.push("model_name like ? escape '\\'");
          params.push(`%${escapeLike(input.model)}%`);
        }
        if (input.currency !== undefined) {
          // cost JSON의 currency 필터. 같은 kind·통화 묶음만 남긴s다.
          clauses.push("json_extract(cost, '$.currency') = ?");
          params.push(input.currency);
        }
        const rows = snapshot.sql.all(
          `select id, run, session, model_use, agent_hash, purpose,
             attempt_kind, attempt_order, retry_of,
             provider, credential_revision, model_name, protocol,
             call_model, input, context_basis, output, state, state_seq,
             started_at, finished_at, duration_ms, first_output_ms, outcome,
             usage, cost
           from model_calls where ${clauses.join(" and ")}
           order by id`,
          params as never,
        );
        const records = rows.map((row) => callFromRow(row as CallRow));
        // 전체 token이 하나도 없는 call은 unknown_call이다.
        const unknown =
          records.filter((record) =>
            record.usage.input === null && record.usage.output === null &&
            record.usage.cache_read === null &&
            record.usage.cache_write === null &&
            record.usage.reasoning === null
          ).length;
        const total: UsageTotal = {
          group: {
            run: input.run ?? null,
            session: input.session ?? null,
            // role filter는 위에서 되돌렸다. group 기록도 모름이다.
            role: null,
            model: input.model ?? null,
            from_at: input.from_at,
            through_at: input.through_at,
            currency: input.currency ?? null,
          },
          calls: records.length,
          tokens: {
            known: sumTokens(records),
            unknown_calls: unknown,
          },
          costs: sumCosts(records),
          missing_records: 0,
          complete: true,
        };
        return ok({
          totals: [usageTotalSchema.parse(total)],
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}

void MS;
