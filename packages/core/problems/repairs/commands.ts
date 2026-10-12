import { err, ok, type Result } from "../../../base/mod.ts";
import type { LophnError } from "../../../base/mod.ts";
import { TicketClaimCheck } from "../../../protocol/coding-agent/mod.ts";
import {
  type CommandDefinition,
  type Input,
  type Output,
  parseActor,
  type PortKey,
  type RequestContext,
  type Tx,
} from "../../../protocol/server/mod.ts";
import {
  problemFixRecorded,
  recordProblemFix,
} from "../../../protocol/problems/mod.ts";
import { NOT_FOUND } from "../reporting/mod.ts";
import { latestEventSeq, staleSeq } from "./model.ts";

// 없는 대상과 범위 밖 대상은 같은 답이다(platform/identity#R8).
const notFound = (): Result<never, LophnError> =>
  err({ code: "not_found", message: NOT_FOUND });
const conflict = (message: string): Result<never, LophnError> =>
  err({ code: "conflict", message });

function portOf<T>(tx: Pick<Tx, "port">, key: PortKey<T>): T | undefined {
  try {
    return tx.port(key);
  } catch {
    return undefined;
  }
}

type ReleaseRow = {
  app: string;
  status: string;
  bundle_hash: string;
};

// release 준비는 prepare가 한 번만 돌리므로 행이 있으면 준비됐다.
// 관심 앱 밖 release는 같은 not_found다(R1).
function findRelease(
  sql: Pick<Tx["sql"], "get">,
  release: string,
): ReleaseRow | null {
  const row = sql.get(
    `select app, status, bundle_hash from releases where id = ?`,
    [release],
  );
  if (row === undefined) return null;
  return {
    app: String(row["app"]),
    status: String(row["status"]),
    bundle_hash: String(row["bundle_hash"]),
  };
}

type VerificationRow = {
  app: string;
  kind: string;
  result: string;
  target_bundle_hash: string;
  problem: string | null;
  before_release: string | null;
  after_release: string | null;
};

function findVerification(
  sql: Pick<Tx["sql"], "get">,
  verification: string,
): VerificationRow | null {
  const row = sql.get(
    `select app, kind, result, target_bundle_hash, problem, before_release, after_release
       from verifications where id = ?`,
    [verification],
  );
  if (row === undefined) return null;
  return {
    app: String(row["app"]),
    kind: String(row["kind"]),
    result: String(row["result"]),
    target_bundle_hash: String(row["target_bundle_hash"]),
    problem: row["problem"] === null ? null : String(row["problem"]),
    before_release: row["before_release"] === null
      ? null
      : String(row["before_release"]),
    after_release: row["after_release"] === null
      ? null
      : String(row["after_release"]),
  };
}

// 문제 포함 여부(repair ticket에 이 문제가 있다)는 같은 transaction에서
// coding-agent ticket 표로 직접 본다(coding-agent#T19). kind가 repair가 아니거나
// 문제가 ticket에 없으면 같은 conflict다(R5).
function ticketContains(
  sql: Pick<Tx["sql"], "get">,
  ticket: string,
  problem: string,
): Result<string, LophnError> {
  const row = sql.get(
    `select app, kind from tickets where id = ?`,
    [ticket],
  );
  if (row === undefined) {
    return conflict("ticket claim is not current: missing");
  }
  if (String(row["kind"]) !== "repair") {
    return conflict("ticket claim is not current: missing");
  }
  const contained = sql.get(
    `select 1 as found from ticket_problems where ticket = ? and problem = ?`,
    [ticket, problem],
  );
  if (contained === undefined) {
    return conflict("ticket claim is not current: missing");
  }
  return ok(String(row["app"]));
}

// 방금 검사한 claim 검사 결과다. port가 없으면 fail-closed다.
type ClaimChecked = {
  ok: true;
  expires_at: string;
  app?: string;
} | {
  ok: false;
  reason: string;
};

