import type { Clock, IdSource, Result } from "../../../base/mod.ts";
import { err, formatSeq, ok } from "../../../base/mod.ts";
import { eventSpan, headSeq } from "./command-outcome.ts";
import type { RequestContext, Tx } from "../../../protocol/server/mod.ts";
import type {
  BlobRefRegistration,
  PermanentBlobReference,
} from "../../../protocol/storage/mod.ts";
import { LEDGER_SCHEMA_STEPS } from "./schema.ts";
import { type LedgerConnection, openConnection } from "./sqlite.ts";
import type { SubscriberGate } from "../../events/subscriber-registration.ts";
import type { TxPortRegistration } from "./tx-ports.ts";
import { runTransaction, type TxCall, type TxDeps } from "./tx.ts";
import type { CommandSuccess } from "./writer-message.ts";

export { LEDGER_SCHEMA_STEPS };

export {
  admitAgentRun,
  LEDGER_COMMANDS,
  type RunDisposition,
  type RunMarkedCommand,
} from "./commands.ts";
export { type RunAdmission, runAdmission } from "./run-admission.ts";
export { recordedUse, usableApproval } from "./approval-use.ts";
export { withEraseWindow } from "./erase.ts";
export { commandResultRead } from "./command-results.ts";
export { openWriter, runCommand } from "./writer.ts";
export {
  createWriterRegistration,
  type CredentialCheck,
  type WriterRegistration,
} from "./writer-registration.ts";
export { defineTxPort, type TxPortRegistration } from "./tx-ports.ts";
export {
  type AfterCommit,
  afterCommit,
  type CommitAction,
  createAfterCommitCollector,
  requestPrincipal,
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
export type { ReaderHealth, ReaderPool } from "./reader-pool.ts";
export {
  KNOWN_SECRETS,
  type KnownSecretChannel,
  type KnownSecretMatch,
} from "./known-secrets.ts";
export type { ReaderRegistration, ReaderRegistrationModule } from "./reads.ts";
export { snapshotPort } from "./reads.ts";
export {
  createEventVisibilityRegistry,
  currentEventContext,
} from "../../events/visibility.ts";
export type {
  EventReadGate,
  EventRegistration,
  EventVisibilityRegistry,
  SubjectScopeGate,
} from "../../events/visibility.ts";
export { isDomainEvent } from "./domain-events.ts";
export {
  type CommitEventReader,
  createCommitPublisher,
} from "./commit-publisher.ts";
export { reactionIdempotencyKey } from "./reaction.ts";
export { createSubscriberGate } from "../../events/subscriber-registration.ts";
export type {
  SubscriberBinding,
  SubscriberGate,
} from "../../events/subscriber-registration.ts";

export type LedgerDeps = {
  clock: Clock;
  ids: IdSource;
  ports?: readonly TxPortRegistration[];
  // blob 참조 등록과 command dispatch는 밖에서 넘긴다.
  registerBlobRef: (
    reference: BlobRefRegistration,
  ) => Result<PermanentBlobReference>;
  call: TxCall;
  // actor·run만 있는 transaction은 이 gate가 있어도 현재 자격이 없어 cursor를 올리지 못한다.
  subscriberGate?: SubscriberGate;
  // transaction이 commit된 뒤, 그 tx가 domain event를 썼을 때 부른다. createCommitPublisher의
  // onCommit을 잇는다. writer Worker 경로는 openWriter의 세 번째 인자로 같은 것을 받는다.
  onCommit?: (success: CommandSuccess) => void;
  // true면 domain event 10개가 아닌 type의 emit을 거절한다. 기본 false인 것은 다른 단위 command가
  // 옛 event를 아직 emit하기 때문이다. 모두 merge된 뒤 cleanup이 wiring에서 켠다.
  domainOnly?: boolean;
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
    domainOnly: deps.domainOnly,
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
      // 이 tx가 쓴 event 범위. commit된 뒤에만 onCommit으로 알린다.
      let span: { first: bigint; last: bigint } | undefined;
      const result = runTransaction(
        connection,
        { actor: ctx.actor, run: ctx.run ?? null, request },
        txDeps,
        (tx) => {
          const before = headSeq(tx.sql);
          const handled = fn(tx);
          if (!handled.ok || !before.ok) return handled;
          const found = eventSpan(tx.sql, before.value);
          if (found.ok && found.value.first !== null) {
            span = { first: found.value.first, last: found.value.last! };
          }
          return handled;
        },
      );
      if (result.ok && span !== undefined) {
        deps.onCommit?.({
          result: result.value,
          replayed: false,
          first_seq: formatSeq(span.first),
          last_seq: formatSeq(span.last),
          wake: true,
        });
      }
      return result;
    },
    close() {
      connection.close();
    },
  };
}
export { defineSyncCommand } from "./handler.ts";
