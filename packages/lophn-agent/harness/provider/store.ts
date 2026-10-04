import { err, ok, type Result } from "../../../base/mod.ts";
import type { ProviderRecord } from "../../../contracts/lophn-agent/mod.ts";
import type { Sql } from "../../../contracts/platform/mod.ts";
import { providerFromRow } from "./model.ts";

type Query = Pick<Sql, "get" | "all">;

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored provider" });
}

export function loadProvider(
  sql: Query,
  id: string,
): Result<ProviderRecord | null> {
  const row = sql.get(
    "select id, name, definition_key, definition, endpoint, protocol, enabled, last_check, revision from providers where id = ?",
    [id],
  );
  if (row === undefined) return ok(null);
  return providerFromRow(sql, row);
}

export function listProviders(sql: Query): Result<ProviderRecord[]> {
  const rows = sql.all(
    "select id, name, definition_key, definition, endpoint, protocol, enabled, last_check, revision from providers order by id",
    [],
  );
  const providers: ProviderRecord[] = [];
  for (const row of rows) {
    const loaded = providerFromRow(sql, row);
    if (!loaded.ok) return loaded;
    if (loaded.value === null) return invalidStored();
    providers.push(loaded.value);
  }
  return ok(providers);
}
