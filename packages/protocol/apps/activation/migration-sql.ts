import { err, ok, type Result } from "../../../base/mod.ts";

// 앱 bundle에 사본으로 들어가는 순수 부분이다. zod를 import하지 않는다(사용자 앱의 import map이
// zod를 풀지 못한다). schema는 migration.ts가 같은 모양으로 둔다.

// 손실 선언. 단계 파일 머리의 `-- loss:` 줄이 유일한 출처다.
export const LOSS_KINDS = ["drop_table", "drop_column", "narrow_type"] as const;
export type LossKind = (typeof LOSS_KINDS)[number];

export type LossStep =
  | { kind: "drop_table"; table: string; column?: undefined }
  | { kind: "drop_column" | "narrow_type"; table: string; column: string };

// SDK migration API의 한 단계.
export type Migration = {
  from: number;
  to: number;
  sql: string;
  loss: LossStep[];
};

export function stepFileName(from: number, to: number): string {
  return `migrations/${from}-${to}.sql`;
}

const IDENT = "[A-Za-z_][A-Za-z0-9_]*";
const DROP_TABLE = new RegExp(`^drop_table\\s+(${IDENT})$`);
const COLUMN_LOSS = new RegExp(
  `^(drop_column|narrow_type)\\s+(${IDENT})\\.(${IDENT})$`,
);

// 단계 파일 맨 위에서 이어지는 `--` 주석 줄에서 `-- loss: <kind> <대상>` 선언을 읽는다.
// `loss:`로 시작하지 않는 주석은 설명이라 무시하고, 꼴이 틀린 `loss:` 줄은 invalid_input이다.
export function lossOfStepSql(sql: string): Result<LossStep[]> {
  const loss: LossStep[] = [];
  for (const raw of sql.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith("--")) break;
    const body = line.slice(2).trim();
    if (!body.startsWith("loss:")) continue;
    const text = body.slice("loss:".length).trim();
    const table = DROP_TABLE.exec(text);
    if (table !== null) {
      loss.push({ kind: "drop_table", table: table[1] });
      continue;
    }
    const column = COLUMN_LOSS.exec(text);
    if (column !== null) {
      loss.push({
        kind: column[1] as "drop_column" | "narrow_type",
        table: column[2],
        column: column[3],
      });
      continue;
    }
    return err({
      code: "invalid_input",
      message: `migration loss declaration is malformed: ${body}`,
    });
  }
  return ok(loss);
}

function stepNumber(value: number): boolean {
  return Number.isSafeInteger(value);
}

export function migrationOfSql(
  from: number,
  to: number,
  sql: string,
): Result<Migration> {
  const loss = lossOfStepSql(sql);
  if (!loss.ok) return loss;
  if (!stepNumber(from) || from < 0 || !stepNumber(to)) {
    return err({
      code: "invalid_input",
      message: "migration step is not a whole number",
    });
  }
  if (to <= from) {
    return err({
      code: "invalid_input",
      message: "migration to is not after from",
    });
  }
  return ok({ from, to, sql, loss: loss.value });
}

// 모든 표에 PRIMARY KEY가 있어야 한다. 호출하는 쪽이 `pragma table_info`로 칸 수를 센다.
export function tablesWithoutPrimaryKey(
  tables: readonly { name: string; primary_key_columns: number }[],
): string[] {
  return tables.filter((table) => table.primary_key_columns === 0).map((
    table,
  ) => table.name);
}

// 오류 code는 invalid_input이다.
export const MIGRATION_PRIMARY_KEY_REQUIRED =
  "migration creates a table without PRIMARY KEY";
