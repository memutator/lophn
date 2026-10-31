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
import { type ContextDeps, contextUsage, lastAnchor } from "./context.ts";
import { sessionVisible } from "./guards.ts";
import { loadSession, modelSelectionOf } from "./model.ts";

// ReadSessionStatus. `/status` panel이 session 하나의 지금 값을 한 번에 읽는다. 저장하는 표가 아니라
// sessions·turns·model_calls에서 그때그때 합치는 derived 값이다(ReadAgentUsage와 같은 합계 규칙).

export function sessionStatusReadDefinition(
  deps: ContextDeps,
): ReadDefinition<typeof sessionStatusRead> {
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

      const anchor = lastAnchor(snapshot.sql, input.session);

      // session이 고른 model이 먼저다. 층에서 물려받았으면 마지막 call이 실제로 쓴 model을 보인다.
      const model: ModelChoice | null =
        modelSelectionOf(row) ??
        (anchor === null
          ? null
          : {
              provider: anchor.model.provider,
              model_name: anchor.model.name,
              option_values: anchor.model.option_values.applied,
            });
      const context = contextUsage(snapshot.sql, deps, row, model, anchor);

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
