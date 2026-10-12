import type { Sql, Tx } from "../../protocol/platform/mod.ts";

// notifications 행과 source event의 관계. handler와 read가 같은 모양으로 본다.
export type NotificationRow = {
  id: string;
  source_seq: string;
  read_at: string | null;
};

export function notificationOf(row: Record<string, unknown>): NotificationRow {
  return {
    id: String(row["id"]),
    source_seq: String(row["source_seq"]),
    read_at: row["read_at"] === null || row["read_at"] === undefined
      ? null
      : String(row["read_at"]),
  };
}

export function readNotificationRow(
  sql: Pick<Sql, "get" | "all">,
  id: string,
): { notification: NotificationRow; source_event: string } | undefined {
  const row = sql.get(
    "select id, cast(source_seq as text) as source_seq, read_at from notifications where id = ?",
    [id],
  );
  if (row === undefined) return undefined;
  const source = sql.get(
    "select type from events where seq = ?",
    [BigInt(String(row["source_seq"]))],
  );
  return {
    notification: notificationOf(row),
    source_event: source === undefined ? "" : String(source["type"]),
  };
}

export function insertNotification(
  tx: Tx,
  notification: NotificationRow,
): void {
  tx.sql.run(
    "insert into notifications (id, source_seq, read_at) values (?, ?, ?)",
    [notification.id, BigInt(notification.source_seq), notification.read_at],
  );
}

export function markRead(
  sql: Sql,
  id: string,
  readAt: string,
): { row: NotificationRow; changed: boolean } | undefined {
  const row = sql.get(
    "select id, cast(source_seq as text) as source_seq, read_at from notifications where id = ?",
    [id],
  );
  if (row === undefined) return undefined;
  const notification = notificationOf(row);
  if (notification.read_at !== null) {
    return { row: notification, changed: false };
  }
  sql.run(
    "update notifications set read_at = ? where id = ? and read_at is null",
    [readAt, id],
  );
  return { row: { ...notification, read_at: readAt }, changed: true };
}
