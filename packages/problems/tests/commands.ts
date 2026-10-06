import { err, ok, type Result } from "../../base/mod.ts";
import type {
  CommandDefinition,
  Input,
  RequestContext,
  Tx,
} from "../../contracts/platform/mod.ts";
import { TargetAuthorization } from "../../contracts/platform/mod.ts";
import { requestTest } from "../../contracts/problems/mod.ts";
import {
  connectionOf,
  type PreparedAdmission,
  type RequestPhase,
  sameConnection,
  type SideStart,
} from "./model.ts";
import { expectedBundle } from "./judge.ts";
import { testAdmissionPort } from "./ports.ts";
import {
  atOk,
  checkLifecycleProof,
  checkPreparedAdmission,
  checkRequestAuthority,
  hashOk,
  type LifecycleProof,
  sideAllowed,
  terminal,
} from "./proof.ts";
import {
  appendRecord,
  appendSideStart,
  currentRunner,
  loadRecords,
  loadSideStarts,
} from "./records.ts";

const CONFLICT = "같은 요청의 내용이 다르다";
const NOT_FOUND = "기록을 찾을 수 없다";
const FORBIDDEN = "이 credential로는 할 수 없다";

export function handleRequestTest(
  tx: Tx,
  ctx: RequestContext,
  input: Input<typeof requestTest>,
  admission: () => PreparedAdmission | null,
): Result<
  { request_key: string; accepted: boolean; result_ref: string | null }
> {
  const allowed = checkRequestAuthority(ctx, input);
  if (!allowed.ok) return allowed;
  const existing = loadRecords(tx.sql, ctx.principal, input.request_key);
  const prior = existing.find((record) => record.phase === "accepted") ??
    existing[0];
  if (prior) {
    if (
      !sameConnection(prior.payload, { ...input, before_bundle_hash: null }) ||
      (prior.payload.request_timeout_ms ?? null) !==
        (input.timeout_ms ?? null) ||
      prior.request_principal !== ctx.principal
    ) {
      return err({ code: "conflict", message: CONFLICT });
    }
    const result = [...existing].reverse().find((record) => record.result_ref);
    return ok({
      request_key: input.request_key,
      accepted: existing.some((record) => record.accepted) &&
        !existing.some((record) => record.preparation_failed),
      result_ref: result?.result_ref ?? null,
    });
  }
  const checked = checkPreparedAdmission(ctx, input, admission());
  if (!checked.ok) return checked;
  const appended = appendRecord(tx, {
    request_principal: ctx.principal,
    request_key: input.request_key,
    request_hash: checked.value.request_hash,
    phase: "accepted",
    accepted: true,
    preparation_failed: false,
    at: tx.now(),
    start_unknown: false,
    result_ref: null,
    runner_principal: checked.value.runner_principal,
    reason: "accepted",
    payload: {
      ...connectionOf({ ...input, before_bundle_hash: null }),
      before_bundle_hash: checked.value.before_bundle_hash,
      ...(input.timeout_ms === undefined
        ? {}
        : { request_timeout_ms: input.timeout_ms }),
    },
  });
  if (!appended.ok) return appended;
  return ok({
    request_key: input.request_key,
    accepted: true,
    result_ref: null,
  });
}

export type ObservationInput = {
  phase: Exclude<RequestPhase, "accepted" | "result_ref" | "actual_started">;
  request_principal: string;
  request_key: string;
  request_hash: string;
  at: string | null;
  previous_runner: string | null;
  runner_principal: string | null;
  reason: string;
};

// public route가 없다. lifecycle proof가 현재 machine과 요청을 묶는다.
export function appendRequestObservation(
  tx: Tx,
  ctx: RequestContext,
  observation: ObservationInput,
  proof: LifecycleProof | null,
): Result<bigint> {
  const existing = loadRecords(
    tx.sql,
    observation.request_principal,
    observation.request_key,
  );
  const accepted = existing.find((record) => record.phase === "accepted");
  if (!accepted) return err({ code: "not_found", message: NOT_FOUND });
  const runner = currentRunner(existing);
  const recovery = observation.phase === "recovery";
  const same = existing.find((record) =>
    record.phase === observation.phase &&
    record.reason === observation.reason &&
    record.at ===
      (observation.phase === "start_attempt" || recovery
        ? observation.at
        : null) &&
    record.runner_principal === ctx.principal &&
    (record.previous_runner ?? null) === observation.previous_runner
  );
  const proved = checkLifecycleProof(ctx, proof, {
    phase: observation.phase,
    request_principal: observation.request_principal,
    request_key: observation.request_key,
    request_hash: observation.request_hash,
    app: accepted.payload.app,
    current_runner: recovery && same && runner === ctx.principal
      ? same.previous_runner ?? ""
      : runner,
  }, tx.port(TargetAuthorization));
  if (!proved.ok) return proved;
  if (observation.request_hash !== accepted.request_hash) {
    return err({ code: "conflict", message: CONFLICT });
  }
  if (
    observation.runner_principal !== ctx.principal ||
    (!recovery && observation.previous_runner !== null)
  ) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  if (same && (!recovery || runner === ctx.principal)) return ok(same.seq);
  if (terminal(existing)) return err({ code: "conflict", message: CONFLICT });
  if (
    observation.phase === "preparation_failed" &&
    loadSideStarts(
        tx.sql,
        observation.request_principal,
        observation.request_key,
        accepted.request_hash,
      ).length > 0
  ) {
    return err({ code: "conflict", message: CONFLICT });
  }
  if (recovery) {
    if (
      observation.previous_runner !== runner || ctx.principal === runner ||
      observation.reason.trim() === "" || !observation.at ||
      !atOk(observation.at)
    ) {
      return err({ code: "conflict", message: CONFLICT });
    }
  } else if (
    observation.phase === "start_attempt" &&
    (!observation.at || !atOk(observation.at))
  ) {
    return err({
      code: "invalid_input",
      message: "테스트 요청이 올바르지 않다",
    });
  }
  if (
    existing.some((record) =>
      record.phase === "recovery" || record.phase === "start_unknown"
    ) &&
    observation.phase === "start_attempt"
  ) {
    return err({ code: "conflict", message: CONFLICT });
  }
  return appendRecord(tx, {
    request_principal: observation.request_principal,
    request_key: observation.request_key,
    request_hash: accepted.request_hash,
    phase: observation.phase,
    accepted: true,
    preparation_failed: observation.phase === "preparation_failed",
    at:
      observation.phase === "start_attempt" || observation.phase === "recovery"
        ? observation.at
        : null,
    start_unknown: observation.phase === "start_unknown",
    result_ref: null,
    runner_principal: ctx.principal,
    previous_runner: observation.previous_runner,
    reason: observation.reason,
    payload: accepted.payload,
  });
}

