import type { Sql } from "../../packages/protocol/server/mod.ts";

// session이 일하는 project 폴더(절대 경로)다. 되돌리기 기록의 경로는 이 폴더 기준 상대 경로다. 문서가
// 없는 자리(앱 session)나 폴더가 없는 project는 되돌릴 파일이 없어 던진다. 읽기와 쓰기 앞 처리기가
// 같이 쓴다.
export function projectRootOf(
  lookup: { sql: Pick<Sql, "get"> },
  session: string,
): string {
  const place = lookup.sql.get(
    "select work_place_kind, work_place_id from sessions where id = ?",
    [session],
  );
  if (place === undefined || place["work_place_kind"] !== "project") {
    throw new Error("the session has no project folder");
  }
  const folder = lookup.sql.get(
    "select path from project_folders where project = ? order by position limit 1",
    [String(place["work_place_id"])],
  );
  if (folder === undefined) throw new Error("the project has no folder");
  return String(folder["path"]);
}
