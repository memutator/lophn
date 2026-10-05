// report collector worker. core 감독이 띄우고 보고 접수 통로는 이 모듈이
// 조립한다(problems/reporting#R1, R2, R8, R16). credential에서 출처를 정하고,
// 본문 주장은 따르지 않는다.
import { err, ok, type Result } from "../../../packages/base/mod.ts";
import type { RequestContext } from "../../../packages/contracts/platform/mod.ts";
import type {
  RecordReportInput,
  ReportAcceptance,
} from "../../../packages/contracts/problems/mod.ts";
import { reportContentHashInputSchema } from "../../../packages/contracts/problems/mod.ts";

// 접수 전송. transport 실패는 그대로 돌아가고 응답 유실은 response_lost다.
export type SendReport = (
  input: RecordReportInput,
) => Promise<Result<ReportAcceptance>>;

export type CollectorOptions = {
  send: SendReport;
  principal: string;
};

// credential 외의 출처는 없다(R1). 본문 actor·app·release·mode는 다시 쓰지 않는다.
export function originFrom(
  ctx: RequestContext,
  report: RecordReportInput["report"],
): Result<void> {
  if (ctx.actor !== "machine") {
    return err({ code: "forbidden", message: "collector credential이 아니다" });
  }
  if (report.principal !== ctx.principal) {
    return err({
      code: "forbidden",
      message: "principal이 credential과 다르다",
    });
  }
  return ok(undefined);
}

// content hash는 접수 내용에서 결정적으로 정한다(R9). 준비 handle·시각은 넣지 않는다.
// hash 입력 형식은 reportContentHashInputSchema가 정한다: Report 입력(content_hash
// 제외)·Snapshot 입력·group key·기존 문제 참조·blob purpose와 hash.
export function contentHashOf(
  input: Pick<
    RecordReportInput,
    "report" | "snapshot" | "group_key" | "existing_problem" | "blobs"
  >,
): string | undefined {
  const { content_hash: _omitted, ...report } = input.report;
  const parsed = reportContentHashInputSchema.safeParse({
    report,
    snapshot: input.snapshot,
    group_key: input.group_key,
    existing_problem: input.existing_problem,
    blobs: input.blobs.map((blob) => ({
      purpose: blob.purpose,
      hash: blob.hash,
    })),
  });
  if (!parsed.success) return undefined;
  return parsed.data as unknown as string;
}

// 다른 앱 제출은 거절한다(R2). credential의 app과 report.app가 같아야 한다.
export function appFromCredential(
  report: RecordReportInput["report"],
  app: string,
): Result<string> {
  if (report.app !== app) {
    return err({ code: "forbidden", message: "다른 앱의 보고다" });
  }
  return ok(app);
}