export type SideStartInput = SideStart & {
  request_principal: string;
  request_key: string;
  request_hash: string;
};

// side 시작은 요청 phase가 아니다. 현재 runner binding과 접수 hash에 묶는다.
export function appendActualSideStart(
  tx: Tx,
  ctx: RequestContext,
  start: SideStartInput,
  proof: LifecycleProof | null,
): Result<bigint> {
  const existing = loadRecords(
    tx.sql,
    start.request_principal,
    start.request_key,
  );
  const accepted = existing.find((record) => record.phase === "accepted");
  if (!accepted) return err({ code: "not_found", message: NOT_FOUND });
  const runner = currentRunner(existing);
  const proved = checkLifecycleProof(
    ctx,
    proof,
    {
      phase: "start_attempt",
      request_principal: start.request_principal,
      request_key: start.request_key,
      request_hash: start.request_hash,
      app: accepted.payload.app,
      current_runner: runner,
    },
    tx.port(TargetAuthorization),
  );
  if (!proved.ok) return proved;
  if (ctx.actor !== "machine" || ctx.principal !== runner) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  if (start.request_hash !== accepted.request_hash) {
    return err({ code: "conflict", message: CONFLICT });
  }
  const priorSide = tx.sql.get(
    `select * from test_side_starts where request_principal = ? and request_key = ? and request_hash = ? and side = ?`,
    [
      start.request_principal,
      start.request_key,
      start.request_hash,
      start.side,
    ],
  );
  if (priorSide) {
    if (
      priorSide.bundle_hash !== start.bundle_hash ||
      priorSide.test_hash !== start.test_hash ||
      priorSide.started_at !== start.started_at
    ) return err({ code: "conflict", message: CONFLICT });
    return ok(BigInt(String(priorSide.seq)));
  }
  if (
    terminal(existing) ||
    existing.some((record) =>
      record.phase === "recovery" || record.phase === "start_unknown"
    ) ||
    !existing.some((record) =>
      record.phase === "start_attempt" && record.runner_principal === runner
    )
  ) {
    return err({ code: "conflict", message: CONFLICT });
  }
  if (
    !sideAllowed(accepted.payload, start.side) || !atOk(start.started_at) ||
    !hashOk(start.test_hash) || !hashOk(start.bundle_hash)
  ) {
    return err({
      code: "invalid_input",
      message: "테스트 요청이 올바르지 않다",
    });
  }
  const bundle = expectedBundle(
    accepted.payload,
    start.side,
    accepted.payload.before_bundle_hash,
  );
  if (!bundle.ok) return bundle;
  if (
    start.bundle_hash !== bundle.value ||
    start.test_hash !== accepted.payload.test
  ) {
    return err({ code: "conflict", message: CONFLICT });
  }
  const stored = appendSideStart(tx, {
    request_principal: start.request_principal,
    request_key: start.request_key,
    request_hash: accepted.request_hash,
    runner_principal: runner,
    side: start.side,
    bundle_hash: start.bundle_hash,
    test_hash: start.test_hash,
    started_at: start.started_at,
  });
  if (!stored.ok) return stored;
  const summary = appendRecord(tx, {
    request_principal: start.request_principal,
    request_key: start.request_key,
    request_hash: accepted.request_hash,
    phase: "actual_started",
    accepted: true,
    preparation_failed: false,
    at: start.started_at,
    start_unknown: false,
    result_ref: null,
    runner_principal: runner,
    reason: "started",
    payload: accepted.payload,
  });
  return summary.ok ? stored : summary;
}

export const requestTestCommand: CommandDefinition<typeof requestTest> = {
  route: requestTest,
  handle(tx, ctx, input) {
    return handleRequestTest(
      tx,
      ctx,
      input,
      () => tx.port(testAdmissionPort)(ctx, input),
    );
  },
};
