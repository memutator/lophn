import type { Clock, IdSource, Result } from "../../../base/mod.ts";
import {
  canonicalize,
  err,
  formatSeq,
  internalError,
  ok,
  parseSeq,
} from "../../../base/mod.ts";
import {
  type ChosenOptionCall,
  questionOption,
  type RequestContext,
  type Sql,
  TargetAuthorization,
  type Tx,
} from "../../../protocol/server/mod.ts";
import type {
  BlobRefRegistration,
  PermanentBlobReference,
} from "../../../protocol/storage/mod.ts";
import type {
  CommandRoute,
  IdPrefix,
  PortKey,
} from "../../../protocol/base/mod.ts";
import { subjectSchema } from "../../../protocol/events/mod.ts";
import type { z } from "zod";
import {
  isSqlRejected,
  isStorageUnavailable,
  isTransactionLost,
  type LedgerConnection,
} from "./sqlite.ts";
import {
  authorizeSubscriberCursor,
  type SubscriberGate,
} from "../../events/subscriber-registration.ts";
import { targetAuthorizationPort } from "./target-authorization.ts";
import { useApproval as useApprovalRecord } from "./approval-use.ts";
import type { CommandDispatch } from "./dispatch.ts";
import { actorKind } from "./command-outcome.ts";
import {
  createTxPortLookup,
  type TxPortLookup,
  type TxPortRegistration,
} from "./tx-ports.ts";

export type TxCall = <R extends CommandRoute>(
  route: R,
  input: unknown,
  compare: unknown,
) => Result<unknown>;

export type TxDeps = {
  clock: Clock;
  ids: IdSource;
  ports: readonly TxPortRegistration[];
  // blob 참조 등록은 platform/blob-store가 맡는다. 여기서는 주입만 받는다.
  registerBlobRef: (reference: BlobRefRegistration) => Result<
    PermanentBlobReference
  >;
  // 다른 owner command dispatch. 없으면 등록된 command를 부르지 않는다.
  dispatch?: CommandDispatch;
  call: TxCall;
  // 현재 자격의 subscriber owner 검사. 없으면 cursor는 올리지 않는다.
  subscriberGate?: SubscriberGate;
  // transaction이 열리고 닫힐 때 그 Tx를 알린다. blob 등록이 같은 sql을 쓰기 위해서다.
  onTx?(tx: Tx | undefined): void;
};

type TxContext = {
  actor: string;
  run: string | null;
  // command 실행기의 현재 자격 snapshot. lowlevel transaction에는 없다.
  request?: RequestContext;
};

