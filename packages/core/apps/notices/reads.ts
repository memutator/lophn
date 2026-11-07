import { err, ok } from "../../../base/mod.ts";
import {
  NOTICE_LIST_LIMIT_MAX,
  noticesList,
  noticesOpen,
} from "../../../protocol/apps/notice.ts";
import type { ReadDefinition } from "../../../protocol/server/mod.ts";
import { NOTICE_SELECT, noticeOf, openNotices } from "./store.ts";

const DEFAULT_LIMIT = 50;

// cursor는 마지막으로 준 줄의 (created_at, id)다. 최근 것이 먼저라 그보다 앞선 줄을 잇는다.
function decodeCursor(cursor: string): { at: string; id: string } | undefined {
  try {
    const value = JSON.parse(atob(cursor)) as { at?: unknown; id?: unknown };
    return typeof value.at === "string" && typeof value.id === "string"
      ? { at: value.at, id: value.id }
      : undefined;
  } catch {
    return undefined;
  }
}

const likeOf = (text: string) => `%${text.replace(/[\\%_]/g, "\\$&")}%`;

export const noticesListRead: ReadDefinition<typeof noticesList> = {
  route: noticesList,
  handle(snapshot, _ctx, input) {
    const where: string[] = [];
    const params: unknown[] = [];
    const eq = (column: string, value: unknown) => {
      where.push(`${column} = ?`);
      params.push(value);
    };
    if (input.source !== undefined) eq("n.source", input.source);
    if (input.app !== undefined) eq("n.app", input.app);
    if (input.project !== undefined) eq("n.project", input.project);
    if (input.kind !== undefined) eq("n.kind", input.kind);
    if (input.persistent !== undefined)
      eq("n.persistent", input.persistent ? 1 : 0);
    if (input.unread !== undefined) {
      where.push(input.unread ? "n.read_at is null" : "n.read_at is not null");
    }
    if (input.query !== undefined) {
      where.push("(n.title like ? escape '\\' or n.body like ? escape '\\')");
      params.push(likeOf(input.query), likeOf(input.query));
    }
    if (input.cursor !== undefined) {
      const at = decodeCursor(input.cursor);
      if (at === undefined) {
        return err({ code: "invalid_input", message: "invalid notice cursor" });
      }
      where.push("(n.created_at < ? or (n.created_at = ? and n.id < ?))");
      params.push(at.at, at.at, at.id);
    }
    const limit = Math.min(input.limit ?? DEFAULT_LIMIT, NOTICE_LIST_LIMIT_MAX);
    const rows = snapshot.sql.all(
      `${NOTICE_SELECT}
       ${where.length === 0 ? "" : `where ${where.join(" and ")}`}
       order by n.created_at desc, n.id desc limit ?`,
      [...params, limit + 1] as never[],
    );
    const page = rows.slice(0, limit).map(noticeOf);
    const last = page.at(-1);
    return ok({
      notices: page,
      as_of_seq: snapshot.as_of_seq,
      next_cursor:
        rows.length > limit && last !== undefined
          ? btoa(JSON.stringify({ at: last.created_at, id: last.id }))
          : null,
    });
  },
};

export const noticesOpenRead: ReadDefinition<typeof noticesOpen> = {
  route: noticesOpen,
  handle(snapshot) {
    return ok({
      notices: openNotices(snapshot.sql),
      as_of_seq: snapshot.as_of_seq,
      next_cursor: null,
    });
  },
};