export function handleRecordProblemFix(
  tx: Tx,
  _ctx: RequestContext,
  input: Input<typeof recordProblemFix>,
  compare: unknown,
): Result<Output<typeof recordProblemFix>, LophnError> {
  const problem = input.problem;
  const fix = input.fix;
  // 실행 자격 CAS: executor는 processed_through_seq만 검사하므로 이 command의
  // problem_seq 비교 기준은 handler가 형식과 대상을 본다(reporting과 같은 모양).
  if (compare === null || typeof compare !== "object") {
    return err({ code: "invalid_input", message: "수리 비교 기준이 없다" });
  }
  if (!("problem_seq" in compare)) {
    return err({ code: "invalid_input", message: "수리 비교 기준이 없다" });
  }
  const compareKeys = compare as Record<string, unknown>;
  const problemSeq = compareKeys["problem_seq"];
  if (typeof problemSeq !== "string" || !/^\d+$/.test(problemSeq)) {
    return err({ code: "invalid_input", message: "수리 비교 기준이 없다" });
  }
  const row = tx.sql.get(
    `select app from problems where id = ?`,
    [problem],
  );
  if (row === undefined) return notFound();
  const app = String(row["app"]);
  const current = latestEventSeq(tx.sql, problem);
  if (staleSeq(problemSeq, current)) {
    // 낡은 문제 기준 제출은 충돌이다(R3). 없는 문제와 같은 답을 하지 않는다.
    return conflict("문제가 바뀌었다");
  }
  // 두 release는 이 앱의 준비된 고친 release다(R1). 다른 앱 release·없는 release는
  // 같은 not_found다.
  const before = findRelease(tx.sql, fix.before);
  const after = findRelease(tx.sql, fix.after);
  if (before === null || after === null) return notFound();
  if (before.app !== app || after.app !== app) return notFound();
  // 결과 참조는 고친 묶음과 일치하는 결과만 가리킨다(R2). 빈 목록도 된다.
  for (const verification of fix.verification) {
    const found = findVerification(tx.sql, verification);
    if (found === null) return notFound();
    if (found.result !== "pass") {
      return err({
        code: "invalid_input",
        message: "통과한 결과만 고친 기록이 가리킨다",
      });
    }
    if (found.app !== app || found.target_bundle_hash !== after.bundle_hash) {
      return err({
        code: "invalid_input",
        message: "결과 묶음이 고친 release와 다르다",
      });
    }
    if (found.kind === "reproduction") {
      const matches = found.problem === problem &&
        found.before_release === fix.before &&
        found.after_release === fix.after;
      if (!matches) {
        return err({
          code: "invalid_input",
          message: "재현 결과는 이 수리의 대상이어야 한다",
        });
      }
    }
  }
  // 새 제출은 ticket 접수와 현재 claim만 출처로 받는다(R4, R5). 과거 null 출처는
  // 이미 기록된 payload라 여기 오지 않는다.
  const ticketApp = ticketContains(tx.sql, fix.ticket, problem);
  if (!ticketApp.ok) return ticketApp;
  const check = portOf(tx, TicketClaimCheck);
  if (check === undefined) {
    return err({
      code: "unavailable",
      message: "ticket claim check is unavailable",
    });
  }
  let checked;
  try {
    checked = check({
      ticket: fix.ticket,
      claim_seq: fix.claim_seq,
      connection: parseActor(_ctx.actor)?.kind === "coding_agent"
        ? _ctx.actor.slice("coding_agent:".length)
        : "",
      now: tx.now(),
    });
  } catch {
    return err({
      code: "unavailable",
      message: "ticket claim check is unavailable",
    });
  }
  if (!checked.ok) {
    return err({
      code: "unavailable",
      message: "ticket claim check is unavailable",
    });
  }
  if (!checked.value.ok) {
    return conflict(
      `ticket claim is not current: ${checked.value.reason}`,
    );
  }
  if (checked.value.app !== app) {
    return conflict("ticket claim is not current: missing");
  }
  // summary blob 준비 참조. hash만 싣는 기록은 가리키는 바이트가 저장된 blob이어야 한다:
  // 준비 증거가 fix.summary와 같은 hash·fix_summary purpose여야 등록한다(contracts#T40).
  const prepared = input.summary_blob;
  if (prepared.hash !== fix.summary) {
    return err({
      code: "invalid_input",
      message: "summary blob hash가 fix.summary와 다르다",
    });
  }
  if (prepared.purpose !== "fix_summary") {
    return err({
      code: "invalid_input",
      message: "summary blob purpose는 fix_summary여야 한다",
    });
  }
  // append-only다. update·delete는 없고, 늦은 기록이 이전 기록을 고치지 않는다(R3).
  const seq = tx.emit(problemFixRecorded, problem, {
    before: fix.before,
    after: fix.after,
    summary: fix.summary,
    verification: [...fix.verification],
    ticket: fix.ticket,
    claim_seq: fix.claim_seq,
  });
  // 영구 참조는 같은 transaction이다. 거절되면 기록 전체가 없다(저장되지 않은
  // hash는 참조가 되지 못한다).
  const registered = tx.registerBlobRef({
    owner_kind: "problem_fix",
    owner_key: problem,
    field: "summary",
    registered_seq: seq,
    source: { kind: "prepared", blob: { ...prepared } },
  });
  if (!registered.ok) return registered;
  return ok({ seq });
}

export const recordProblemFixCommand: CommandDefinition<
  typeof recordProblemFix
> = {
  route: recordProblemFix,
  handle(tx, ctx, input, compare) {
    return handleRecordProblemFix(tx, ctx, input, compare);
  },
};
