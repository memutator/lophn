import type { DomainInfo, DomainOwner } from "../../protocol/domains/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";

// 다른 module과 조립(core/main)이 domains 표를 읽을 때 쓰는 읽기 함수다. 표는 이 module이 갖는다.
// 다른 module은 SQL을 직접 쓰지 않는다.
type ReadSql = Pick<Tx["sql"], "get" | "all">;

const COLUMNS = "id, name, owner_kind, owner_id, status";

function infoOf(row: Record<string, unknown>): DomainInfo {
  return {
    id: String(row["id"]),
    name: String(row["name"]),
    owner: { kind: row["owner_kind"], id: row["owner_id"] } as DomainOwner,
    status: row["status"] === "archived" ? "archived" : "active",
  };
}

export function domainOf(sql: ReadSql, id: string): DomainInfo | null {
  const row = sql.get(`SELECT ${COLUMNS} FROM domains WHERE id = ?`, [id]);
  return row === undefined ? null : infoOf(row);
}

export function domainByName(sql: ReadSql, name: string): DomainInfo | null {
  const row = sql.get(`SELECT ${COLUMNS} FROM domains WHERE name = ?`, [name]);
  return row === undefined ? null : infoOf(row);
}

// 그릇의 domain. 이름순이다.
export function domainsOfOwner(
  sql: ReadSql,
  owner: DomainOwner,
  status?: "active" | "archived",
): DomainInfo[] {
  const rows = status === undefined
    ? sql.all(
      `SELECT ${COLUMNS} FROM domains WHERE owner_kind = ? AND owner_id = ? ORDER BY name`,
      [owner.kind, owner.id],
    )
    : sql.all(
      `SELECT ${COLUMNS} FROM domains WHERE owner_kind = ? AND owner_id = ? AND status = ? ORDER BY name`,
      [owner.kind, owner.id, status],
    );
  return rows.map(infoOf);
}

export function domainOwnerOf(
  sql: ReadSql,
  domain: string,
): DomainOwner | null {
  return domainOf(sql, domain)?.owner ?? null;
}

// 그릇의 domain id 전부(보관한 것 포함). active만 필요하면 `domainsOfOwner(sql, owner, "active")`다.
export function domainIdsOfOwner(sql: ReadSql, owner: DomainOwner): string[] {
  return sql.all(
    "SELECT id FROM domains WHERE owner_kind = ? AND owner_id = ? ORDER BY id",
    [owner.kind, owner.id],
  ).map((row) => String(row["id"]));
}

export function activeDomainIds(sql: ReadSql): string[] {
  return sql.all(
    "SELECT id FROM domains WHERE status = 'active' ORDER BY id",
    [],
  )
    .map((row) => String(row["id"]));
}
