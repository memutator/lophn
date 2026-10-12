import { err, ok, parseSeq, type Result } from "../../../base/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../../protocol/platform/mod.ts";
import { TargetAuthorization } from "../../../protocol/platform/mod.ts";
import {
  getTestRequest,
  getVerification,
  listVerifications,
  type TestRequest,
  type Verification,
  verificationRecorded,
  verificationSchema,
} from "../../../protocol/problems/mod.ts";
import type { EventVisibilityDefinition } from "../../../protocol/platform/mod.ts";
import {
  canListVerifications,
  canReadOwnRequest,
  canReadVerification,
  projectRequest,
  scopeCovers,
  VERIFICATION_PAGE_CAP,
} from "./model.ts";
import { loadRecords } from "./records.ts";
import { canonicalJson } from "./canonical.ts";

const NOT_FOUND = "기록을 찾을 수 없다";

function verificationScope(
  ctx: Pick<RequestContext, "scope">,
  row: Record<string, unknown>,
): boolean {
  return Object.keys(ctx.scope.targets).every((key) =>
    [
      "app",
      "request_principal",
      "request_key",
      "request_hash",
      "problem",
      "ticket",
    ].includes(key)
  ) && scopeCovers(ctx.scope, row);
}

const ROW_TARGET_KEYS = [
  "request_principal",
  "request_key",
  "request_hash",
  "problem",
  "ticket",
] as const;

function rowFacts(
  row: Record<string, unknown>,
): Record<string, string | null> & { app: string } {
  const facts: Record<string, string | null> & { app: string } = {
    app: String(row.app),
  };
  for (const key of ROW_TARGET_KEYS) {
    facts[key] = row[key] === null || row[key] === undefined
      ? null
      : String(row[key]);
  }
  return facts;
}

// operation과 app이 맞지 않으면 행의 domain 범위를 보기 전에 forbidden이다.
function hasReadOperation(ctx: RequestContext): boolean {
  return ctx.scope.operations.includes("GetVerification");
}

function sameApp(
  ctx: RequestContext,
  row: Record<string, unknown>,
): boolean {
  return JSON.stringify(ctx.scope.targets.app) === JSON.stringify(row.app);
}
const FORBIDDEN_READ = "이 credential로는 할 수 없다";

function rowToVerification(row: Record<string, unknown>): Verification {
  return {
    id: String(row.id),
    request_key: String(row.request_key),
    request_principal: String(row.request_principal),
    request_hash: String(row.request_hash),
    kind: String(row.kind) as Verification["kind"],
    app: String(row.app),
    target: {
      bundle_hash: String(row.target_bundle_hash),
      release: row.target_release === null ? null : String(row.target_release),
    },
    problem: row.problem === null ? null : String(row.problem),
    basis_seq: row.basis_seq === null ? null : String(row.basis_seq),
    reports: [],
    before: row.before_release === null ? null : String(row.before_release),
    after: row.after_release === null ? null : String(row.after_release),
    ticket: row.ticket === null ? null : {
      ticket: String(row.ticket),
      check_index: Number(row.ticket_check_index),
      check_hash: String(row.ticket_check_hash),
      completion_seq: String(row.ticket_completion_seq),
    },
    test: String(row.test),
    execution: String(row.execution),
    result: String(row.result) as Verification["result"],
    reason: String(row.reason),
    observations: String(row.observations),
  };
}

function withReports(
  snapshot: ReadSnapshot,
  row: Record<string, unknown>,
): Result<Verification> {
  try {
    const parsed = verificationSchema.safeParse(
      JSON.parse(String(row.verification_canonical)),
    );
    if (parsed.success) {
      const verification = parsed.data;
      const reports = snapshot.sql.all(
        `select report from verification_reports where verification = ? order by report`,
        [verification.id],
      ).map((item) => String(item.report));
      if (
        reports.length === verification.reports.length &&
        new Set(verification.reports).size === reports.length &&
        verification.reports.every((report) => reports.includes(report)) &&
        canonicalJson({
            ...rowToVerification(row),
            reports: verification.reports,
          }) ===
          canonicalJson(verification)
      ) return ok(verification);
    }
  } catch {
    // 저장 canonical 또는 관계가 깨지면 부분 결과를 내놓지 않는다.
  }
  return err({
    code: "internal",
    message: "저장된 Verification이 올바르지 않다",
  });
}

