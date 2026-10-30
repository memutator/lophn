// `/status` panel이 읽는 값. core의 ReadSessionStatus 하나를 화면 값으로 옮긴다.
import { sessionStatusRead } from "../../../protocol/lophn-agent/session-status.ts";
import type { SourceResult, StatusView } from "./agent-tab-source.ts";
import type { Env } from "./agent-tab-core-source-env.ts";

export async function readStatus(
  env: Env,
  session: string,
): Promise<SourceResult<StatusView>> {
  const read = await env.read(sessionStatusRead, { session });
  if (!read.ok) return read;
  const value = read.value;
  return {
    ok: true,
    value: {
      session: value.session,
      title: value.title,
      model:
        value.model === null
          ? null
          : {
              name: value.model.model_name,
              options: value.model.option_values,
            },
      provider:
        value.provider === null
          ? null
          : {
              name: value.provider.name,
              definition: value.provider.definition,
              account: value.provider.account,
              state: value.provider.state,
              until: value.provider.until,
            },
      context: value.context,
      calls: value.calls,
      turns: value.turns,
      inputTokens: value.tokens.input,
      outputTokens: value.tokens.output,
      cacheReadTokens: value.tokens.cache_read,
      costs: value.costs.map((cost) => ({
        kind: cost.kind,
        currency: cost.currency,
        amount: cost.amount,
      })),
    },
  };
}
