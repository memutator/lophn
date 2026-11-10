import { EVENT_PUBLICATIONS_KEPT } from "../../../protocol/apps/events.ts";
import type { EventPublication } from "../../../protocol/apps/events.ts";
import type { Sql, SqlParam, Tx } from "../../../protocol/server/mod.ts";

type Query = Pick<Sql, "all">;

// 발행자마다 최근 EVENT_PUBLICATIONS_KEPT개만 둔다(id는 시간 순서다).
export function insertPublication(
  tx: Pick<Tx, "sql">,
  publication: EventPublication,
): void {
  tx.sql.run(
    `INSERT INTO app_event_publications
      (id, publisher, release, event, trace_id, at, reachable, unreachable, refused)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      publication.id,
      publication.publisher,
      publication.release,
      publication.event,
      publication.trace_id,
      publication.at,
      publication.reachable,
      publication.unreachable,
      publication.refused,
    ],
  );
  tx.sql.run(
    `DELETE FROM app_event_publications
      WHERE publisher = ? AND id NOT IN (
        SELECT id FROM app_event_publications WHERE publisher = ?
         ORDER BY id DESC LIMIT ?
      )`,
    [publication.publisher, publication.publisher, EVENT_PUBLICATIONS_KEPT],
  );
}

// 새 것부터. `after`는 마지막으로 받은 id다.
export function listPublications(
  sql: Query,
  filter: { publisher: string; event?: string; after?: string; limit: number },
): EventPublication[] {
  const where = ["publisher = ?"];
  const params: SqlParam[] = [filter.publisher];
  if (filter.event !== undefined) {
    where.push("event = ?");
    params.push(filter.event);
  }
  if (filter.after !== undefined) {
    where.push("id < ?");
    params.push(filter.after);
  }
  params.push(filter.limit);
  return sql
    .all(
      `SELECT * FROM app_event_publications WHERE ${where.join(" AND ")}
       ORDER BY id DESC LIMIT ?`,
      params,
    )
    .map(
      (row): EventPublication => ({
        id: String(row["id"]) as EventPublication["id"],
        publisher: String(row["publisher"]) as EventPublication["publisher"],
        release:
          row["release"] === null
            ? null
            : (String(row["release"]) as EventPublication["release"]),
        event: String(row["event"]),
        trace_id: String(row["trace_id"]),
        at: String(row["at"]) as EventPublication["at"],
        reachable: Number(row["reachable"]),
        unreachable: Number(row["unreachable"]),
        refused: Number(row["refused"]),
      }),
    );
}