export function readTestRequest(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  input: { request_key: string },
): Result<
  { request: TestRequest; as_of_seq: string; next_cursor: string | null }
> {
  const allowed = canReadOwnRequest(ctx);
  if (!allowed.ok) return allowed;
  const records = loadRecords(snapshot.sql, ctx.principal, input.request_key);
  const accepted = records.find((record) => record.phase === "accepted");
  if (
    Object.entries(ctx.scope.targets).some(([key, expected]) => {
      const facts = {
        app: accepted?.payload.app,
        request_principal: ctx.principal,
        request_key: input.request_key,
        request_hash: accepted?.request_hash,
      };
      return !Object.hasOwn(facts, key) ||
        facts[key as keyof typeof facts] !== expected;
    })
  ) return err({ code: "not_found", message: NOT_FOUND });
  const projected = projectRequest(records);
  if (!projected) return err({ code: "not_found", message: NOT_FOUND });
  return ok({
    request: projected,
    as_of_seq: snapshot.as_of_seq,
    next_cursor: null,
  });
}

export function readVerification(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  input: { verification: string; detail: boolean },
): Result<
  { verification: Verification; as_of_seq: string; next_cursor: string | null }
> {
  const asOf = parseSeq(snapshot.as_of_seq);
  if (!asOf.ok) return err({ code: "internal", message: "snapshot seq" });
  const row = snapshot.sql.get(
    `select * from verifications where id = ?`,
    [input.verification],
  );
  if (row) {
    const recorded = parseSeq(String(row.recorded_seq));
    if (!recorded.ok) return err({ code: "internal", message: "recorded seq" });
    if (recorded.value > asOf.value) {
      return err({ code: "not_found", message: NOT_FOUND });
    }
  }
  if (!row) return err({ code: "not_found", message: NOT_FOUND });
  if (!hasReadOperation(ctx) || !sameApp(ctx, row)) {
    return err({ code: "forbidden", message: FORBIDDEN_READ });
  }
  if (!verificationScope(ctx, row)) {
    return err({ code: "not_found", message: NOT_FOUND });
  }
  const allowed = canReadVerification(
    ctx,
    rowFacts(row),
    snapshot.port(TargetAuthorization),
  );
  if (!allowed.ok) return allowed;
  const verification = withReports(snapshot, row);
  if (!verification.ok) return verification;
  if (input.detail && !allowed.value.detail) {
    return err({
      code: "forbidden",
      message: "실행 증거는 별도 권한이 필요하다",
    });
  }
  return ok({
    verification: verification.value,
    as_of_seq: snapshot.as_of_seq,
    next_cursor: null,
  });
}

