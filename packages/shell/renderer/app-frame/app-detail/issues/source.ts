// Issues 탭이 읽고 쓰는 통로. 모양은 protocol/problems의 문제 목록·상세·상태 바꾸기에서 이 화면이 쓰는
// field만 옮긴 것이다. 상태는 열림·해결됨·무시 셋이다.
import type { SourceResult } from "../source.ts";

export type { SourceResult };

export type IssueStatus = "open" | "resolved" | "ignored";

export interface IssueRow {
  readonly id: string;
  readonly status: IssueStatus;
  /** 영향 한 문장. */
  readonly impact: string;
  /** 접수 수. */
  readonly count: number;
  /** 마지막으로 난 시각(ISO). */
  readonly lastAt: string;
  /** 해결됨이던 것이 다시 열렸다면 다시 난 release 번호. */
  readonly recurredRelease: number | null;
}

export interface IssueOccurrence {
  readonly report: string;
  readonly at: string;
  readonly releaseNumber: number | null;
  /** 앱이 낸 오류와 사람의 제보. */
  readonly kind: "app_error" | "report";
}

export interface IssueView {
  readonly id: string;
  readonly status: IssueStatus;
  readonly impact: string;
  readonly count: number;
  readonly firstAt: string;
  readonly lastAt: string;
  /** 해결됨이던 것이 다시 열렸다. 이전 해결 시각과 다시 난 release 번호. */
  readonly recurred: {
    readonly resolvedAt: string;
    readonly releaseNumber: number;
  } | null;
  readonly occurrences: readonly IssueOccurrence[];
  readonly evidence: {
    /** 원래 source 위치의 stack. */
    readonly stack: string | null;
    readonly log: string | null;
    /** 마지막으로 난 release와 commit. */
    readonly release: {
      readonly number: number;
      readonly commit: string;
    } | null;
    /** 사람이 쓴 제보 글. */
    readonly reports: readonly string[];
  };
}

export interface IssueFilter {
  /** null이면 모든 상태. */
  readonly status: IssueStatus | null;
  /** 이 시각 뒤에 마지막으로 난 것만. null이면 전체 기간. */
  readonly since: string | null;
}

export interface IssuesSource {
  list(
    app: string,
    filter: IssueFilter,
  ): Promise<SourceResult<readonly IssueRow[]>>;
  get(problem: string): Promise<SourceResult<IssueView>>;
  /** 확인 창 없이 바로 바꾼다. 같은 상태로 바꾸면 그대로 ok다. */
  setState(
    problem: string,
    state: IssueStatus,
  ): Promise<SourceResult<true>>;
}
