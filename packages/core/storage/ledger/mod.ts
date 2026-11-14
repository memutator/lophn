import type { Clock, IdSource, Result } from "../../../base/mod.ts";
import { err, ok } from "../../../base/mod.ts";
import type { RequestContext, Tx } from "../../../protocol/server/mod.ts";
import type {
  BlobRefRegistration,
  PermanentBlobReference,
} from "../../../protocol/storage/mod.ts";
import { LEDGER_SCHEMA_STEPS } from "./schema.ts";
import { type LedgerConnection, openConnection } from "./sqlite.ts";
import type { TxPortRegistration } from "./tx-ports.ts";
import { runTransaction, type TxCall, type TxDeps } from "./tx.ts";

export { LEDGER_SCHEMA_STEPS };

export { admitAgentTurn } from "./commands.ts";
export { turnAdmission } from "./turn-admission.ts";
export { withEraseWindow } from "./erase.ts";
export { type WriterRegistration } from "./writer-registration.ts";
export { defineTxPort, type TxPortRegistration } from "./tx-ports.ts";
export {
  afterCommit,
  type CommitAction,
  createAfterCommitCollector,
  requestPrincipal,
  STATE_CHANGED_TOPIC,
  withAfterCommit,
} from "./after-commit.ts";
export {
  createTargetAuthorizer,
  targetAuthorizationPort,
} from "./target-authorization.ts";
export type {
  CommandEnvelope,
  CommandSuccess,
  StoredCommandResult,
  Writer,
} from "./writer.ts";
export { openConnection };
export type { LedgerConnection };
export { createReaderPool } from "./reader-pool.ts";
export type { ReaderPool } from "./reader-pool.ts";
export {
  KNOWN_SECRETS,
  type KnownSecretChannel,
  type KnownSecretMatch,
} from "./known-secrets.ts";
export type { ReaderRegistration, ReaderRegistrationModule } from "./reads.ts";
export { snapshotPort } from "./reads.ts";
export { commandResultRead } from "./command-results.ts";

type LedgerDeps = {
  clock: Clock;
  ids: IdSource;
  ports?: readonly TxPortRegistration[];
  // blob 참조 등록과 command dispatch는 밖에서 넘긴다.
  registerBlobRef: (
    reference: BlobRefRegistration,
  ) => Result<PermanentBlobReference>;
  call: TxCall;
};

type Ledger = {
  // actor·turn은 transaction 시작 때 고정한다. handler는 바꾸지 못한다.
  // request는 테스트가 현재 자격을 명시할 때만 쓴다. 없으면 대상 권한 port가 request를 읽지 못한다.
  transaction<T>(
    ctx: { actor: string; turn?: string; request?: RequestContext },
    fn: (tx: Tx) => Result<T>,
  ): Result<T>;
  close(): void;
};

export function openLedger(path: string, deps: LedgerDeps): Result<Ledger> {
  const opened = openConnection(path);
  if (!opened.ok) return opened;
  return ok(ledger(opened.value, deps));
}

function ledger(connection: LedgerConnection, deps: LedgerDeps): Ledger {
  const txDeps: TxDeps = {
    clock: deps.clock,
    ids: deps.ids,
    ports: deps.ports ?? [],
    registerBlobRef: deps.registerBlobRef,
    call: deps.call,
  };
  return {
    transaction(ctx, fn) {
      let request: RequestContext | undefined;
      if (ctx.request !== undefined) {
        try {
          request = structuredClone(ctx.request);
        } catch {
          return err({
            code: "unavailable",
            message: "request 자격을 복사할 수 없다",
          });
        }
      }
      return runTransaction(
        connection,
        { actor: ctx.actor, turn: ctx.turn ?? null, request },
        txDeps,
        fn,
      );
    },
    close() {
      connection.close();
    },
  };
}