export function readVerificationList(
  snapshot: ReadSnapshot,
  ctx: RequestContext,
  input: {
    app: string;
    problem?: string;
    ticket?: string;
    kind?: Verification["kind"];
    cursor?: string;
  },
): Result<{
  verifications: Verification[];
  as_of_seq: string;
  next_cursor: string | null;
}> {
  const allowed = canListVerifications(ctx, input.app);
  if (!allowed.ok) return allowed;
  const after = parseSeq(input.cursor ?? "0");
  const asOf = parseSeq(snapshot.as_of_seq);
  if (!after.ok) return err({ code: "invalid_input", message: "cursor" });
  if (!asOf.ok) return err({ code: "internal", message: "snapshot seq" });
  const scopeColumns = new Set([
    "app",
    "request_principal",
    "request_key",
    "request_hash",
    "problem",
    "ticket",
  ]);
  const predicates: string[] = [];
  const scopeParams: (string | null)[] = [];
  for (const [key, value] of Object.entries(ctx.scope.targets)) {
    if (
      !scopeColumns.has(key) || (value !== null && typeof value !== "string")
    ) {
      return err({ code: "not_found", message: NOT_FOUND });
    }
    predicates.push(`${key} is ?`);
    scopeParams.push(value as string | null);
  }
  const rows = snapshot.sql.all(
    `select * from verifications
     where app = ?
       and (problem = ? or ? is null)
       and (ticket = ? or ? is null)
       and (kind = ? or ? is null)
       and cast(recorded_seq as integer) > ?
       and cast(recorded_seq as integer) <= ?
       and ${predicates.join(" and ")}
     order by cast(recorded_seq as integer)
     limit ?`,
    [
      input.app,
      input.problem ?? null,
      input.problem ?? null,
      input.ticket ?? null,
      input.ticket ?? null,
      input.kind ?? null,
      input.kind ?? null,
      after.value.toString(),
      asOf.value.toString(),
      ...scopeParams,
      VERIFICATION_PAGE_CAP + 1,
    ],
  );
  const visible = rows;
  const parsed = visible.slice(0, VERIFICATION_PAGE_CAP).map((row) =>
    withReports(snapshot, row)
  );
  if (parsed.some((item) => !item.ok)) {
    return err({
      code: "internal",
      message: "저장된 Verification이 올바르지 않다",
    });
  }
  const page = parsed.flatMap((item) => item.ok ? [item.value] : []);
  const next = visible.length > VERIFICATION_PAGE_CAP
    ? String(visible[VERIFICATION_PAGE_CAP - 1].recorded_seq)
    : null;
  return ok({
    verifications: page,
    as_of_seq: snapshot.as_of_seq,
    next_cursor: next,
  });
}

export const getTestRequestRead: ReadDefinition<typeof getTestRequest> = {
  route: getTestRequest,
  handle: readTestRequest,
};

export const getVerificationRead: ReadDefinition<typeof getVerification> = {
  route: getVerification,
  handle: readVerification,
};

export const listVerificationsRead: ReadDefinition<typeof listVerifications> = {
  route: listVerifications,
  handle: readVerificationList,
};

export const verificationRecordedVisibility: EventVisibilityDefinition<
  typeof verificationRecorded
> = {
  event: verificationRecorded,
  handle(snapshot, ctx, event) {
    const row = snapshot.sql.get(
      `select * from verifications where id = ?`,
      [event.subject],
    );
    if (
      !row || String(row.app) !== event.payload.app ||
      String(row.recorded_seq) !== event.seq || !verificationScope(ctx, row) ||
      !ctx.scope.operations.includes("GetVerification")
    ) return ok(false);
    const eventSeq = parseSeq(event.seq);
    const asOf = parseSeq(snapshot.as_of_seq);
    if (!eventSeq.ok || !asOf.ok || eventSeq.value > asOf.value) {
      return ok(false);
    }
    const ticket = rowToVerification(row).ticket;
    if (
      JSON.stringify(ticket) !== JSON.stringify(event.payload.ticket ?? null)
    ) return ok(false);
    const release = row.target_release === null
      ? null
      : String(row.target_release);
    const problem = row.problem === null ? null : String(row.problem);
    const basis = row.basis_seq === null ? null : String(row.basis_seq);
    const same =
      String(row.target_bundle_hash) === event.payload.target.bundle_hash &&
      release === event.payload.target.release &&
      problem === (event.payload.problem ?? null) &&
      basis === (event.payload.basis_seq ?? null) &&
      String(row.result) === event.payload.result &&
      String(row.test) === event.payload.test &&
      String(row.execution) === event.payload.execution &&
      String(row.kind) === event.payload.kind;
    if (!same) return ok(false);
    return ok(true);
  },
};
