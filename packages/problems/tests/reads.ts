import { err, ok, parseSeq, type Result } from "../../base/mod.ts";
import type {
  ReadDefinition,
  ReadSnapshot,
  RequestContext,
} from "../../contracts/platform/mod.ts";
import {
  getTestRequest,
  getVerification,
  listVerifications,
  type TestRequest,
  type Verification,
  verificationRecorded,
  verificationSchema,
} from "../../contracts/problems/mod.ts";
import type { EventVisibilityDefinition } from "../../contracts/platform/mod.ts";
import {
  canListVerifications,
  canReadOwnRequest,
  canReadVerification,
  projectRequest,
  VERIFICATION_PAGE_CAP,
  visibilityAllows,
} from "./model.ts";
import { loadRecords } from "./records.ts";

const NOT_FOUND = "기록을 찾을 수 없다";

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
  verification: Verification,
): Verification {
  const reports = snapshot.sql.all(
    `select report from verification_reports where verification = ? order by report`,
    [verification.id],
  ).map((row) => String(row.report));
  return { ...verification, reports };
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
  const projected = projectRequest(
    loadRecords(snapshot.sql, ctx.principal, input.request_key),
  );
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
  const allowed = canReadVerification(ctx, String(row.app));
  if (!allowed.ok) return allowed;
  const facts = {
    app: row.app,
    request_principal: row.request_principal,
    request_key: row.request_key,
    request_hash: row.request_hash,
    problem: row.problem,
    ticket: row.ticket,
  };
  if (
    Object.entries(ctx.scope.targets).some(([key, expected]) =>
      JSON.stringify(facts[key as keyof typeof facts]) !==
        JSON.stringify(expected)
    )
  ) {
    return err({ code: "not_found", message: NOT_FOUND });
  }
  const verification = withReports(snapshot, rowToVerification(row));
  if (input.detail && !allowed.value.detail) {
    return err({
      code: "forbidden",
      message: "실행 증거는 별도 권한이 필요하다",
    });
  }
  return ok({
    verification,
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
  const rows = snapshot.sql.all(
    `select * from verifications
     where app = ?
       and (problem = ? or ? is null)
       and (ticket = ? or ? is null)
       and (kind = ? or ? is null)
       and cast(recorded_seq as integer) > ?
       and cast(recorded_seq as integer) <= ?
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
      VERIFICATION_PAGE_CAP + 1,
    ],
  );
  const visible = rows.filter((row) => {
    const facts = {
      app: row.app,
      request_principal: row.request_principal,
      request_key: row.request_key,
      request_hash: row.request_hash,
      problem: row.problem,
      ticket: row.ticket,
    };
    return !Object.entries(ctx.scope.targets).some(([key, expected]) =>
      JSON.stringify(facts[key as keyof typeof facts]) !==
        JSON.stringify(expected)
    );
  });
  const parsed = visible.slice(0, VERIFICATION_PAGE_CAP).map((row) =>
    verificationSchema.safeParse(withReports(snapshot, rowToVerification(row)))
  );
  if (parsed.some((item) => !item.success)) {
    return err({
      code: "internal",
      message: "저장된 Verification이 올바르지 않다",
    });
  }
  const page = parsed.flatMap((item) => item.success ? [item.data] : []);
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
    if (!row || String(row.app) !== event.payload.app) return ok(false);
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
    return visibilityAllows(ctx, String(row.app), {
      app: event.payload.app,
      problem: event.payload.problem,
      ticket: event.payload.ticket?.ticket,
    });
  },
};
