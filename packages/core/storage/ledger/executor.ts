import {
  err,
  formatSeq,
  internalError,
  ok,
  type Result,
} from "../../../base/mod.ts";
import {
  type AuthenticatedContext,
  type CommandDefinition,
  commandsResult,
  type ConfirmationRef,
  confirmationRefSchema,
  idempotencyKeySchema,
  type RequestContext,
  type Sql,
  type Tx,
} from "../../../protocol/server/mod.ts";
import { authorizeConditions } from "../../server/identity/mod.ts";
import {
  confirmationBinding,
  type ConfirmationBridge,
  type ConfirmationUse,
} from "../../server/identity/mod.ts";
import {
  commandFingerprint,
  countCas,
  type FingerprintInput,
  withinCommandLimits,
} from "./fingerprint.ts";
import type {
  CommandEnvelope,
  CommandSuccess,
  StoredCommandResult,
} from "./writer-message.ts";
import { isStorageUnavailable, type LedgerConnection } from "./sqlite.ts";
import { createCommandDispatch } from "./dispatch.ts";
import { admitAgentRun, runDisposition } from "./commands.ts";
import { runTransaction, type TxDeps } from "./tx.ts";
import { authorizeSubscriberCursor } from "../../events/subscriber-registration.ts";
import {
  actorKind,
  authorityTarget,
  casAgrees,
  eventSpan,
  handlerResult,
  headSeq,
  loadStored,
  replay,
  seqText,
  storeCommandResult,
} from "./command-outcome.ts";

// transaction 안의 현재 자격 재검사. 자격 저장은 identity가 맡는다(R13).
export type CredentialCheck = (
  ctx: AuthenticatedContext,
) => Result<AuthenticatedContext>;

export type CommandExecutorDeps = TxDeps & {
  checkCredential: CredentialCheck;
  // 사람 결정 확인. 없으면 confirmation route는 쓸 수 없다(architecture/platform 5.6).
  confirmation?: ConfirmationBridge;
};

// envelope.run이 없으면 current credential의 묶인 run을 잃지 않는다(R3, R11).
function effectiveRun(
  ctx: AuthenticatedContext,
  envelopeRun: string | undefined,
): string | null {
  return envelopeRun ?? ctx.conditions.run ?? null;
}

function requestContext(
  ctx: AuthenticatedContext,
  run: string | null,
): RequestContext {
  return run === null ? ctx : { ...ctx, run };
}

// handler가 scope·conditions를 바꿔도 Tx owner gate는 이 snapshot을 본다.
function authoritySnapshot(ctx: RequestContext): Result<RequestContext> {
  try {
    return ok(structuredClone(ctx));
  } catch {
    return err({
      code: "unavailable",
      message: "subscriber 검사를 사용할 수 없다",
    });
  }
}

export async function digestOf(
  command: string,
  envelope: Omit<FingerprintInput, "command">,
): Promise<Result<string>> {
  try {
    return ok(await commandFingerprint({ ...envelope, command }));
  } catch {
    return err({ code: "invalid_input", message: "요청을 정규화할 수 없다" });
  }
}

// executor의 조회·저장은 handler Tx가 아닌 연결 SQL이다. Tx는 handler가 끝나면 닫는다(R4).
type Session = {
  record: Sql;
  tx: Tx;
  seal: () => void;
  now: () => string;
  checkCursor: (subscriber: string) => Result<void>;
  confirmation: ConfirmationBridge | undefined;
  // 이번 transaction이 예약한 handle. commit 성공만 소비한다.
  reserved: ConfirmationRef | undefined;
};

function applyCommand(
  session: Session,
  ctx: AuthenticatedContext,
  envelope: CommandEnvelope,
  definition: CommandDefinition,
  digest: string,
  input: unknown,
  compare: unknown,
): Result<CommandSuccess> {
  const { record, tx, seal, now, checkCursor } = session;
  if (
    envelope.run !== undefined &&
    ctx.conditions.run !== undefined &&
    envelope.run !== ctx.conditions.run
  ) {
    return err({ code: "forbidden", message: "run 조건이 다르다" });
  }
  const kind = actorKind(ctx.actor);
  if (kind === undefined || !definition.route.actors.includes(kind)) {
    return err({ code: "forbidden", message: "actor 종류가 command 밖이다" });
  }
  const allowed = authorizeConditions(
    ctx,
    definition.route.name,
    authorityTarget(ctx, envelope.run),
  );
  if (!allowed.ok) return allowed;
  const stored = loadStored(record, ctx.principal, envelope.idempotency_key);
  if (!stored.ok) return stored;
  if (stored.value !== undefined) {
    if (stored.value.fingerprint !== digest) {
      return err({ code: "conflict", message: "같은 key의 다른 요청이다" });
    }
    // 재전달은 저장된 결과를 돌려준다. 확인 창이 없어도 현재 자격 뒤 결과를 준다(R13).
    return replay(stored.value);
  }
  // 재전달은 여기까지 오지 않는다. 이미 소비한 handle로 새 변경을 시작하지 않는다(R13).
  const reserved = reserveConfirmation(session, envelope);
  if (!reserved.ok) return reserved;
  const cas = casAgrees(record, compare, input, checkCursor);
  if (!cas.ok) return cas;
  // agent의 command는 자격에 묶인 run만이다. 끝난 run은 감사 보완만 통과한다(R11).
  const admitted = admitAgentRun(
    tx,
    requestContext(ctx, effectiveRun(ctx, envelope.run)),
    runDisposition(definition),
  );
  if (!admitted.ok) return admitted;
  const before = headSeq(record);
  if (!before.ok) return before;
  let raw: unknown;
  try {
    raw = definition.handle(
      tx,
      requestContext(ctx, effectiveRun(ctx, envelope.run)),
      input,
      compare,
    );
  } finally {
    seal();
  }
  const handled = handlerResult(definition, raw);
  if (!handled.ok) return handled;
  const span = eventSpan(record, before.value);
  if (!span.ok) return span;
  // 안쪽 command는 결과를 저장하지 않는다. 바깥 command 하나만 남긴다(R13).
  storeCommandResult(record, {
    principal: ctx.principal,
    key: envelope.idempotency_key,
    digest,
    result: JSON.stringify(handled.value),
    first: span.value.first,
    last: span.value.last,
    at: now(),
  });
  return ok({
    result: handled.value,
    replayed: false,
    first_seq: seqText(span.value.first),
    last_seq: seqText(span.value.last),
    wake: span.value.first !== null,
  });
}

