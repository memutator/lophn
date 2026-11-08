import type {
  ModelChoice,
  ShownModels,
  UserModelInfo,
  UserModelRecord,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";

type Query = Pick<Sql, "get" | "all">;

// ledger 표에서 model 선택과 켠 model을 읽는다. command(CAS 비교)와 read가 같은 모양을 쓴다.

export const GLOBAL_SCOPE = "global";

// scope는 'global'(전역 기본), 'home'(Home 층), project·앱 id(그 workspace 층)다. 줄이 없으면 null이다.
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

export function loadShown(sql: Query): ShownModels {
  const rows = sql.all(
    "select provider, model_name from model_shown order by provider, model_name",
    [],
  );
  const seq = sql.get("select seq from model_shown_seq", []);
  return {
    items: rows.map((row) => ({
      provider: String(row["provider"]),
      model_name: String(row["model_name"]),
    })),
    settings_seq: String(seq?.["seq"] ?? 0),
  };
}

// 사람이 고른 model은 picker에 보여야 한다. 이미 켜져 있으면 seq도 올리지 않는다.
export function showChosen(
  sql: Pick<Sql, "get" | "run">,
  choice: ModelChoice,
): void {
  const inserted = sql.run(
    "insert or ignore into model_shown (provider, model_name) values (?, ?)",
    [choice.provider, choice.model_name],
  );
  if (Number(inserted.changes) === 0) return;
  bumpShownSeq(sql);
}

export function bumpShownSeq(sql: Pick<Sql, "get" | "run">): string {
  const row = sql.get("select seq from model_shown_seq", []);
  const next = String(Number(row?.["seq"] ?? 0) + 1);
  sql.run(
    `insert into model_shown_seq (one, seq) values (1, ?)
     on conflict (one) do update set seq = excluded.seq`,
    [next],
  );
  return next;
}

// 전역 기본이 비어 있을 때 처음 고른 model이 기본이 된다. 다음 대화가 model 없이 실패하지 않게 한다.
export function defaultIfUnset(
  sql: Pick<Sql, "get" | "all" | "run">,
  choice: ModelChoice,
): void {
  if (loadChoice(sql, GLOBAL_SCOPE) === null) {
    saveChoice(sql, GLOBAL_SCOPE, choice);
  }
}

function userRecord(row: Record<string, unknown>): UserModelRecord {
  return {
    provider_definition: String(row["provider_definition"]),
    model_name: String(row["model_name"]),
    info: JSON.parse(String(row["info"])) as UserModelInfo,
    saved_at: String(row["saved_at"]),
  };
}

const USER_COLUMNS = "provider_definition, model_name, info, saved_at";

export function loadUserModels(sql: Query): {
  seq: string;
  items: UserModelRecord[];
} {
  const rows = sql.all(
    `select ${USER_COLUMNS} from model_user_info order by provider_definition, model_name`,
    [],
  );
  const seq = sql.get("select seq from model_user_info_seq", []);
  return { seq: String(seq?.["seq"] ?? 0), items: rows.map(userRecord) };
}

export function loadUserModel(
  sql: Pick<Sql, "get">,
  definition: string,
  modelName: string,
): UserModelRecord | undefined {
  const row = sql.get(
    `select ${USER_COLUMNS} from model_user_info where provider_definition = ? and model_name = ?`,
    [definition, modelName],
  );
  return row === undefined ? undefined : userRecord(row);
}

export function bumpUserModelsSeq(sql: Pick<Sql, "run">, seq: string): string {
  const next = String(Number(seq) + 1);
  sql.run(
    `insert into model_user_info_seq (one, seq) values (1, ?)
     on conflict (one) do update set seq = excluded.seq`,
    [next],
  );
  return next;
}
