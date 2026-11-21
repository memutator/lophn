import { ok } from "../../base/mod.ts";
import type { Id } from "../../protocol/base/ids.ts";
import { type Mail, mailSchema } from "../../protocol/lophn-agent/mail.ts";
import type { Sql } from "../../protocol/server/mod.ts";
import type { MailOutbox, MailSeen, MailSeenRow } from "./ports.ts";

type ReadSql = Pick<Sql, "get" | "all">;

// 줄의 mail은 넣을 때 schema를 지난 것이다. 읽지 못하는 줄은 없는 것으로 친다(내는 일이 나머지를 막지 않게).
function mailOf(text: unknown): Mail | null {
  try {
    const parsed = mailSchema.safeParse(JSON.parse(String(text)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createMailOutbox(): MailOutbox {
  return {
    put(tx, draft) {
      const peer = draft.to_machine;
      const row = tx.sql.get("select next from mail_seq where peer = ?", [
        peer,
      ]);
      const seq = row === undefined ? 1 : Number(row["next"]);
      tx.sql.run(
        `insert into mail_seq (peer, next) values (?, ?)
         on conflict (peer) do update set next = excluded.next`,
        [peer, seq + 1],
      );
      const mail = { ...draft, id: tx.newId("mal"), seq } as Mail;
      tx.sql.run(
        `insert into mail_outbox (id, peer, seq, call, kind, mail, sent_at, expires_at)
         values (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          mail.id,
          peer,
          seq,
          mail.call,
          mail.kind,
          JSON.stringify(mail),
          mail.sent_at,
          mail.expires_at,
        ],
      );
      return ok(mail);
    },
    remove(tx, id) {
      tx.sql.run("delete from mail_outbox where id = ?", [id]);
      return ok(undefined);
    },
    read(tx, id) {
      const row = tx.sql.get("select mail from mail_outbox where id = ?", [id]);
      return row === undefined ? null : mailOf(row["mail"]);
    },
    callMailOf(tx, call) {
      const row = tx.sql.get(
        "select mail from mail_outbox where call = ? and kind = 'call'",
        [call],
      );
      return row === undefined ? null : mailOf(row["mail"]);
    },
  };
}

function seenOf(row: Record<string, unknown>): MailSeenRow {
  return {
    origin: String(row["origin"]),
    id: String(row["id"]),
    call: String(row["call"]),
    kind: String(row["kind"]) as Mail["kind"],
    state: String(row["state"]) as MailSeenRow["state"],
    mail: row["mail"] === null ? null : mailOf(row["mail"]),
    computer: String(row["computer"]),
    arrived_at: String(row["arrived_at"]),
  };
}

export function createMailSeen(): MailSeen {
  return {
    mark(tx, row) {
      const done = tx.sql.run(
        `insert into mail_seen (origin, id, call, kind, state, mail, computer, arrived_at)
         values (?, ?, ?, ?, ?, ?, ?, ?) on conflict (origin, id) do nothing`,
        [
          row.origin,
          row.id,
          row.call,
          row.kind,
          row.state,
          row.mail === null ? null : JSON.stringify(row.mail),
          row.computer,
          row.arrived_at,
        ],
      );
      return Number(done.changes) === 1;
    },
    read(tx, origin, id) {
      const row = tx.sql.get(
        "select * from mail_seen where origin = ? and id = ?",
        [origin, id],
      );
      return row === undefined ? null : seenOf(row);
    },
  };
}

// main thread의 drain이 읽는다. 상대 기계마다 seq 순이다.
export function pendingMails(sql: ReadSql, peer?: Id<"mch">): Mail[] {
  const rows =
    peer === undefined
      ? sql.all("select mail from mail_outbox order by peer, seq", [])
      : sql.all("select mail from mail_outbox where peer = ? order by seq", [
          peer,
        ]);
  return rows.flatMap((row) => mailOf(row["mail"]) ?? []);
}

// 낼 mail이 남은 상대 기계.
export function outboxPeers(sql: ReadSql): Id<"mch">[] {
  return sql
    .all("select distinct peer from mail_outbox order by peer", [])
    .map((row) => String(row["peer"]) as Id<"mch">);
}

// 그 기계의 그 mail을 이미 받았는지.
export function mailSeen(
  sql: ReadSql,
  origin: Id<"mch">,
  id: Id<"mal">,
): boolean {
  return (
    sql.get("select 1 from mail_seen where origin = ? and id = ?", [
      origin,
      id,
    ]) !== undefined
  );
}
