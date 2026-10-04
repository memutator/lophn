import type { Clock, IdSource, Result } from "../../base/mod.ts";
import { ok } from "../../base/mod.ts";
import type {
  BlobRefRegistration,
  PermanentBlobReference,
  Tx,
} from "../../contracts/platform/mod.ts";
import { LEDGER_SCHEMA_STEPS } from "./schema.ts";
import { type LedgerConnection, openConnection } from "./sqlite.ts";
import { runTransaction, type TxCall, type TxDeps } from "./tx.ts";

export { LEDGER_SCHEMA_STEPS };
export { openConnection };
export type { LedgerConnection };
export { createReaderPool } from "./reader-pool.ts";
export type { ReaderHealth, ReaderPool } from "./reader-pool.ts";
export type { ReaderRegistration, ReaderRegistrationModule } from "./reads.ts";

export type LedgerDeps = {
  clock: Clock;
  ids: IdSource;
  ports?: ReadonlyMap<unknown, unknown>;
  // blob 참조 등록은 platform#T14, command dispatch는 platform#T18이 넘긴다.
  registerBlobRef: (
    reference: BlobRefRegistration,
  ) => Result<PermanentBlobReference>;
  call: TxCall;
};

export type Ledger = {
  // actor·run은 transaction 시작 때 고정한다. handler는 바꾸지 못한다.
  transaction<T>(
    ctx: { actor: string; run?: string },
    fn: (tx: Tx) => Result<T>,
  ): Result<T>;
  close(): void;
};

export function openLedger(
  path: string,
  deps: LedgerDeps,
): Result<Ledger> {
  const opened = openConnection(path);
  if (!opened.ok) return opened;
  return ok(ledger(opened.value, deps));
}

function ledger(connection: LedgerConnection, deps: LedgerDeps): Ledger {
  const txDeps: TxDeps = {
    clock: deps.clock,
    ids: deps.ids,
    ports: deps.ports ?? new Map(),
    registerBlobRef: deps.registerBlobRef,
    call: deps.call,
  };
  return {
    transaction(ctx, fn) {
      return runTransaction(
        connection,
        { actor: ctx.actor, run: ctx.run ?? null },
        txDeps,
        fn,
      );
    },
    close() {
      connection.close();
    },
  };
}
