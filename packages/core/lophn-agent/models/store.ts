import type {
  ModelChoice,
  ModelFavorites,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";

type Query = Pick<Sql, "get" | "all">;

// ledger 표에서 model 선택과 즐겨찾기를 읽는다. command(CAS 비교)와 read가 같은 모양을 쓴다.

export const GLOBAL_SCOPE = "global";

// scope는 'global'(전역 기본)이나 project id다. 줄이 없으면 null이다.
export function loadChoice(sql: Query, scope: string): ModelChoice | null {
  const row = sql.get(
    "select provider, model_name, option_values from model_choices where scope = ?",
    [scope],
  );
  if (row === undefined) return null;
  return {
    provider: String(row["provider"]),
    model_name: String(row["model_name"]),
    option_values: JSON.parse(String(row["option_values"])) as Record<
      string,
      string
    >,
  };
}

export function saveChoice(
  sql: Pick<Sql, "run">,
  scope: string,
  choice: ModelChoice | null,
): void {
  if (choice === null) {
    sql.run("delete from model_choices where scope = ?", [scope]);
    return;
  }
  sql.run(
    `insert into model_choices (scope, provider, model_name, option_values)
     values (?, ?, ?, ?)
     on conflict (scope) do update set
       provider = excluded.provider,
       model_name = excluded.model_name,
       option_values = excluded.option_values`,
    [
      scope,
      choice.provider,
      choice.model_name,
      JSON.stringify(choice.option_values),
    ],
  );
}

export function loadFavorites(sql: Query): ModelFavorites {
  const rows = sql.all(
    "select provider, model_name from model_favorites order by rank",
    [],
  );
  const seq = sql.get("select seq from model_favorites_seq", []);
  return {
    items: rows.map((row) => ({
      provider: String(row["provider"]),
      model_name: String(row["model_name"]),
    })),
    settings_seq: String(seq?.["seq"] ?? 0),
  };
}
