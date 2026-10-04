import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import type { LophnError } from "../../base/mod.ts";
import type {
  AuthenticatedContext,
  CredentialScope,
  RequestContext,
} from "../../contracts/platform/mod.ts";
import {
  type ExecutionEvidence,
  type FrozenTest,
  requestTestInputSchema,
  TEST_EXECUTION_LIMITS,
  type TestRequest,
  type Verification,
  verificationInputSchema,
} from "../../contracts/problems/mod.ts";

// platform writer는 scope.operations에 route.name을 넣는다. 동의어를 만들지 않는다.
export const RECORD_VERIFICATION = "RecordVerification";
export const READ_TEST_REQUEST = "GetTestRequest";
export const READ_VERIFICATION = "GetVerification";
export const LIST_VERIFICATIONS = "ListVerifications";
export const READ_BLOB_DETAIL = "blob.read";

// 한 페이지. 계약 input에 limit가 없으므로 조용히 field를 만들지 않는다.
export const VERIFICATION_PAGE_CAP = 50;

export const REQUEST_PHASES = [
  "accepted",
  "preparation_failed",
  "start_attempt",
  "actual_started",
  "start_unknown",
  "recovery",
  "result_ref",
] as const;
export type RequestPhase = (typeof REQUEST_PHASES)[number];

const INVALID = "테스트 요청이 올바르지 않다";
const FORBIDDEN = "이 credential로는 할 수 없다";
const NOT_FOUND = "기록을 찾을 수 없다";
export type TestConnection = {
  kind: Verification["kind"];
  app: string;
  target: Verification["target"];
  problem: string | null;
  basis_seq: string | null;
  reports: string[];
  before: string | null;
  after: string | null;
  ticket: Verification["ticket"];
  test: string;
  before_bundle_hash: string | null;
};

export type RequestRecord = {
  seq: bigint;
  request_principal: string;
  request_key: string;
  request_hash: string;
  phase: RequestPhase;
  accepted: boolean;
  preparation_failed: boolean;
  at: string | null;
  start_unknown: boolean;
  result_ref: string | null;
  runner_principal: string | null;
  reason: string;
  payload: TestConnection;
};

// entry가 command 밖에서 확정한 준비 결과. handler는 이 값만 동기 검사한다.
export type PreparedAdmission = {
  request_principal: string;
  request_key: string;
  app: string;
  request_hash: string;
  canonical: string;
  runner_principal: string;
  before_bundle_hash: string | null;
  app_in_scope: boolean;
  refs_ok: boolean;
  unavailable: boolean;
};

export type SideStart = {
  side: ExecutionEvidence["side"];
  started_at: string;
  test_hash: string;
  bundle_hash: string;
};

// 저장된 side 시작. 요청 phase가 아니라 이 행이 실행 사실이다.
export type StoredSideStart = SideStart & {
  request_principal: string;
  request_key: string;
  request_hash: string;
  runner_principal: string;
};

export type PreparedResultEvidence = {
  request_principal: string;
  request_key: string;
  request_hash: string;
  runner_principal: string;
  verification_canonical: string;
  test: string;
  execution: string;
  observations: string;
  frozen: FrozenTest;
  execution_evidence: ExecutionEvidence[];
  actually_started: boolean;
  evidence_sufficient: boolean;
  unstarted_side: "before" | "after" | null;
  unstarted_reason: string | null;
};

export function connectionOf(
  input: TestConnection,
): TestConnection {
  return {
    kind: input.kind,
    app: input.app,
    target: { ...input.target },
    problem: input.problem,
    basis_seq: input.basis_seq,
    reports: [...input.reports],
    before: input.before,
    after: input.after,
    ticket: input.ticket ? { ...input.ticket } : null,
    test: input.test,
    before_bundle_hash: input.before_bundle_hash ?? null,
  };
}

export function canonicalRequest(
  input: Omit<TestConnection, "before_bundle_hash"> & {
    before_bundle_hash?: string | null;
  },
): Result<string> {
  const { before_bundle_hash: _before, ...publicConnection } = connectionOf({
    ...input,
    before_bundle_hash: input.before_bundle_hash ?? null,
  });
  const parsed = requestTestInputSchema.safeParse({
    request_key: "k",
    ...publicConnection,
  });
  if (!parsed.success) return err({ code: "invalid_input", message: INVALID });
  try {
    return ok(canonicalize(connectionOf({
      ...parsed.data,
      before_bundle_hash: null,
    })));
  } catch {
    return err({ code: "invalid_input", message: INVALID });
  }
}

export function sameConnection(
  left: Parameters<typeof canonicalRequest>[0],
  right: Parameters<typeof canonicalRequest>[0],
): boolean {
  const a = canonicalRequest(left);
  const b = canonicalRequest(right);
  return a.ok && b.ok && a.value === b.value;
}

function hasOperation(scope: CredentialScope, operation: string): boolean {
  return scope.operations.includes(operation);
}

function targetMatches(
  scope: CredentialScope,
  key: string,
  expected: unknown,
): boolean {
  return scope.targets[key] !== undefined &&
    JSON.stringify(scope.targets[key]) === JSON.stringify(expected);
}

