import type { Clock, IdSource, Result } from "../../base/mod.ts";
import { err, ok } from "../../base/mod.ts";
import type {
  BlobRefRegistration,
  PermanentBlobReference,
  RequestContext,
  Tx,
} from "../../contracts/platform/mod.ts";
import { LEDGER_SCHEMA_STEPS } from "./schema.ts";
import { type LedgerConnection, openConnection } from "./sqlite.ts";
import type { SubscriberGate } from "./subscriber-registration.ts";
import type { TxPortRegistration } from "./tx-ports.ts";
import { runTransaction, type TxCall, type TxDeps } from "./tx.ts";

export { LEDGER_SCHEMA_STEPS };

export { LEDGER_COMMANDS } from "./commands.ts";
export { commandResultRead } from "./command-results.ts";
export { openWriter } from "./writer.ts";
export {
  createWriterRegistration,
  type CredentialCheck,
  type WriterRegistration,
} from "./writer-registration.ts";
export { defineTxPort, type TxPortRegistration } from "./tx-ports.ts";
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
export type { ReaderHealth, ReaderPool } from "./reader-pool.ts";
export type { ReaderRegistration, ReaderRegistrationModule } from "./reads.ts";
export { createListEventsRead, scanEvents } from "./events.ts";
export type { EventBatch, EventScan } from "./events.ts";
export { createReaderEventBackend } from "./event-backend.ts";
export {
  createEventVisibilityRegistry,
  currentEventContext,
} from "./event-visibility.ts";
export type {
  EventReadGate,
  EventVisibilityRegistry,
  SubjectScopeGate,
} from "./event-visibility.ts";
export {
  createEventDispatcher,
  createEventSession,
  resolveSubscriptionStart,
} from "./subscribe.ts";
export type {
  EventBackend,
  EventSession,
  EventSink,
  SubscribeStart,
} from "./subscribe.ts";
export { createSubscriptionStore } from "./subscription-store.ts";
export type { SubscriptionStore } from "./subscription-store.ts";
export { reactionIdempotencyKey } from "./reaction.ts";
export { createSubscriberGate } from "./subscriber-registration.ts";
export type {
  SubscriberBinding,
  SubscriberGate,
} from "./subscriber-registration.ts";

export type LedgerDeps = {
  clock: Clock;
  ids: IdSource;
  ports?: readonly TxPortRegistration[];
  // blob 참조 등록은 platform#T14, command dispatch는 platform#T18이 넘긴다.
  registerBlobRef: (
    reference: BlobRefRegistration,
  ) => Result<PermanentBlobReference>;
  call: TxCall;
  // actor·run만 있는 transaction은 이 gate가 있어도 현재 자격이 없어 cursor를 올리지 못한다.
  subscriberGate?: SubscriberGate;
};

export type Ledger = {
  // actor·run은 transaction 시작 때 고정한다. handler는 바꾸지 못한다.
  // request는 테스트가 현재 자격을 명시할 때만 쓴다. 없으면 cursor를 올리지 못한다.
  transaction<T>(
    ctx: { actor: string; run?: string; request?: RequestContext },
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
    ports: deps.ports ?? [],
    registerBlobRef: deps.registerBlobRef,
    call: deps.call,
    subscriberGate: deps.subscriberGate,
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
            message: "subscriber 검사를 사용할 수 없다",
          });
        }
      }
      return runTransaction(
        connection,
        { actor: ctx.actor, run: ctx.run ?? null, request },
        txDeps,
        fn,
      );
    },
    close() {
      connection.close();
    },
  };
}
export { defineSyncCommand } from "./handler.ts";
