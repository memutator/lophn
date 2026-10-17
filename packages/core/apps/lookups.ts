import type { Tx } from "../../protocol/server/mod.ts";

// 다른 concern(lophn-agent의 agent 정의 저장소 등)이 apps 표를 읽을 때 쓰는 읽기 함수다. 표는 이 module이 갖는다.
// 조립(core/main)이 port로 꽂으므로 다른 module은 SQL을 직접 쓰지 않는다.
type ReadSql = Pick<Tx["sql"], "get" | "all">;

export function appExists(sql: ReadSql, id: string): boolean {
  return sql.get("select 1 as found from apps where id = ?", [id]) !==
    undefined;
}

export function appIds(sql: ReadSql): string[] {
  return sql.all("select id from apps order by id", []).map((row) =>
    String(row["id"])
  );
}
