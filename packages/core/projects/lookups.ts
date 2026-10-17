import type { Tx } from "../../protocol/server/mod.ts";

// 다른 concern(lophn-agent의 agent 정의 저장소 등)이 project·context 표를 읽을 때 쓰는 읽기 함수다. 표는 이 module이
// 갖는다. 조립(core/main)이 port로 꽂으므로 다른 module은 SQL을 직접 쓰지 않는다.
type ReadSql = Pick<Tx["sql"], "get" | "all">;

export function projectExists(sql: ReadSql, id: string): boolean {
  return sql.get("select 1 as found from projects where id = ?", [id]) !==
    undefined;
}

export function projectIds(sql: ReadSql): string[] {
  return sql.all("select id from projects order by id", []).map((row) =>
    String(row["id"])
  );
}

// context가 속한 project. 없으면 null이다.
export function contextProjectOf(sql: ReadSql, id: string): string | null {
  const row = sql.get("select project from contexts where id = ?", [id]);
  return row === undefined ? null : String(row["project"]);
}

export function activeContextIds(sql: ReadSql, project: string): string[] {
  return sql.all(
    "select id from contexts where project = ? and status = 'active' order by id",
    [project],
  ).map((row) => String(row["id"]));
}
