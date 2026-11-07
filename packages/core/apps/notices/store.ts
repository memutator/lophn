import {
  type Notice,
  noticeActionSchema,
  noticeSchema,
} from "../../../protocol/apps/notice.ts";
import type { Sql } from "../../../protocol/server/mod.ts";

type Query = Pick<Sql, "get" | "all">;

// 읽을 때 앱 이름을 풀어 싣는다. app이 null인 program 줄(lophn 전체)도 읽힌다.
export const NOTICE_SELECT = `select n.id, n.source, n.app, a.name as app_name, n.project, n.kind, n.key, n.title,
  n.body, n.persistent, n.action, n.created_at, n.read_at
  from notices n left join apps a on a.id = n.app`;

export function noticeOf(row: Record<string, unknown>): Notice {
  const text = (value: unknown) => (value === null ? null : String(value));
  const action = text(row["action"]);
  return noticeSchema.parse({
    id: String(row["id"]),
    source: String(row["source"]),
    app: text(row["app"]),
    app_name: text(row["app_name"]),
    project: text(row["project"]),
    kind: String(row["kind"]),
    key: text(row["key"]),
    title: String(row["title"]),
    body: String(row["body"]),
    persistent: Number(row["persistent"]) === 1,
    action:
      action === null ? null : noticeActionSchema.parse(JSON.parse(action)),
    created_at: String(row["created_at"]),
    read_at: text(row["read_at"]),
  });
}

export function loadNotice(sql: Query, id: string): Notice | undefined {
  const row = sql.get(`${NOTICE_SELECT} where n.id = ?`, [id]);
  return row === undefined ? undefined : noticeOf(row);
}

// Inbox에 열린 줄: 안 읽은 것 전부. 보관한 앱의 줄은 보이지 않는다.
export function openNotices(sql: Query): Notice[] {
  return sql
    .all(
      `${NOTICE_SELECT}
       where n.read_at is null and (n.app is null or a.status = 'active')
       order by n.created_at, n.id`,
      [],
    )
    .map(noticeOf);
}
