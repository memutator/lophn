import { err, ok } from "../../../base/mod.ts";
import {
  type CallCost,
  type ModelChoice,
  sessionStatusRead,
  type TokenUsage,
} from "../../../protocol/lophn-agent/mod.ts";
import type { ReadDefinition } from "../../../protocol/server/mod.ts";
import { loadProvider } from "../providers/store.ts";
import { sumCosts, sumTokens } from "../usage/totals.ts";
import { sessionVisible } from "./guards.ts";
import { loadSession, modelSelectionOf } from "./model.ts";

// ReadSessionStatus. `/status` panel이 session 하나의 지금 값을 한 번에 읽는다. 저장하는 표가 아니라
// sessions·turns·model_calls에서 그때그때 합치는 derived 값이다(ReadAgentUsage와 같은 합계 규칙).

type CallModel = {
  provider: string;
  name: string;
  option_values: { applied: Record<string, string> };
  limits: { context_limit: number };
};

// 마지막 판단 call이 실제로 보낸 prompt token이다. 저장한 input은 cache를 뺀 새 입력이라 cache 읽기·쓰기를
// 더한다(prompt-assembly/budget.ts의 PromptAnchor와 같은 셈).
function promptTokens(usage: TokenUsage): number | null {
  if (usage.input === null) return null;
  return usage.input + (usage.cache_read ?? 0) + (usage.cache_write ?? 0);
}

export function sessionStatusReadDefinition(): ReadDefinition<
  typeof sessionStatusRead
> {
  return {
    route: sessionStatusRead,
    handle(snapshot, ctx, input) {
      const row = loadSession(snapshot, input.session);
      if (row === undefined || !sessionVisible(ctx, row)) {
        return err({ code: "not_found", message: "session not found" });
      }

      const calls = snapshot.sql
        .all("select usage, cost from model_calls where session = ?", [
          input.session,
        ])
        .map((line) => ({
          usage: JSON.parse(String(line["usage"])) as TokenUsage,
          cost: JSON.parse(String(line["cost"])) as CallCost,
        }));
      const turns = Number(
        snapshot.sql.get("select count(*) as n from turns where session = ?", [
          input.session,
        ])?.["n"] ?? 0,
      );

      // 실패한 call은 provider가 usage를 주지 않아 창 크기를 모른다. usage가 있는 마지막 call을 쓴다.
      const last = snapshot.sql.get(
        `select usage, call_model from model_calls
          where session = ? and model_use = 'judgment' and state = 'finished'
            and json_extract(usage, '$.input') is not null
          order by started_seq desc limit 1`,
        [input.session],
      );
      const lastModel =
        last === undefined
          ? null
          : (JSON.parse(String(last["call_model"])) as CallModel);
      const lastTokens =
        last === undefined
          ? null
          : promptTokens(JSON.parse(String(last["usage"])) as TokenUsage);
      const context =
        lastModel === null || lastTokens === null
          ? null
          : { tokens: lastTokens, limit: lastModel.limits.context_limit };

      // session이 고른 model이 먼저다. 층에서 물려받았으면 마지막 call이 실제로 쓴 model을 보인다.
      const model: ModelChoice | null =
        modelSelectionOf(row) ??
        (lastModel === null
          ? null
          : {
              provider: lastModel.provider,
              model_name: lastModel.name,
              option_values: lastModel.option_values.applied,
            });

      let provider = null;
      if (model !== null) {
        const loaded = loadProvider(snapshot.sql, model.provider);
        if (!loaded.ok) return loaded;
        const record = loaded.value;
        if (record !== null && record.credential !== null) {
          provider = {
            name: record.name,
            definition: record.definition.key,
            account: record.credential.account?.email ?? null,
            state: record.credential.state,
            reason: record.credential.unavailable_reason,
            until: record.credential.until,
          };
        }
      }

      return ok({
        session: row.id,
        title: row.title,
        model,
        context,
        calls: calls.length,
        turns,
        tokens: sumTokens(calls),
        costs: sumCosts(calls),
        provider,
        as_of_seq: snapshot.as_of_seq,
        next_cursor: null,
      });
    },
  };
}
