import { err, ok, type Result } from "../../base/mod.ts";
import {
  type DomainRecord,
  domainRecordSchema,
} from "../../protocol/domains/mod.ts";

export function domainFromRow(
  row: Record<string, unknown>,
): Result<DomainRecord> {
  const parsed = domainRecordSchema.safeParse({
    id: row.id,
    name: row.name,
    title: row.title,
    purpose: row.purpose,
    owner: { kind: row.owner_kind, id: row.owner_id },
    revision: row.revision,
    status: row.status,
  });
  return parsed.success
    ? ok(parsed.data)
    : err({ code: "internal", message: "invalid stored domain" });
}
