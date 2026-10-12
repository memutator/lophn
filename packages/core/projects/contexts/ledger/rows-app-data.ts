// context_app_data 표(적용된 판의 계약이 app-data source로 읽는 앱 slug들)의 읽기·쓰기다.
// 판을 적용할 때 같은 transaction에서 그 판의 content로 다시 채우고, 앱 하나에 묶인 agent의 읽기
// 권한이 이 표만 본다(documents/contexts의 ledger 표).
import { bundleContentSchema } from "../../../../protocol/projects/mod.ts";
import type { Sql } from "../../../../protocol/platform/mod.ts";

type Reader = Pick<Sql, "get" | "all">;

// 계약의 type들이 app-data source로 가리키는 앱 slug. 중복 없이 code unit 순이다. 내용이 BundleContent가
// 아니면(읽지 않은 판의 `{}`) null이다.
export function appDataAppsOf(
  content: Record<string, unknown>,
): string[] | null {
  const parsed = bundleContentSchema.safeParse(content);
  if (!parsed.success) return null;
  const apps = new Set<string>();
  for (const type of parsed.data.contract.types) {
    if (type.source.kind === "app-data") apps.add(type.source.app);
  }
  return [...apps].sort();
}

// context가 읽는 앱 slug들. code unit 순이다.
export function loadAppData(sql: Reader, context: string): string[] {
  return sql.all(
    "SELECT app FROM context_app_data WHERE context = ? ORDER BY app",
    [context],
  ).map((row) => String(row.app));
}

// 읽는 앱이 있는 모든 context와 그 앱 slug들. context id 순이고 slug는 code unit 순이다.
export function loadAllAppData(sql: Reader): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (
    const row of sql.all(
      "SELECT context, app FROM context_app_data ORDER BY context, app",
      [],
    )
  ) {
    const context = String(row.context);
    const slugs = found.get(context) ?? [];
    slugs.push(String(row.app));
    found.set(context, slugs);
  }
  return found;
}

// context의 행을 apps로 바꾼다.
export function saveAppData(
  sql: Sql,
  context: string,
  apps: readonly string[],
): void {
  sql.run("DELETE FROM context_app_data WHERE context = ?", [context]);
  for (const app of apps) {
    sql.run("INSERT INTO context_app_data (context, app) VALUES (?, ?)", [
      context,
      app,
    ]);
  }
}