// handle은 transaction 안에서 현재 상태와 함께 예약한다. commit이 끝나면 소비하고,
// 실패면 살아 있는 handle의 예약만 푼다. 만료·종료 handle은 되살리지 않는다.
function reserveConfirmation(
  session: Session,
  envelope: CommandEnvelope,
): Result<void> {
  if (
    envelope.confirmation === undefined && envelope.decisionName === undefined
  ) {
    return ok(undefined);
  }
  const registry = session.confirmation;
  if (registry === undefined) {
    return err({
      code: "unavailable",
      message: "사람 결정 확인을 사용할 수 없다",
    });
  }
  const parsedRef = confirmationRefSchema.safeParse(envelope.confirmation);
  const decision = envelope.decisionName;
  const binding = envelope.decision;
  if (
    !parsedRef.success || decision === undefined || binding === undefined ||
    typeof binding.target !== "string" || typeof binding.content !== "string"
  ) {
    return err({ code: "forbidden", message: "사람 결정 확인이 없다" });
  }
  const ref = parsedRef.data;
  const use: ConfirmationUse = { ref, decision, binding };
  const reserved = registry.reserve(use);
  if (!reserved.ok) return reserved;
  session.reserved = ref;
  return ok(undefined);
}

// 이번 command가 낸 event만 본다. rollback으로 빈 번호가 있으면 before+1이 아니다.
export function commitCommand(
  connection: LedgerConnection,
  deps: CommandExecutorDeps,
  commands: ReadonlyMap<string, CommandDefinition>,
  definition: CommandDefinition,
  ctx: AuthenticatedContext,
  envelope: CommandEnvelope,
  digest: string,
  input: unknown,
  compare: unknown,
): Result<CommandSuccess> {
  // checkCredential은 BEGIN IMMEDIATE 뒤 한 번만 부른다. Tx와 handler는 같은 current를 본다(R3, R11).
  let current: AuthenticatedContext | undefined;
  let authority: RequestContext | undefined;
  let reserved: ConfirmationRef | undefined;
  let committed = false;
  try {
    const txDeps = { ...deps };
    const outcome = runTransaction(
      connection,
      () => {
        const credential = deps.checkCredential(ctx);
        if (!credential.ok) return credential;
        current = credential.value;
        const request = authoritySnapshot(
          requestContext(
            credential.value,
            effectiveRun(credential.value, envelope.run),
          ),
        );
        if (!request.ok) return request;
        authority = request.value;
        txDeps.dispatch = createCommandDispatch(
          commands,
          credential.value,
          effectiveRun(credential.value, envelope.run),
          request.value,
          (subscriber) =>
            authorizeSubscriberCursor(
              deps.subscriberGate,
              subscriber,
              request.value,
            ),
          definition.route.name,
        );
        return ok({
          actor: credential.value.actor,
          run: effectiveRun(credential.value, envelope.run),
          request: request.value,
        });
      },
      txDeps,
      (tx, seal) => {
        if (current === undefined || authority === undefined) {
          return err(internalError());
        }
        const session: Session = {
          record: connection.sql,
          tx,
          seal,
          now: () => deps.clock.now(),
          checkCursor: (subscriber) =>
            authorizeSubscriberCursor(
              deps.subscriberGate,
              subscriber,
              authority,
            ),
          confirmation: deps.confirmation,
          reserved: undefined,
        };
        const applied = applyCommand(
          session,
          current,
          envelope,
          definition,
          digest,
          input,
          compare,
        );
        reserved = session.reserved;
        return applied;
      },
    );
    // runTransaction은 commit이 끝난 뒤에야 ok를 돌려준다. 그 전에는 소비하지 않는다.
    committed = outcome.ok;
    return outcome;
  } catch (thrown) {
    // commit이 예외로 끝나면 살아 있는 handle의 예약만 푼다. 종료·만료 handle은 되살리지 않는다.
    if (reserved !== undefined) deps.confirmation?.release(reserved);
    if (isStorageUnavailable(thrown)) {
      return err({ code: "unavailable", message: "ledger에 기록할 수 없다" });
    }
    return err(internalError());
  } finally {
    if (committed && reserved !== undefined) {
      deps.confirmation?.consume(reserved);
    } else if (reserved !== undefined) deps.confirmation?.release(reserved);
  }
}

