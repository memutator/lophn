// session rewind가 다른 module의 기록을 읽는 glue다. lophn-agent와 apps는 서로를 import하지 않으므로 조립이
// 둘의 표를 잇는다. 두 군데가 쓴다: core의 rewind wiring(wiring/lophn-agent-session.ts)과 reader Worker의
// 등록(wiring/rewind-registration.ts).
import type { AppWrites } from "../../lophn-agent/ports.ts";
import type { Sql } from "../../../protocol/server/mod.ts";

type Lookup = { sql: Pick<Sql, "get" | "all"> };

// 고른 시점(checkpointSeq, messages.created_seq 쪽 순번) 뒤에 이 session의 turn이 앱에 한 write invocation이다.
// 시점 뒤의 turn은 입력 메시지가 그 시점 이후인 turn이다. 이미 되돌린 invocation과 거절된 호출, live가 아닌
// 호출은 앱 rewind가 고를 수 없어 뺀다. invocation id는 시간 순서다.
export function appWritesOf(lookup: Lookup): AppWrites {
  return {
    writesAfter(session, checkpointSeq) {
      const rows = lookup.sql.all(
        `select i.app as app, i.id as id
           from invocations i
          where i.session = ? and i.effect in ('write', 'external')
            and i.mode = 'live' and i.status <> 'denied' and i.reverted_by is null
            and i.turn in (
              select r.id from turns r join messages m on m.id = r.input_message
               where r.session = i.session and m.created_seq >= ?
            )
          order by i.id`,
        [session, Number(checkpointSeq)],
      );
      const byApp = new Map<string, string[]>();
      for (const row of rows) {
        const app = String(row["app"]);
        byApp.set(app, [...byApp.get(app) ?? [], String(row["id"])]);
      }
      return [...byApp].map(([app, invocations]) => ({
        app: app as never,
        invocations: invocations as never,
      }));
    },
  };
}

// 그 session의 place가 file tool에 연 쓰기 폴더(절대 경로)다. project는 등록한 폴더, 앱은 source 폴더이고,
// lophn은 읽기만 하므로 없다.
export function placeFoldersOf(lookup: Lookup, session: string): string[] {
  const found = lookup.sql.get(
    "select role, place_kind, place_id from sessions where id = ?",
    [session],
  );
  if (found === undefined) return [];
  if (
    found["role"] === "project_manager" && found["place_kind"] === "project"
  ) {
    return lookup.sql.all(
      "select path from project_folders where project = ? order by position",
      [String(found["place_id"])],
    ).map((row) => String(row["path"]));
  }
  if (found["role"] === "app_engineer" && found["place_kind"] === "app") {
    const app = lookup.sql.get("select source_path from apps where id = ?", [
      String(found["place_id"]),
    ]);
    return app === undefined || app["source_path"] === null
      ? []
      : [String(app["source_path"])];
  }
  return [];
}