// handler 안에서는 throw로만 거절을 알릴 수 있다. 경계에서 Result로 바꾼다.
class TxRejected extends Error {
  readonly result: Result<never>;
  constructor(result: Result<never>) {
    super("tx rejected");
    this.result = result;
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

function storageFailure(thrown: unknown): Result<never> | undefined {
  if (!isStorageUnavailable(thrown)) return undefined;
  return err({ code: "unavailable", message: "ledger에 기록할 수 없다" });
}

function settle(thrown: unknown): Result<never> {
  const failure = rejected(thrown) ?? storageFailure(thrown);
  if (failure) return failure;
  return err(internalError());
}

const UNAVAILABLE = err({
  code: "unavailable" as const,
  message: "ledger에 기록할 수 없다",
});

// rollback 실패는 원래 분류를 덮지 않는다. 연결은 닫고 다시 쓰지 않는다.
function rollback(connection: LedgerConnection): Result<never> | undefined {
  try {
    if (connection.inTransaction()) connection.exec("rollback");
    return undefined;
  } catch {
    connection.fault();
    return UNAVAILABLE;
  }
}

// fn은 Tx와 seal을 받는다. seal 뒤나 fn이 끝난 뒤 Tx의 모든 입구는 닫힌다.
export function runTransaction<T>(
  connection: LedgerConnection,
  ctx: TxContext | (() => Result<TxContext>),
  deps: TxDeps,
  fn: (tx: Tx, seal: () => void) => Result<T>,
): Result<T> {
  if (connection.failed()) return UNAVAILABLE;
  if (connection.inTransaction()) {
    return err({
      code: "invalid_input",
      message: "transaction 안에서 transaction을 열 수 없다",
    });
  }
  try {
    connection.exec("begin immediate");
    const resolved = typeof ctx === "function" ? ctx() : ok(ctx);
    if (!resolved.ok) {
      const failed = rollback(connection);
      return failed ?? resolved;
    }
    const built = createTx(connection.sql, resolved.value, deps);
    let handled: Result<T>;
    try {
      handled = fn(built.tx, built.seal);
    } finally {
      built.seal();
    }
    // handler가 거절 throw를 자체 try/catch로 삼켜도 fail-closed로 유지한다.
    const result = built.failure() ?? handled;
    if (result.ok) connection.exec("commit");
    else {
      const failed = rollback(connection);
      if (failed) return failed;
    }
    return result;
  } catch (thrown) {
    const failed = rollback(connection);
    if (failed) return failed;
    return settle(thrown);
  }
}

const CHOSEN_FORBIDDEN = err({
  code: "forbidden" as const,
  message: "사람이 고른 고정 action이 아니다",
});

const COMMAND_MAX_CHANGED_ROWS = 1000n;

const OVER_LIMIT = err({
  code: "invalid_input" as const,
  message: "변경 행이 한도를 넘는다",
});

const READ_CHANGED = err({
  code: "invalid_input" as const,
  message: "읽기 SQL이 행을 바꿀 수 없다",
});

// 닫힌 Tx를 붙잡은 후속 코드다. 새 효과나 값 접근을 주지 않는다.
class TxClosed extends Error {
  constructor() {
    super("tx is closed");
  }
}

type BuiltTx = {
  tx: Tx;
  seal: () => void;
  failure: () => Result<never> | undefined;
};

function createTx(sql: Sql, ctx: TxContext, deps: TxDeps): BuiltTx {
  let open = true;
  let changedRows = 0n;
  let sticky: Result<never> | undefined;
  const fail = (result: Result<never>): TxRejected => {
    sticky ??= result;
    return new TxRejected(result);
  };
  const live = () => {
    if (!open) throw new TxClosed();
  };
  // 같은 native 연결의 total_changes 차이다. RETURNING·trigger 변경까지 한 방식으로 센다.
  const totalChanges = (): bigint => {
    let found: unknown;
    try {
      found = sql.get("select total_changes() as n", [])?.["n"];
    } catch (thrown) {
      throw fail(storageFailure(thrown) ?? err(internalError()));
    }
    if (typeof found !== "bigint" || found < 0n) {
      throw fail(err(internalError()));
    }
    return found;
  };
  const measured = <T>(write: boolean, fn: () => T): T => {
    live();
    const before = totalChanges();
    let value: T | undefined;
    let thrown: { error: unknown } | undefined;
    try {
      value = fn();
    } catch (error) {
      thrown = { error };
    }
    const changed = totalChanges() - before;
    if (changed < 0n) throw fail(err(internalError()));
    if (!write && changed > 0n) throw fail(READ_CHANGED);
    changedRows += changed;
    if (changedRows > COMMAND_MAX_CHANGED_ROWS) throw fail(OVER_LIMIT);
    if (thrown !== undefined) throw sqlFailure(thrown.error, fail);
    return value as T;
  };
  const emitAs = (
    actor: string,
    run: string | null,
    event: { type: string; payload: z.ZodType },
    subject: string | null,
    payload: unknown,
  ): string => {
    live();
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
    // event 행도 변경 행 한도에 든다. 실행기의 command_results 한 행만 뺀다.
    const inserted = measured(true, () =>
      sql.run(
        "insert into events (type, subject, actor, run, payload, at) values (?, ?, ?, ?, ?, ?)",
        [
          event.type,
          subject,
          actor,
          run,
          JSON.stringify(parsed.data),
          deps.clock.now(),
        ],
      ));
    return formatSeq(BigInt(inserted.lastInsertRowid));
  };
  const ports: { current?: TxPortLookup } = {};
  const tx: Tx & { portLookup?: TxPortLookup } = {
    sql: {
      run: (text, params) => measured(true, () => sql.run(text, params)),
      get: (text, params) => measured(false, () => sql.get(text, params)),
      all: (text, params) => measured(false, () => sql.all(text, params)),
    },
    emit: (event, subject, payload) =>
      emitAs(ctx.actor, ctx.run, event, subject, payload),
    now: () => {
      live();
      return deps.clock.now();
    },
    newId: (prefix: IdPrefix) => {
      live();
      return deps.ids.newId(prefix);
    },
    port<T>(key: PortKey<T>): T {
      if (ports.current === undefined) throw fail(err(internalError()));
      return ports.current.port(key);
    },
    registerBlobRef(reference) {
      live();
      return deps.registerBlobRef(reference);
    },
    advanceSubscriberCursor(subscriber, throughSeq) {
      live();
      const allowed = authorizeSubscriberCursor(
        deps.subscriberGate,
        subscriber,
        ctx.request,
      );
      if (!allowed.ok) throw fail(allowed);
      const parsed = parseSeq(throughSeq);
      if (!parsed.ok || parsed.value < 0n) {
        return err({ code: "invalid_input", message: "seq가 아니다" });
      }
      const current = measured(false, () =>
        sql.get(
          "select processed_through_seq from subscriber_cursors where subscriber = ?",
          [subscriber],
        ));
      if (current !== undefined) {
        const stored = current["processed_through_seq"];
        if (typeof stored !== "bigint" || parsed.value < stored) {
          return err({
            code: "conflict",
            message: "subscriber 처리 위치는 줄일 수 없다",
          });
        }
      }
      measured(true, () =>
        sql.run(
          `insert into subscriber_cursors (subscriber, processed_through_seq)
         values (?, ?)
         on conflict (subscriber) do update set
           processed_through_seq = excluded.processed_through_seq`,
          [subscriber, parsed.value],
        ));
      return ok(undefined);
    },
    // 정확한 action 일치 확인과 approval_uses 기록은 소유 변경과 같은 transaction이다.
    useApproval(approval, action, use) {
      live();
      return useApprovalRecord(tx, approval, action, use);
    },
    callChosenOption<R extends CommandRoute>(
      route: R,
      input: unknown,
      compare: unknown,
      evidence: { question: string; option: string },
      handle: (tx: Tx) => Result<z.output<R["output"]>>,
    ) {
      live();
      // 사람 결정을 대신하는 유일한 경로. 자격은 machine만이다.
      if (actorKind(ctx.actor) !== "machine") return CHOSEN_FORBIDDEN;
      if (ports.current?.present(questionOption as PortKey<unknown>) !== true) {
        return CHOSEN_FORBIDDEN;
      }
      let chosen: Result<ChosenOptionCall>;
      try {
        chosen = tx.port(questionOption).chosen(evidence.question);
      } catch (thrown) {
        if (thrown instanceof TxRejected || isSqlRejected(thrown)) throw thrown;
        return CHOSEN_FORBIDDEN;
      }
      // 질문·답이 없거나 고정 action이 없는 경우도 같은 답이다(존재를 새지 않는다).
      if (!chosen.ok) return CHOSEN_FORBIDDEN;
      if (
        chosen.value.option !== evidence.option ||
        chosen.value.route !== route.name ||
        canonicalize(chosen.value.input) !== canonicalize(input) ||
        canonicalize(chosen.value.compare ?? null) !==
          canonicalize(compare ?? null)
      ) {
        return CHOSEN_FORBIDDEN;
      }
      // 같은 질문 option은 한 번만 적용한다. 기록은 소유 변경과 같은 transaction이다.
      try {
        measured(true, () =>
          sql.run(
            "insert into question_evidence (evidence_key, question, option, at) values (?, ?, ?, ?)",
            [
              `${evidence.question}\u0000${evidence.option}`,
              evidence.question,
              evidence.option,
              deps.clock.now(),
            ],
          ));
      } catch (thrown) {
        if (thrown instanceof TxRejected || isSqlRejected(thrown)) throw thrown;
        return err({
          code: "conflict",
          message: "질문 option은 이미 적용했다",
        });
      }
      return handle(chosenTx) as Result<z.output<R["output"]>>;
    },
    call<R extends CommandRoute>(route: R, input: unknown, compare: unknown) {
      live();
      if (deps.dispatch !== undefined) {
        return deps.dispatch.call(tx, route, input, compare) as Result<
          z.output<R["output"]>
        >;
      }
      return deps.call(route, input, compare) as Result<z.output<R["output"]>>;
    },
  };
  // 근거를 검증한 option 적용 한 번에만 넘기는 Tx다. event는 사람 자격(user, run 없음)으로
  // 기록하고, 다시 사람 자격으로 바꾸거나 다른 command를 부르는 입구는 없다.
  const chosenTx: Tx = {
    ...tx,
    emit: (event, subject, payload) =>
      emitAs("user", null, event, subject, payload),
    callChosenOption: () => CHOSEN_FORBIDDEN,
    call: () => CHOSEN_FORBIDDEN,
  };
  const ownerPorts = deps.ports.some((port) => port.key === TargetAuthorization)
    ? deps.ports
    : [targetAuthorizationPort(ctx.request), ...deps.ports];
  ports.current = createTxPortLookup(ownerPorts, tx, live, (result) => {
    throw fail(result);
  });
  tx.portLookup = ports.current;
  deps.onTx?.(tx);
  return {
    tx,
    seal: () => {
      open = false;
      ports.current?.seal();
      deps.onTx?.(undefined);
    },
    failure: () => sticky,
  };
}

// 연결 상태를 바꾼 SQL·저장 오류는 handler가 삼켜도 commit하지 않는다.
// 제약 위반 같은 문장 오류는 SQLite가 그 문장만 되돌리므로 handler가 다룰 수 있다.
function sqlFailure(
  thrown: unknown,
  fail: (result: Result<never>) => TxRejected,
): unknown {
  if (thrown instanceof TxRejected) return thrown;
  const failure = rejected(thrown) ?? storageFailure(thrown);
  return failure ? fail(failure) : thrown;
}

export type { RequestContext };
