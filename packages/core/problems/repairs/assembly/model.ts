// 수리 자료 조립이 쓰는 읽기 port와 조립 근거 모양.
// port는 현재 연결 범위 안의 정본 read 하나씩이다. 조립은 이 port 밖의 자료를 읽지 않고
// 완성 묶음을 저장하지 않는다.
import type { Result } from "../../../../base/mod.ts";
import type { Output } from "../../../../protocol/server/mod.ts";
import type {
  getProblem,
  getReport,
  listProblemFixes,
  listProblems,
  listReports,
  listVerifications,
} from "../../../../protocol/problems/mod.ts";
import type {
  invocationsGet,
  releasesGet,
  releasesList,
} from "../../../../protocol/apps/mod.ts";
import type { ticketShow } from "../../../../protocol/coding-agent/mod.ts";
import type { Fingerprint } from "./select.ts";

// connection과 같은 문장이다. 없는 대상과 범위 밖 대상은 같은 답이다.
export const UNREADABLE_MESSAGE =
  "현재 연결로 읽을 수 없다. 없는 대상이거나 이 연결의 범위 밖이다";

export type ProblemOut = Output<typeof getProblem>;
export type ReportListOut = Output<typeof listReports>;
export type ReportOut = Output<typeof getReport>;
export type TicketOut = Output<typeof ticketShow>;
export type FixesOut = Output<typeof listProblemFixes>;
export type VerificationsOut = Output<typeof listVerifications>;
export type ProblemListOut = Output<typeof listProblems>;
export type ReleaseListOut = Output<typeof releasesList>;
export type ReleaseGetOut = Output<typeof releasesGet>;
export type InvocationGetOut = Output<typeof invocationsGet>;
export type ReportSummary = ReportListOut["reports"][number];
export type Release = NonNullable<ReleaseGetOut["release"]>;

// blob 본문 읽기. 이 연결로 읽을 수 없으면 이유를 돌려주고 빈 내용으로 채우지 않는다.
export type BlobRef = { owner_kind: string; owner_key: string; field: string };
export type BlobText =
  | { kind: "text"; text: string; truncated: boolean }
  | { kind: "unavailable"; reason: string };

export type RepairReadPort = {
  // 조립 시각(observed_at). 공통 시각 형식이다.
  now(): string;
  // core 알려진 값 pipe를 지난 글. 끝내지 못했으면 null이고 호출자는 원문을 쓰지 않는다.
  redact(text: string): Promise<string | null>;
  problem(id: string): Promise<Result<ProblemOut>>;
  reports(problem: string, cursor?: string): Promise<Result<ReportListOut>>;
  report(id: string): Promise<Result<ReportOut>>;
  ticket(id: string): Promise<Result<TicketOut>>;
  fixes(problem: string): Promise<Result<FixesOut>>;
  verifications(
    app: string,
    problem: string,
  ): Promise<Result<VerificationsOut>>;
  problems(app: string): Promise<Result<ProblemListOut>>;
  releases(app: string): Promise<Result<ReleaseListOut>>;
  release(id: string): Promise<Result<ReleaseGetOut>>;
  invocation(id: string): Promise<Result<InvocationGetOut>>;
  blob(ref: BlobRef, maxBytes: number): Promise<BlobText>;
};

// 대상 selector. problem 또는 ticket 하나다(ticket 준비 전 조사는 problem 하나, ticket null).
export type RepairTarget = { problem: string } | { ticket: string };

// 읽기 실패의 표시 이유. 없음·범위 밖은 같은 문장이다.
export function readReason<T>(result: Result<T>): string | null {
  if (result.ok) return null;
  const code = result.error.code;
  return code === "not_found" || code === "forbidden"
    ? UNREADABLE_MESSAGE
    : "읽지 못했다(일시 장애)";
}

export type OccurrenceFacts = {
  report: ReportSummary;
  // 1부터 센 접수 순위(낮을수록 먼저).
  rank: number;
  detail: Result<ReportOut>;
  invocation: Result<InvocationGetOut> | null;
  fingerprint: Fingerprint;
  human_text: BlobText | null;
  logs: BlobText | null;
};

export type ProblemFacts = {
  id: string;
  problem: Result<ProblemOut>;
  // 접수 순서 오름차순 목록. complete가 false면 더 읽을 수 있는 보고가 남아 있다.
  reports: {
    listed: ReportSummary[];
    complete: boolean;
    error: string | null;
  };
  // 상세를 읽은 발생. 많으면 일부만 읽는다(sampled).
  occurrences: OccurrenceFacts[];
  sampled: boolean;
  representatives: OccurrenceFacts[];
  first_release: Result<ReleaseGetOut> | null;
  fixes: Result<FixesOut>;
  verifications: Result<VerificationsOut>;
};

export type TargetFacts = {
  app: string;
  ticket: Result<TicketOut> | null;
  problems: ProblemFacts[];
  related: { same_app: Result<ProblemListOut> };
  releases: Result<ReleaseListOut>;
  observed_at: string;
};
