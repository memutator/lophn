// Issues 화면이 core의 문제 읽기를 화면 값으로 옮기는 자리. 받는 값은 protocol/problems의
// `problem.list`·`problem.get` 출력이다.
import type {
  ProblemDetailView,
  ProblemListItem,
  ProblemSnapshot,
} from "../../../../../protocol/problems/mod.ts";
import type { IssueOccurrence, IssueRow, IssueView } from "./source.ts";

export function issueRowOf(item: ProblemListItem): IssueRow {
  return {
    id: item.id,
    status: item.state,
    impact: item.name,
    count: item.occurrence_count,
    lastAt: item.last_observed_at,
    // 목록 줄에는 재발 칸이 없다. 재발은 상세(problem.get)에서 읽는다.
    recurredRelease: null,
  };
}

/** 원래 source 위치의 stack 글. 오류가 없으면 null이다. */
function stackText(error: ProblemSnapshot["error"]): string | null {
  if (error === null) return null;
  const head = error.message === null
    ? error.name
    : `${error.name}: ${error.message}`;
  const frames = error.frames.map((frame) => {
    const place = [frame.path, frame.line, frame.column]
      .filter((part) => part !== null)
      .join(":");
    return frame.function === null
      ? `  at ${place}`
      : `  at ${frame.function} (${place})`;
  });
  return [head, ...frames].join("\n");
}

/** release id를 번호로. 모르면 null이다. */
export type ReleaseNumbers = ReadonlyMap<string, number>;

/** 해결됨이던 문제가 다시 열린 사실. 다시 난 release의 번호를 모르면 그리지 못해 null이다. */
function recurredOf(
  value: ProblemDetailView,
  numbers: ReleaseNumbers,
): IssueView["recurred"] {
  const recurred = value.problem.recurred;
  const releaseNumber = recurred === null
    ? undefined
    : numbers.get(recurred.release);
  return recurred === null || releaseNumber === undefined
    ? null
    : { resolvedAt: recurred.resolved_at, releaseNumber };
}

export function issueViewOf(
  value: ProblemDetailView,
  numbers: ReleaseNumbers,
  extra: { log: string | null; reports: readonly string[] },
): IssueView {
  const occurrences: IssueOccurrence[] = value.occurrences.map((item) => ({
    report: item.report,
    at: item.observed_at,
    releaseNumber: item.release === null
      ? null
      : (numbers.get(item.release) ?? null),
    kind: item.source === "feedback" ? "report" : "app_error",
  }));
  return {
    id: value.problem.id,
    status: value.problem.state,
    impact: value.problem.name,
    count: value.occurrence_count,
    firstAt: value.first_observed_at,
    lastAt: value.last_observed_at,
    recurred: recurredOf(value, numbers),
    occurrences,
    evidence: {
      stack: value.latest === null
        ? null
        : stackText(value.latest.snapshot.error),
      log: extra.log,
      release: value.last_release === null ? null : {
        number: value.last_release.number,
        commit: value.last_release.code_commit.slice(0, 7),
      },
      reports: extra.reports,
    },
  };
}