// actor 종류나 body 주장, conditions.task만으로는 열지 않는다.
export function canRecordVerification(
  ctx: RequestContext,
  admission: {
    runner_principal: string;
    app: string;
    request_principal: string;
    request_key: string;
    request_hash: string;
  },
): Result<true> {
  if (ctx.actor !== "machine") {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  if (ctx.principal !== admission.runner_principal) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  if (!hasOperation(ctx.scope, RECORD_VERIFICATION)) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  if (
    !targetMatches(ctx.scope, "app", admission.app) ||
    !targetMatches(
      ctx.scope,
      "request_principal",
      admission.request_principal,
    ) ||
    !targetMatches(ctx.scope, "request_key", admission.request_key) ||
    !targetMatches(ctx.scope, "request_hash", admission.request_hash)
  ) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  return ok(true);
}

export function canReadOwnRequest(ctx: RequestContext): Result<true> {
  if (!hasOperation(ctx.scope, READ_TEST_REQUEST)) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  return ok(true);
}

export function canReadVerification(
  ctx: RequestContext,
  app: string,
): Result<{ detail: boolean }> {
  if (!hasOperation(ctx.scope, READ_VERIFICATION)) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  if (!targetMatches(ctx.scope, "app", app)) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  return ok({ detail: hasOperation(ctx.scope, READ_BLOB_DETAIL) });
}

export function canListVerifications(
  ctx: RequestContext,
  app: string,
): Result<true> {
  if (!hasOperation(ctx.scope, LIST_VERIFICATIONS)) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  if (!targetMatches(ctx.scope, "app", app)) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  return ok(true);
}

export function scopeCovers(
  scope: CredentialScope,
  facts: Record<string, unknown>,
): boolean {
  for (const [key, expected] of Object.entries(scope.targets)) {
    if (facts[key] === undefined) return false;
    if (JSON.stringify(facts[key]) !== JSON.stringify(expected)) return false;
  }
  return targetMatches(scope, "app", facts.app);
}

export function checkAdmission(
  input: TestConnection,
  prepared: PreparedAdmission | null,
): Result<{ request_hash: string; runner_principal: string }> {
  const canonical = canonicalRequest(input);
  if (!canonical.ok) return canonical;
  if (!prepared) return err({ code: "forbidden", message: FORBIDDEN });
  if (prepared.unavailable) {
    return err({ code: "unavailable", message: "테스트 준비를 할 수 없다" });
  }
  if (!prepared.app_in_scope || !prepared.refs_ok) {
    return err({ code: "not_found", message: NOT_FOUND });
  }
  if (
    prepared.canonical !== canonical.value ||
    prepared.request_hash.length !== 64
  ) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  if (!prepared.runner_principal) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  return ok({
    request_hash: prepared.request_hash,
    runner_principal: prepared.runner_principal,
  });
}

export function parseVerification(value: unknown): Result<Verification> {
  const parsed = verificationInputSchema.safeParse(value);
  if (!parsed.success) return err({ code: "invalid_input", message: INVALID });
  return ok(parsed.data);
}

export function timeoutBounds(): { min: number; max: number } {
  return { min: 1, max: TEST_EXECUTION_LIMITS.timeout_ms };
}

export function projectRequest(
  records: readonly RequestRecord[],
): TestRequest | null {
  if (records.length === 0) return null;
  const accepted = records.find((record) => record.phase === "accepted");
  const failed = records.some((record) =>
    record.phase === "preparation_failed"
  );
  const attempt = records.find((record) => record.phase === "start_attempt");
  const actuals = records.filter((record) => record.phase === "actual_started");
  const actual =
    [...actuals].sort((left, right) =>
      String(left.at).localeCompare(String(right.at))
    )[0];
  const unknown = records.some((record) => record.phase === "start_unknown");
  const result = [...records].reverse().find((record) =>
    record.phase === "result_ref"
  );
  const latest = records[records.length - 1];
  return {
    request_key: latest.request_key,
    accepted: Boolean(accepted) && !failed,
    preparation_failed: failed,
    start_attempted_at: attempt?.at ?? null,
    started_at: actual?.at ?? null,
    start_unknown: unknown && !actual,
    result_ref: result?.result_ref ?? null,
    reason: latest.reason,
  };
}

export function visibilityAllows(
  ctx: AuthenticatedContext,
  subjectApp: string,
  referenced: { app: string; problem?: string; ticket?: string },
): Result<boolean> {
  if (!hasOperation(ctx.scope, READ_VERIFICATION)) return ok(false);
  if (!targetMatches(ctx.scope, "app", subjectApp)) return ok(false);
  if (referenced.app !== subjectApp) return ok(false);
  if (
    referenced.problem &&
    ctx.scope.targets.problem !== undefined &&
    !targetMatches(ctx.scope, "problem", referenced.problem)
  ) {
    return ok(false);
  }
  if (
    referenced.ticket &&
    ctx.scope.targets.ticket !== undefined &&
    !targetMatches(ctx.scope, "ticket", referenced.ticket)
  ) {
    return ok(false);
  }
  return ok(true);
}

export type { LophnError };
