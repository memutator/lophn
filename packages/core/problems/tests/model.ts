import { canonicalJson } from "./canonical.ts";
import { err, ok, type Result } from "../../../base/mod.ts";
import type { LophnError } from "../../../base/mod.ts";
import type {
  CredentialScope,
  RequestContext,
  TargetAuthorizer,
} from "../../../protocol/server/mod.ts";
import {
  type ExecutionEvidence,
  type FrozenTest,
  requestTestInputSchema,
  type TestRequest,
  type Verification,
  verificationInputSchema,
} from "../../../protocol/problems/mod.ts";

// platform writer는 scope.operations에 route.name을 넣는다. 동의어를 만들지 않는다.
const RECORD_VERIFICATION = "RecordVerification";
const READ_TEST_REQUEST = "GetTestRequest";
const READ_VERIFICATION = "GetVerification";
const LIST_VERIFICATIONS = "ListVerifications";
const READ_BLOB_DETAIL = "blob.read";

// 상시 test runner가 요청에 묶이는 machine 주체다. 접수 때 요청 기록에 runner로 적힌다. runner 프로세스가
// 바뀌어 이미 시작한 요청을 이어받을 때(recovery)는 다른 주체가 필요하므로 복구 runner의 주체를 따로 둔다.
export const TEST_RUNNER_PRINCIPAL = "problems-test-runner";
export const TEST_RECOVERY_PRINCIPAL = "problems-test-recovery";
// runner의 요청별 machine credential이 갖는 operation. owner-local lifecycle과 결과 쓰기는 서로 독립이다.
export const OBSERVE_TEST_REQUEST = "observe_test_request";
export const RECOVER_TEST_REQUEST = "recover_test_request";

// 한 페이지. 계약 input에 limit가 없으므로 조용히 field를 만들지 않는다.
export const VERIFICATION_PAGE_CAP = 50;

const REQUEST_PHASES = [
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
  // 접수한 요청의 실행 기한이다. 요청 identity가 아니라 runner에 넘길 값만이다.
  request_timeout_ms?: number;
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
  previous_runner?: string | null;
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
  observations_json: unknown;
  frozen: FrozenTest;
  execution_evidence: ExecutionEvidence[];
  actually_started: boolean;
  evidence_sufficient: boolean;
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
  };
}

export function canonicalRequest(input: TestConnection): Result<string> {
  try {
    canonicalJson(input);
  } catch {
    return err({ code: "invalid_input", message: INVALID });
  }
  if (new Set(input.reports).size !== input.reports.length) {
    return err({ code: "invalid_input", message: INVALID });
  }
  const parsed = requestTestInputSchema.safeParse({
    request_key: "k",
    ...connectionOf(input),
  });
  if (!parsed.success) return err({ code: "invalid_input", message: INVALID });
  try {
    return ok(canonicalJson(connectionOf(parsed.data)));
  } catch {
    return err({ code: "invalid_input", message: INVALID });
  }
}

export function sameConnection(
  left: TestConnection,
  right: TestConnection,
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

type TestAuthority = {
  runner_principal: string;
  app: string;
  request_principal: string;
  request_key: string;
  request_hash: string;
};

export function canRecordVerification(
  ctx: RequestContext,
  admission: TestAuthority,
  authorize: TargetAuthorizer,
): Result<true> {
  return checkTestAuthority(ctx, admission, RECORD_VERIFICATION, authorize);
}

// actor 종류나 body 주장, conditions.task만으로는 열지 않는다.
// owner-local lifecycle과 결과 쓰기는 서로 독립된 operation이다.
// domain target은 TargetAuthorization port가 scope.targets 전체와 맞춘다.
// app은 owner target에도 넣는다. ctx conditions에 app이 있으면 port가 그 값으로 덮어
// 판정하고, 없으면 admission의 app으로 scope와 맞춘다.
// port는 scope에 없는 key를 요구하지 않는다. 빠진 domain key는 owner가 닫는다.
const DOMAIN_TARGET_KEYS = [
  "app",
  "request_principal",
  "request_key",
  "request_hash",
] as const;

export function checkTestAuthority(
  ctx: RequestContext,
  admission: TestAuthority,
  operation: string,
  authorize: TargetAuthorizer,
): Result<true> {
  if (ctx.actor !== "machine") {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  if (ctx.principal !== admission.runner_principal) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  if (!hasOperation(ctx.scope, operation)) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  // machine credential은 발급 때 task 조건과 같은 `task` target을 반드시 갖는다(platform/identity).
  // 그 target은 고정 조건이라 owner 판정을 넓히지 않는다. 그 밖의 key는 domain 4개뿐이다.
  const task = ctx.scope.targets.task;
  if (
    DOMAIN_TARGET_KEYS.some((key) =>
      !targetMatches(ctx.scope, key, admission[key])
    ) ||
    Object.keys(ctx.scope.targets).some((key) =>
      key !== "task" && !DOMAIN_TARGET_KEYS.includes(key as never)
    ) ||
    (task !== undefined && task !== ctx.conditions.task)
  ) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  const allowed = authorize(ctx, operation, {
    app: admission.app,
    request_principal: admission.request_principal,
    request_key: admission.request_key,
    request_hash: admission.request_hash,
  });
  if (!allowed.ok) return err({ code: "forbidden", message: FORBIDDEN });
  return ok(true);
}

export function canReadOwnRequest(ctx: RequestContext): Result<true> {
  if (!hasOperation(ctx.scope, READ_TEST_REQUEST)) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  return ok(true);
}

// 단건 read는 scope 밖 행을 먼저 not_found로 숨긴 뒤(reads.ts verificationScope),
// 행의 사실 전체를 target으로 port에 넘긴다. 좁힌 scope도 자기 행은 읽는다.
export function canReadVerification(
  ctx: RequestContext,
  facts: Record<string, string | null> & { app: string },
  authorize: TargetAuthorizer,
): Result<{ detail: boolean }> {
  if (!hasOperation(ctx.scope, READ_VERIFICATION)) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  if (!targetMatches(ctx.scope, "app", facts.app)) {
    return err({ code: "forbidden", message: FORBIDDEN });
  }
  const allowed = authorize(ctx, READ_VERIFICATION, facts);
  if (!allowed.ok) return err({ code: "forbidden", message: FORBIDDEN });
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

export function parseVerification(value: unknown): Result<Verification> {
  const parsed = verificationInputSchema.safeParse(value);
  if (!parsed.success) return err({ code: "invalid_input", message: INVALID });
  return ok(parsed.data);
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

export type { LophnError };
