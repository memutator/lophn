// context.record_violations가 마지막으로 기록한 위반 키들(context_violation_keys 표).
import type { Sql } from "../../../../protocol/server/mod.ts";

export function loadViolationKeys(
  sql: Pick<Sql, "get">,
  context: string,
): string[] {
  const row = sql.get(
    "SELECT keys FROM context_violation_keys WHERE context = ?",
    [
      context,
    ],
  );
  return row === undefined ? [] : JSON.parse(String(row["keys"])) as string[];
}

export function saveViolationKeys(
  sql: Pick<Sql, "run">,
  context: string,
  keys: readonly string[],
): void {
  sql.run(
    `INSERT INTO context_violation_keys (context, keys) VALUES (?, ?)
     ON CONFLICT (context) DO UPDATE SET keys = excluded.keys`,
    [context, JSON.stringify(keys)],
  );
}
