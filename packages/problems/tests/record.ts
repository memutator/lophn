import { err, ok, type Result } from "../../base/mod.ts";
import type {
  CommandDefinition,
  Input,
  RequestContext,
  Tx,
} from "../../contracts/platform/mod.ts";
import {
  recordVerification,
  verificationRecorded,
} from "../../contracts/problems/mod.ts";
import { registerVerificationBlobs, requiredBlobs } from "./blobs.ts";
import { judgeRecordable } from "./judge.ts";
import {
  canRecordVerification,
  connectionOf,
  type PreparedResultEvidence,
  sameConnection,
} from "./model.ts";
import { testEvidencePort } from "./ports.ts";
import {
  appendRecord,
  currentRunner,
  loadRecords,
  loadSideStarts,
} from "./records.ts";

const CONFLICT = "같은 요청의 내용이 다르다";
const NOT_FOUND = "기록을 찾을 수 없다";
const FORBIDDEN = "이 credential로는 할 수 없다";

function storedVerification(tx: Tx, principal: string, key: string) {
  return tx.sql.get(
    `select id, request_hash, result, reason, execution, observations, test
     from verifications
     where request_principal = ? and request_key = ?`,
    [principal, key],
  );
}

export function handleRecordVerification(
  tx: Tx,
  ctx: RequestContext,
  input: Input<typeof recordVerification>,
  evidence: PreparedResultEvidence | null,
): Result<{ verification: string; seq: string }> {
  const verification = input.verification;
  const records = loadRecords(
    tx.sql,
    verification.request_principal,
    verification.request_key,
  );
  const accepted = records.find((record) => record.phase === "accepted");
  if (!accepted) return err({ code: "not_found", message: NOT_FOUND });
  const runner = currentRunner(records);
  const allowed = canRecordVerification(ctx, {
    runner_principal: runner,
    app: verification.app,
    request_principal: verification.request_principal,
    request_key: verification.request_key,
    request_hash: verification.request_hash,
  });
  if (!allowed.ok) return allowed;
  if (
    verification.request_hash !== accepted.request_hash ||
    !sameConnection(
      { ...verification, before_bundle_hash: null },
      accepted.payload,
    )
  ) {
    return err({ code: "conflict", message: CONFLICT });
  }
  if (
    !evidence ||
    evidence.request_principal !== verification.request_principal ||
    evidence.request_key !== verification.request_key ||
    evidence.request_hash !== verification.request_hash ||
    evidence.runner_principal !== ctx.principal ||
    evidence.test !== verification.test ||
    evidence.execution !== verification.execution ||
    evidence.observations !== verification.observations
  ) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  const prior = storedVerification(
    tx,
    verification.request_principal,
    verification.request_key,
  );
  if (prior) {
    if (
      String(prior.id) !== verification.id ||
      String(prior.request_hash) !== verification.request_hash ||
      String(prior.result) !== verification.result ||
      String(prior.reason) !== verification.reason ||
      String(prior.execution) !== verification.execution ||
      String(prior.observations) !== verification.observations ||
      String(prior.test) !== verification.test
    ) {
      return err({ code: "conflict", message: CONFLICT });
    }
    const seq = tx.sql.get(
      `select recorded_seq from verifications where id = ?`,
      [verification.id],
    );
    return ok({
      verification: verification.id,
      seq: String(seq?.recorded_seq),
    });
  }
  const starts = loadSideStarts(
    tx.sql,
    verification.request_principal,
    verification.request_key,
    verification.request_hash,
  );
  const judged = judgeRecordable(verification, evidence, starts);
  if (!judged.ok) return judged;
  const other = tx.sql.get(`select id from verifications where id = ?`, [
    verification.id,
  ]);
  if (other) return err({ code: "conflict", message: CONFLICT });
  const required = requiredBlobs(verification, evidence);
  const eventSeq = tx.emit(
    verificationRecorded,
    verification.id,
    {
      kind: verification.kind,
      app: verification.app,
      target: verification.target,
      ...(verification.problem ? { problem: verification.problem } : {}),
      ...(verification.basis_seq ? { basis_seq: verification.basis_seq } : {}),
      ...(verification.ticket ? { ticket: verification.ticket } : {}),
      result: verification.result,
      test: verification.test,
      execution: verification.execution,
    },
  );
  const registered = registerVerificationBlobs(
    tx,
    ctx.principal,
    verification.id,
    input.blobs,
    required,
    eventSeq,
  );
  if (!registered.ok) return registered;
  const ticket = verification.ticket;
  tx.sql.run(
    `insert into verifications (
       id, request_principal, request_key, request_hash, kind, app,
       target_bundle_hash, target_release, problem, basis_seq,
       before_release, after_release, ticket, ticket_check_index,
       ticket_check_hash, ticket_completion_seq, test, execution, result,
       reason, observations, recorded_seq
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      verification.id,
      verification.request_principal,
      verification.request_key,
      verification.request_hash,
      verification.kind,
      verification.app,
      verification.target.bundle_hash,
      verification.target.release,
      verification.problem,
      verification.basis_seq,
      verification.before,
      verification.after,
      ticket?.ticket ?? null,
      ticket?.check_index ?? null,
      ticket?.check_hash ?? null,
      ticket?.completion_seq ?? null,
      verification.test,
      verification.execution,
      verification.result,
      verification.reason,
      verification.observations,
      eventSeq,
    ],
  );
  for (const report of verification.reports) {
    tx.sql.run(
      `insert into verification_reports (verification, report) values (?, ?)`,
      [verification.id, report],
    );
  }
  const linked = appendRecord(tx, {
    request_principal: verification.request_principal,
    request_key: verification.request_key,
    request_hash: verification.request_hash,
    phase: "result_ref",
    accepted: true,
    preparation_failed: false,
    at: tx.now(),
    start_unknown: false,
    result_ref: verification.id,
    runner_principal: ctx.principal,
    reason: verification.reason,
    payload: connectionOf({ ...verification, before_bundle_hash: null }),
  });
  if (!linked.ok) return linked;
  return ok({ verification: verification.id, seq: eventSeq });
}

export const recordVerificationCommand: CommandDefinition<
  typeof recordVerification
> = {
  route: recordVerification,
  handle(tx, ctx, input) {
    return handleRecordVerification(
      tx,
      ctx,
      input,
      tx.port(testEvidencePort)(input),
    );
  },
};
