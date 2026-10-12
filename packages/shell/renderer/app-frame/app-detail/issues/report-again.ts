import type { LophnShellFeedbackBegin } from "../../../../ipc/feedback.ts";
import type { IssuesSource } from "./source.ts";

/**
 * "직접 해 봤지만 안 됩니다": 지금 보이는 앱 보기 세션으로 그 문제를 고른 report-problem
 * dialog를 연다. 보기 세션이 없으면 열 수 없다.
 */
export function withReportAgain(
  source: IssuesSource,
  feedback: LophnShellFeedbackBegin | undefined,
  viewSession: string | null,
): IssuesSource {
  if (feedback === undefined) return source;
  return {
    ...source,
    async reportAgain(_app, problem) {
      if (viewSession === null) return { ok: false, code: "unavailable" };
      try {
        await feedback.beginFeedback(viewSession, problem);
        return { ok: true, value: true };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },
  };
}