// fingerprint는 transaction 전에 계산한다. 자격 재검사는 BEGIN IMMEDIATE 다음이다(R13).
export async function executeCommand(
  connection: LedgerConnection,
  deps: CommandExecutorDeps,
  commands: ReadonlyMap<string, CommandDefinition>,
  ctx: AuthenticatedContext,
  envelope: CommandEnvelope,
): Promise<Result<CommandSuccess>> {
  // 권한 조립이 없으면 command 표보다 먼저 닫는다. 빈 표의 invalid_input으로 새지 않는다.
  if (commands.size === 0) {
    const credential = deps.checkCredential(ctx);
    if (!credential.ok) return credential;
  }
  const definition = commands.get(envelope.command);
  // dispatch 전용 command는 직접 호출에서 없는 command와 같은 답이다(존재·approval 상태를 새지 않는다).
  if (
    definition === undefined || definition.route.kind !== "command" ||
    definition.dispatchOnly === true
  ) {
    return err({ code: "invalid_input", message: "등록되지 않은 command다" });
  }
  if (!idempotencyKeySchema.safeParse(envelope.idempotency_key).success) {
    return err({
      code: "invalid_input",
      message: "idempotency key가 한도 밖이다",
    });
  }
  const parsedInput = definition.route.input.safeParse(envelope.input);
  if (!parsedInput.success) {
    return err({ code: "invalid_input", message: "input이 schema와 다르다" });
  }
  const compareSchema = definition.route.compare;
  const parsedCompare = compareSchema === undefined
    ? { success: true as const, data: envelope.compare }
    : compareSchema.safeParse(envelope.compare);
  if (!parsedCompare.success) {
    return err({ code: "invalid_input", message: "compare가 schema와 다르다" });
  }
  const limits = withinCommandLimits(countCas(parsedCompare.data));
  if (!limits.ok) return limits;
  const binding = definition.route.confirmation === "required"
    ? await confirmationBinding(definition.route, parsedInput.data)
    : undefined;
  if (definition.route.confirmation === "required" && binding === undefined) {
    return err({ code: "forbidden", message: "사람 결정 확인이 없다" });
  }
  const confirmed: CommandEnvelope = binding === undefined ? envelope : {
    ...envelope,
    decisionName: definition.route.name,
    decision: binding,
  };
  const digest = await digestOf(definition.route.name, {
    input: parsedInput.data,
    compare: parsedCompare.data,
    run: envelope.run ?? null,
    prepared: envelope.prepared,
    decision: binding ?? envelope.decision ?? null,
  });
  if (!digest.ok) return digest;
  return commitCommand(
    connection,
    deps,
    commands,
    definition,
    ctx,
    confirmed,
    digest.value,
    parsedInput.data,
    parsedCompare.data,
  );
}

// 제출 ctx를 그대로 믿지 않는다. BEGIN 없는 read도 current 자격·CommandResult scope·자기 principal만 본다(R13).
export function readOwnResult(
  connection: LedgerConnection,
  checkCredential: CredentialCheck,
  ctx: AuthenticatedContext,
  key: string,
): Result<StoredCommandResult | null> {
  if (connection.failed()) {
    return err({ code: "unavailable", message: "ledger를 읽을 수 없다" });
  }
  const credential = checkCredential(ctx);
  if (!credential.ok) return credential;
  const current = credential.value;
  const allowed = authorizeConditions(current, commandsResult.name);
  if (!allowed.ok) return allowed;
  let row: ReturnType<Sql["get"]>;
  try {
    row = connection.sql.get(
      `select fingerprint, result, first_seq, last_seq, at
       from command_results where principal = ? and idempotency_key = ?`,
      [current.principal, key],
    );
  } catch (thrown) {
    if (isStorageUnavailable(thrown)) {
      return err({ code: "unavailable", message: "ledger를 읽을 수 없다" });
    }
    return err(internalError());
  }
  if (row === undefined) return ok(null);
  if (
    typeof row["result"] !== "string" ||
    typeof row["fingerprint"] !== "string" || typeof row["at"] !== "string"
  ) {
    return err(internalError());
  }
  let result: unknown;
  try {
    result = JSON.parse(row["result"]);
  } catch {
    return err(internalError());
  }
  const first = row["first_seq"];
  const last = row["last_seq"];
  return ok({
    principal: current.principal,
    idempotency_key: key,
    fingerprint: row["fingerprint"],
    result,
    first_seq: typeof first === "bigint" ? formatSeq(first) : null,
    last_seq: typeof last === "bigint" ? formatSeq(last) : null,
    at: row["at"],
  });
}
