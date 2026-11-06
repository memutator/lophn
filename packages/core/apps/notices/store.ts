import type { AppNotice } from "../../../protocol/apps/notice.ts";
import type { Sql } from "../../../protocol/server/mod.ts";

type Query = Pick<Sql, "get" | "all">;

// 읽을 때 앱 이름을 풀어 싣는다. 보관된 앱의 줄은 보이지 않는다.
export function openNotices(sql: Query): AppNotice[] {
  return sql
    .all(
      `select n.id, n.app, a.name as app_name, n.key, n.title, n.body, n.created_at
       from app_notices n join apps a on a.id = n.app
       where a.status = 'active'
       order by n.created_at, n.id`,
      [],
    )
    .map((row) => ({
      id: String(row["id"]),
      app: String(row["app"]),
      app_name: String(row["app_name"]),
      key: row["key"] === null ? null : String(row["key"]),
      title: String(row["title"]),
      body: String(row["body"]),
      created_at: String(row["created_at"]),
    })) as AppNotice[];
}
