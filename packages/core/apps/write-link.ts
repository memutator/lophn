// invocation 기록과 rewind 기록이 core 메인 스레드에서 쓰는 ledger 연결 하나.
// invocations·rewind의 port는 동기라(`begin`, `markReverted`, rewind 표 쓰기) writer Worker의 command를
// 거치지 않고 이 연결의 짧은 transaction으로 쓴다. 이 두 표는 event를 남기지 않아 writer가 맡는
// 순번·event·idempotency와 겹치지 않고, SQLite WAL이 writer Worker와 쓰기를 번갈아 준다.
// blob 참조 등록만 writer 메모리 대신 core가 쥔 준비 참조(blob 중계)로 확인한다.
import {
  type Clock,
  err,
  type IdSource,
  ok,
  type Result,
} from "../../base/mod.ts";
import type { RequestContext, Sql, Tx } from "../../protocol/server/mod.ts";
import type { BlobFieldDefinition } from "../../protocol/storage/mod.ts";
import { createBlobRegistrar } from "../storage/blobs/mod.ts";
import {
  type LedgerConnection,
  openConnection,
} from "../storage/ledger/mod.ts";

type WriteLinkDeps = {
  ledgerPath: string;
  clock: Clock;
  ids: IdSource;
  // blob 참조 등록을 허용하는 field 선언 전체와 준비 참조가 살아 있는지의 판정.
  fields: readonly BlobFieldDefinition[];
  live(
    prepared: { hash: string; principal: string; purpose: string },
    nowMs: number,
  ): boolean;
  // 등록의 주체. 준비한 주체와 같아야 한다.
  as: RequestContext;
};

export type WriteLink = {
  // autocommit으로 읽고 쓴다.
  readonly sql: Sql;
  // `fn`이 err을 돌려주면 rollback한다. 안에서 쓸 수 있는 것은 `sql`과 `registerBlobRef`, `now`, `newId`뿐이다.
  transaction<T>(fn: (tx: Tx) => Result<T>): Result<T>;
  close(): void;
};

function unsupported(name: string): never {
  throw new Error(`the apps write link has no ${name}`);
}

export function openWriteLink(deps: WriteLinkDeps): Result<WriteLink> {
  const opened = openConnection(deps.ledgerPath);
  if (!opened.ok) return opened;
  const connection: LedgerConnection = opened.value;
  const register = createBlobRegistrar({
    preparations: {
      live: (prepared, nowMs) => ok(deps.live(prepared, nowMs)),
    },
    fields: deps.fields,
    nowMs: () => deps.clock.nowMs(),
    current: () => deps.as,
  });

  function rollback(): void {
    try {
      if (connection.inTransaction()) connection.exec("rollback");
    } catch {
      connection.fault();
    }
  }

  return ok({
    sql: connection.sql,
    transaction(fn) {
      if (connection.failed() || connection.inTransaction()) {
        return err({
          code: "unavailable",
          message: "ledger에 기록할 수 없다",
        });
      }
      try {
        connection.exec("begin immediate");
        const tx: Tx = {
          sql: connection.sql,
          now: () => deps.clock.now(),
          newId: (prefix) => deps.ids.newId(prefix),
          registerBlobRef: (reference) => register(connection.sql, reference),
          emit: () => unsupported("emit"),
          port: () => unsupported("port"),
          advanceSubscriberCursor: () => unsupported("subscriber cursor"),
          call: () => unsupported("call"),
        };
        const result = fn(tx);
        if (result.ok) connection.exec("commit");
        else rollback();
        return result;
      } catch {
        rollback();
        return err({
          code: "unavailable",
          message: "ledger에 기록할 수 없다",
        });
      }
    },
    close() {
      connection.close();
    },
  });
}
