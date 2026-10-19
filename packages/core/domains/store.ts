import { err, ok, type Result } from "../../base/mod.ts";
import type { DomainOwner, DomainRecord } from "../../protocol/domains/mod.ts";
import type { Sql, Tx } from "../../protocol/server/mod.ts";
import { domainFromRow } from "./rows.ts";

type Query = Pick<Sql, "get" | "all">;

export function loadDomain(
  sql: Query,
  id: string,
): Result<DomainRecord | null> {
  const row = sql.get("SELECT * FROM domains WHERE id = ?", [id]);
  return row === undefined ? ok(null) : domainFromRow(row);
}

// id 순. owner와 status는 주면 거른다.
export function loadDomains(
  sql: Query,
  filter: {
    owner?: DomainOwner;
    status?: "active" | "archived";
  },
): Result<DomainRecord[]> {
  const where: string[] = [];
  const params: string[] = [];
  if (filter.owner !== undefined) {
    where.push("owner_kind = ? AND owner_id = ?");
    params.push(filter.owner.kind, filter.owner.id);
  }
  if (filter.status !== undefined) {
    where.push("status = ?");
    params.push(filter.status);
  }
  let text = "SELECT * FROM domains";
  if (where.length > 0) text += ` WHERE ${where.join(" AND ")}`;
  text += " ORDER BY id";
  const domains: DomainRecord[] = [];
  for (const row of sql.all(text, params)) {
    const domain = domainFromRow(row);
    if (!domain.ok) return domain;
    domains.push(domain.value);
  }
  return ok(domains);
}

export function insertDomain(tx: Pick<Tx, "sql">, domain: DomainRecord): void {
  tx.sql.run(
    `INSERT INTO domains
      (id, name, title, purpose, owner_kind, owner_id, revision, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      domain.id,
      domain.name,
      domain.title,
      domain.purpose,
      domain.owner.kind,
      domain.owner.id,
      domain.revision,
      domain.status,
    ],
  );
}

export function replaceDomainState(
  tx: Pick<Tx, "sql">,
  domain: DomainRecord,
): Result<void> {
  const changed = tx.sql.run(
    "UPDATE domains SET revision = ?, status = ? WHERE id = ?",
    [domain.revision, domain.status, domain.id],
  );
  return Number(changed.changes) === 1
    ? ok(undefined)
    : err({ code: "internal", message: "invalid stored domain" });
}
