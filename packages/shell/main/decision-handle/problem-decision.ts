// 문제의 사람 결정. 사람이 고른 결정·한 줄 이유로 문제·활성 release·마지막 보고를 독립 read해
// 정본을 만든다. 결정은 화면이 `ApplyProblemDecision`으로 보내고, handle은 이 정본에 묶인다.
// route binding이 [choice, problem, …]이라 handle의 대상은 고른 결정이다.
import {
  bindingOf,
  type Called,
  type DecisionCore,
  failed,
  type Read,
  readFailure,
  record,
  text,
} from "./core.ts";

export const PROBLEM_CONCERN = "problems/closing";
export const PROBLEM_DECISION = "problem_decision";
/** core가 handle 사용을 비교하는 결정 이름(= command route 이름). */
export const APPLY_PROBLEM_DECISION = "ApplyProblemDecision";

/** contracts applyProblemDecision의 binding. 첫 field가 handle 대상이다. */
const BINDING = [
  "choice",
  "problem",
  "basis_seq",
  "release",
  "last_report",
  "note",
] as const;

const CHOICES = ["fixed", "not_fixed", "not_visible", "dismiss"] as const;

export async function readProblemDecision(
  core: DecisionCore,
  request: { targets?: string[]; choice?: string; note?: string },
): Promise<Read> {
  const problem = request.targets?.[0];
  const choice = CHOICES.find((one) => one === request.choice);
  if (problem === undefined || request.targets?.length !== 1 || !choice) {
    return failed("invalid_input", "문제 결정이 아니다");
  }
  const got = await core.internal("read", "problems", "get", { problem });
  if (!got.ok) return readFailure(got);
  const found = record(got.value);
  const shown = record(found.problem);
  const seq = text(shown.seq);
  const app = text(shown.app);
  if (shown.id !== problem || seq === null || app === null) {
    return failed("not_found", "이 문제를 찾지 못했다");
  }
  const appRead = await core.internal("read", "apps", "get", { app });
  if (!appRead.ok) return readFailure(appRead);
  const release = text(record(record(appRead.value).app).active_release);
  let lastReport: string | null = null;
  if (choice === "not_visible") {
    const reports: Called = await core.internal(
      "read",
      "problems",
      "list-reports",
      { problem },
    );
    if (!reports.ok) return readFailure(reports);
    const list = record(reports.value).reports;
    // 최근 순이다. 첫 항목이 그 문제의 마지막 live 보고다.
    lastReport = Array.isArray(list) ? text(record(list[0]).id) : null;
  }
  const note = choice === "dismiss" ? request.note ?? null : null;
  // 닫은 문제는 다시 열기(not_fixed)만 받는다. contract가 거절할 결정은 고를 수 없게 둔다.
  const closed = shown.status === "closed";
  const allowed = !(closed && choice !== "not_fixed") &&
    !(choice === "fixed" && release === null) &&
    !(choice === "not_visible" && (release === null || lastReport === null)) &&
    !(choice === "dismiss" && note === null);
  const bound = bindingOf(BINDING, {
    choice,
    problem,
    basis_seq: seq,
    release,
    last_report: lastReport,
    note,
  });
  return {
    ok: true,
    value: {
      targetRef: bound.target,
      content: bound.content,
      allowed: allowed ? [APPLY_PROBLEM_DECISION] : [],
      expiresAt: null,
    },
  };
}
