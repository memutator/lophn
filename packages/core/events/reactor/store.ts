// Reactor가 events 표와 cursor 행을 읽는 SQL 구현. 쓰기는 밖에서 받는다(wiring은 writer command,
// 시험은 Ledger transaction).
import { err, ok, type Result } from "../../../base/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import { REACTOR_SUBSCRIBER } from "../subscriber-registration.ts";
import type { ReactorCursor, ReactorReader } from "./reactor.ts";

const UNAVAILABLE = {
  code: "unavailable" as const,
  message: "events를 읽을 수 없다",
};

export type EventsReader = ReactorReader & {
  // 근거 seq의 event 한 행. 없으면 null이다.
  at(seq: string): Promise<Result<unknown | null>>;
  // first..last(양 끝 포함)의 행. commit 뒤 Bus로 낼 때 쓴다.
  readRange(first: string, last: string): Promise<Result<unknown[]>>;
};

function envelope(row: Record<string, unknown>): unknown {
  return {
    ...row,
    seq: String(row.seq),
    payload: JSON.parse(String(row.payload)),
  };
}

export function createEventsReader(sql: Pick<Sql, "all">): EventsReader {
  const select = "select seq, type, subject, actor, at, payload from events";
  return {
    after(seq, limit) {
      try {
        return Promise.resolve(ok(
          sql.all(`${select} where seq > ? order by seq limit ?`, [
            BigInt(seq),
            limit,
          ]).map(envelope),
        ));
      } catch {
        return Promise.resolve(err(UNAVAILABLE));
      }
    },
    readRange(first, last) {
      try {
        return Promise.resolve(ok(
          sql.all(`${select} where seq between ? and ? order by seq`, [
            BigInt(first),
            BigInt(last),
          ]).map(envelope),
        ));
      } catch {
        return Promise.resolve(err(UNAVAILABLE));
      }
    },
    at(seq) {
      try {
        const [row] = sql.all(`${select} where seq = ?`, [BigInt(seq)]);
        return Promise.resolve(ok(row === undefined ? null : envelope(row)));
      } catch {
        return Promise.resolve(err(UNAVAILABLE));
      }
    },
  };
}

// cursor 행은 읽을 때마다 표에서 가져오고, 올릴 때는 마지막으로 읽은 값을 비교 기준으로 쓴다.
export function createSqlCursor(
  sql: Pick<Sql, "get">,
  write: (through: string, previous: string) => Promise<Result<void>>,
): ReactorCursor {
  let known = "0";
  return {
    read() {
      try {
        const row = sql.get(
          "select processed_through_seq from subscriber_cursors where subscriber = ?",
          [REACTOR_SUBSCRIBER],
        );
        known = row === undefined ? "0" : String(row.processed_through_seq);
        return Promise.resolve(ok(known));
      } catch {
        return Promise.resolve(err(UNAVAILABLE));
      }
    },
    async advance(through) {
      const written = await write(through, known);
      if (written.ok) known = through;
      return written;
    },
  };
}
