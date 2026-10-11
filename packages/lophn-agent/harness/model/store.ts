import {
  MODEL_DEFAULT_SLOTS,
  type ModelChoice,
  type ModelDefaults,
  type ModelFavorites,
} from "../../../contracts/lophn-agent/mod.ts";
import type { Sql } from "../../../contracts/platform/mod.ts";

type Query = Pick<Sql, "get" | "all">;

// ledger 표에서 기본값과 즐겨찾기를 읽는다. command(CAS 비교)와 read가 같은 모양을 쓴다.

function choiceOf(
  row: { provider: unknown; model_name: unknown; option_values: unknown },
): ModelChoice | null {
  if (row.provider === null || row.model_name === null) return null;
  return {
    provider: String(row.provider),
    model_name: String(row.model_name),
    option_values: JSON.parse(String(row.option_values)) as Record<
      string,
      string
    >,
  };
}

// 처음 값은 모든 slot이 null이고 seq는 "0"이다(R9). 줄이 있는 slot 가운데 가장 큰 seq가 현재 seq다.
export function loadDefaults(sql: Query): ModelDefaults {
  const defaults: ModelDefaults = {
    lophn: null,
    context_engineer: null,
    app_engineer: null,
    operator: null,
    summaries: null,
    settings_seq: "0",
  };
  const rows = sql.all(
    "select slot, provider, model_name, option_values, settings_seq from agent_model_defaults",
    [],
  );
  for (const row of rows) {
    const slot = String(row["slot"]);
    if ((MODEL_DEFAULT_SLOTS as readonly string[]).includes(slot)) {
      defaults[slot as (typeof MODEL_DEFAULT_SLOTS)[number]] = choiceOf({
        provider: row["provider"],
        model_name: row["model_name"],
        option_values: row["option_values"],
      });
    }
    const seq = String(row["settings_seq"]);
    if (BigInt(seq) > BigInt(defaults.settings_seq)) {
      defaults.settings_seq = seq;
    }
  }
  return defaults;
}

// 즐겨찾기의 현재 seq는 마지막 ModelFavoritesChanged event의 seq다. 목록을 비워도 앞으로 간다.
export function loadFavorites(sql: Query): ModelFavorites {
  const rows = sql.all(
    "select provider, model_name from model_favorites order by rank",
    [],
  );
  const seq = sql.get(
    "select coalesce(max(seq), 0) as seq from events where type = 'ModelFavoritesChanged'",
    [],
  );
  return {
    items: rows.map((row) => ({
      provider: String(row["provider"]),
      model_name: String(row["model_name"]),
    })),
    settings_seq: String(seq?.["seq"] ?? 0),
  };
}
