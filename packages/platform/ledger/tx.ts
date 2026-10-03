import type { Clock, IdSource, Result } from "../../base/mod.ts";
import { err, formatSeq, internalError, ok, parseSeq } from "../../base/mod.ts";
import {
  type BlobRefRegistration,
  type CommandRoute,
  type IdPrefix,
  type PermanentBlobReference,
  type PortKey,
  type RequestContext,
  type Sql,
  subjectSchema,
  type Tx,
} from "../../contracts/platform/mod.ts";
import type { z } from "zod";
import {
  isSqlRejected,
  isTransactionLost,
  type LedgerConnection,
} from "./sqlite.ts";

export type TxCall = <R extends CommandRoute>(
  route: R,
  input: unknown,
  compare: unknown,
) => Result<unknown>;

export type TxDeps = {
  clock: Clock;
  ids: IdSource;
  ports: ReadonlyMap<unknown, unknown>;
  // blob 참조 등록은 platform#T14가 맡는다. 여기서는 주입만 받는다.
  registerBlobRef: (reference: BlobRefRegistration) => Result<
    PermanentBlobReference
  >;
  // 다른 owner command dispatch는 platform#T18이 맡는다. 여기서는 주입만 받는다.
  call: TxCall;
};

type TxContext = {
  actor: string;
  run: string | null;
};

// handler 안에서는 throw로만 거절을 알릴 수 있다. 경계에서 Result로 바꾼다.
class TxRejected extends Error {
  constructor(readonly result: Result<never>) {
    super("tx rejected");
  }
}

function rejected(thrown: unknown): Result<never> | undefined {
  if (thrown instanceof TxRejected) return thrown.result;
  if (isSqlRejected(thrown)) {
    return err({
      code: "invalid_input",
      message: "SQL이 transaction·연결 상태를 바꿀 수 없다",
    });
  }
  if (isTransactionLost(thrown)) return err(internalError());
  return undefined;
}

export function runTransaction<T>(
  connection: LedgerConnection,
  ctx: TxContext,
  deps: TxDeps,
  fn: (tx: Tx) => Result<T>,
): Result<T> {
  if (connection.inTransaction()) {
    return err({
      code: "invalid_input",
      message: "transaction 안에서 transaction을 열 수 없다",
    });
  }
  connection.exec("begin immediate");
  try {
    const result = fn(createTx(connection.sql, ctx, deps));
    if (result.ok) connection.exec("commit");
    else connection.exec("rollback");
    return result;
  } catch (thrown) {
    connection.exec("rollback");
    const failure = rejected(thrown);
    if (failure) return failure;
    return err(internalError());
  } finally {
    if (connection.inTransaction()) connection.exec("rollback");
  }
}

function createTx(sql: Sql, ctx: TxContext, deps: TxDeps): Tx {
  return {
    sql: guarded(sql),
    emit(event, subject, payload) {
      if (!subjectSchema.safeParse(subject).success) {
        throw new TxRejected(err({
          code: "invalid_input",
          message: "event subject가 schema와 다르다",
        }));
      }
      const parsed = event.payload.safeParse(payload);
      if (!parsed.success) {
        throw new TxRejected(err({
          code: "invalid_input",
          message: "event payload가 schema와 다르다",
        }));
      }
      const inserted = sql.run(
        "insert into events (type, subject, actor, run, payload, at) values (?, ?, ?, ?, ?, ?)",
        [
          event.type,
          subject,
          ctx.actor,
          ctx.run,
          JSON.stringify(parsed.data),
          deps.clock.now(),
        ],
      );
      return formatSeq(BigInt(inserted.lastInsertRowid));
    },
    now: () => deps.clock.now(),
    newId: (prefix: IdPrefix) => deps.ids.newId(prefix),
    port<T>(key: PortKey<T>): T {
      if (!deps.ports.has(key)) {
        throw new TxRejected(err(internalError()));
      }
      return deps.ports.get(key) as T;
    },
    registerBlobRef(reference) {
      return deps.registerBlobRef(reference);
    },
    advanceSubscriberCursor(subscriber, throughSeq) {
      const parsed = parseSeq(throughSeq);
      if (!parsed.ok || parsed.value < 0n) {
        return err({ code: "invalid_input", message: "seq가 아니다" });
      }
      const current = sql.get(
        "select processed_through_seq from subscriber_cursors where subscriber = ?",
        [subscriber],
      );
      if (current !== undefined) {
        const stored = current["processed_through_seq"];
        if (typeof stored !== "bigint" || parsed.value < stored) {
          return err({
            code: "conflict",
            message: "subscriber 처리 위치는 줄일 수 없다",
          });
        }
      }
      sql.run(
        `insert into subscriber_cursors (subscriber, processed_through_seq)
         values (?, ?)
         on conflict (subscriber) do update set
           processed_through_seq = excluded.processed_through_seq`,
        [subscriber, parsed.value],
      );
      return ok(undefined);
    },
    // 실제 접수와 approval 사용을 묶는 platform#T23 전에는 성공으로 기록하지 않는다.
    useApproval() {
      return err({
        code: "unavailable",
        message: "approval 적용을 아직 사용할 수 없다",
      });
    },
    call<R extends CommandRoute>(route: R, input: unknown, compare: unknown) {
      return deps.call(route, input, compare) as Result<z.output<R["output"]>>;
    },
  };
}

// tx.sql로 BEGIN 등을 실행하면 실행기의 commit과 어긋난다.
function guard<T>(fn: () => T): T {
  try {
    return fn();
  } catch (thrown) {
    const failure = rejected(thrown);
    if (failure) throw new TxRejected(failure);
    throw thrown;
  }
}

function guarded(sql: Sql): Sql {
  return {
    run: (text, params) => guard(() => sql.run(text, params)),
    get: (text, params) => guard(() => sql.get(text, params)),
    all: (text, params) => guard(() => sql.all(text, params)),
  };
}

export type { RequestContext };
