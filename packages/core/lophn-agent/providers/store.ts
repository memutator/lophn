import { err, ok, type Result } from "../../../base/mod.ts";
import type { ProviderRecord } from "../../../protocol/lophn-agent/mod.ts";
import type { Sql } from "../../../protocol/platform/mod.ts";
import { providerFromRow } from "./model.ts";

type Query = Pick<Sql, "get" | "all">;

function invalidStored(): Result<never> {
  return err({ code: "internal", message: "invalid stored provider" });
}

const COLUMNS =
  "id, name, definition_key, definition, endpoint, protocol, revision";

export function loadProvider(
  sql: Query,
  id: string,
): Result<ProviderRecord | null> {
  const row = sql.get(`select ${COLUMNS} from providers where id = ?`, [id]);
  if (row === undefined) return ok(null);
  return providerFromRow(sql, row);
}

export function listProviders(sql: Query): Result<ProviderRecord[]> {
  const rows = sql.all(`select ${COLUMNS} from providers order by id`, []);
  const providers: ProviderRecord[] = [];
  for (const row of rows) {
    const loaded = providerFromRow(sql, row);
    if (!loaded.ok) return loaded;
    if (loaded.value === null) return invalidStored();
    providers.push(loaded.value);
  }
  return ok(providers);
}
