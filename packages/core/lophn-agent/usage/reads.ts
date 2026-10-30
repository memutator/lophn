import { err, ok, type Result } from "../../../base/mod.ts";
import {
  agentUsageRead,
  modelCallList,
  modelCallRead,
  type ModelCallRecord,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  type UsageTotal,
  usageTotalSchema,
} from "../../../protocol/lophn-agent/mod.ts";
import type { ReadDefinition, SqlRow } from "../../../protocol/server/mod.ts";
import { callFromRow, type CallRow } from "./model.ts";
import { sumCosts, sumTokens } from "./totals.ts";

// read·list는 pool read다. handler는 동기 Result를 돌려주며 setReadBigInts가
// 켜진 snapshot.sql을 쓴다. 합계는 model_calls 원본에서
// 재계산하는 derived 값이다(plan 합계 완료).

const PAGE = 50;
const MS = 1;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "model call not found" });
}

function escapeLike(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
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
    `select id, turn, session, model_use, agent_hash, purpose,
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
          `select id, turn, session, model_use, agent_hash, purpose,
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
        if (input.turn !== undefined) {
          clauses.push("turn = ?");
          params.push(input.turn);
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
        const clause =
          clauses.length === 0 ? "" : `where ${clauses.join(" and ")}`;
        const loaded = loadRows(snapshot.sql, { clause, params });
        if (!loaded.ok) return loaded;
        const page = loaded.value.slice(0, PAGE);
        const followUp =
          after.value === null && page.length === PAGE
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
        const clauses: string[] = ["started_at >= ?", "started_at < ?"];
        const params: unknown[] = [input.from_at, input.through_at];
        if (input.turn !== undefined) {
          clauses.push("turn = ?");
          params.push(input.turn);
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
          `select id, turn, session, model_use, agent_hash, purpose,
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
        const unknown = records.filter(
          (record) =>
            record.usage.input === null &&
            record.usage.output === null &&
            record.usage.cache_read === null &&
            record.usage.cache_write === null &&
            record.usage.reasoning === null,
        ).length;
        const total: UsageTotal = {
          group: {
            turn: input.turn ?? null,
            session: input.session ?? null,
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
