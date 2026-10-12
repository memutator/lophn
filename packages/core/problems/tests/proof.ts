import { hashCanonical } from "./canonical.ts";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { RequestContext } from "../../../protocol/server/mod.ts";
import type { TargetAuthorizer } from "../../../protocol/server/mod.ts";
import { atSchema, sha256Schema } from "../../../protocol/server/mod.ts";
import type { Input } from "../../../protocol/server/mod.ts";
import type { requestTest } from "../../../protocol/problems/mod.ts";
import {
  canonicalRequest,
  checkTestAuthority,
  type PreparedAdmission,
  type RequestPhase,
  type TestConnection,
} from "./model.ts";

const FORBIDDEN = "이 credential로는 할 수 없다";
const CONFLICT = "같은 요청의 내용이 다르다";

const HASH = /^[0-9a-f]{64}$/;

export function hashOk(value: string): boolean {
  return HASH.test(value);
}

export function atOk(value: string): boolean {
  return atSchema.safeParse(value).success;
}

export type LifecycleProof = {
  machine_principal: string;
  phase: Exclude<RequestPhase, "accepted" | "result_ref" | "actual_started">;
  request_principal: string;
  request_key: string;
  request_hash: string;
  app: string;
  current_runner: string;
  next_runner: string | null;
  operation: "observe_test_request" | "recover_test_request";
};

export function checkLifecycleProof(
  ctx: RequestContext,
  proof: LifecycleProof | null,
  expected: {
    phase: LifecycleProof["phase"];
    request_principal: string;
    request_key: string;
    request_hash: string;
    app: string;
    current_runner: string;
  },
  authorize: TargetAuthorizer,
): Result<true> {
  const operation = expected.phase === "recovery"
    ? "recover_test_request"
    : "observe_test_request";
  const allowed = checkTestAuthority(
    ctx,
    {
      ...expected,
      runner_principal: expected.phase === "recovery"
        ? ctx.principal
        : expected.current_runner,
    },
    operation,
    authorize,
  );
  if (!allowed.ok) return allowed;
  if (!proof) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  if (
    proof.operation !== operation ||
    proof.machine_principal !== ctx.principal ||
    proof.phase !== expected.phase ||
    proof.request_principal !== expected.request_principal ||
    proof.request_key !== expected.request_key ||
    proof.request_hash !== expected.request_hash ||
    proof.app !== expected.app ||
    proof.current_runner !== expected.current_runner ||
    (expected.phase === "recovery"
      ? proof.next_runner !== ctx.principal
      : proof.next_runner !== null)
  ) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  return ok(true);
}

export function checkRequestAuthority(
  ctx: RequestContext,
  input: Input<typeof requestTest>,
): Result<true> {
  if (!ctx.scope.operations.includes("RequestTest")) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  if (JSON.stringify(ctx.scope.targets.app) !== JSON.stringify(input.app)) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  const extra = Object.keys(ctx.scope.targets).filter((key) => key !== "app");
  if (extra.length > 0) return err({ code: "forbidden", message: FORBIDDEN });
  if (
    ctx.actor !== "user" && ctx.actor !== "machine" &&
    !ctx.actor.startsWith("coding_agent:")
  ) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  return ok(true);
}

export function checkPreparedAdmission(
  ctx: RequestContext,
  input: Input<typeof requestTest>,
  prepared: PreparedAdmission | null,
): Result<PreparedAdmission & { canonical_input: string }> {
  const canonical = canonicalRequest({ ...input, before_bundle_hash: null });
  if (!canonical.ok) return canonical;
  if (!prepared) return err({ code: "forbidden", message: FORBIDDEN });
  if (prepared.claim_rejected !== undefined) {
    return err({
      code: "conflict",
      message: `ticket claim이 현재가 아니다: ${prepared.claim_rejected}`,
    });
  }
  if (prepared.unavailable) {
    return err({ code: "unavailable", message: "테스트 준비를 할 수 없다" });
  }
  if (!prepared.app_in_scope || !prepared.refs_ok) {
    return err({ code: "not_found", message: "기록을 찾을 수 없다" });
  }
  if (
    prepared.request_principal !== ctx.principal ||
    prepared.request_key !== input.request_key ||
    prepared.app !== input.app ||
    prepared.canonical !== canonical.value ||
    prepared.request_hash !== hashCanonical(canonical.value) ||
    !sha256Schema.safeParse(prepared.request_hash).success ||
    prepared.runner_principal.trim() === ""
  ) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  if (input.kind === "reproduction") {
    if (
      !hashOk(prepared.before_bundle_hash ?? "") ||
      prepared.before_target?.release !== input.before ||
      prepared.before_target?.bundle_hash !== prepared.before_bundle_hash
    ) {
      return err({ code: "forbidden", message: FORBIDDEN });
    }
  } else if (
    prepared.before_bundle_hash !== null || prepared.before_target !== null
  ) {
    return err({ code: "conflict", message: CONFLICT });
  }
  return ok({ ...prepared, canonical_input: canonical.value });
}

export function sideAllowed(
  connection: TestConnection,
  side: string,
): boolean {
  if (connection.kind === "reproduction") {
    return side === "before" || side === "after";
  }
  return side === "single";
}

export function terminal(records: { phase: RequestPhase }[]): boolean {
  return records.some((record) =>
    record.phase === "result_ref" || record.phase === "preparation_failed"
  );
}
