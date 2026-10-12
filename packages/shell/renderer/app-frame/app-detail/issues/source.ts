// Issues 탭이 읽고 쓰는 통로. 모양은 contracts의 ListProblems·GetProblem(`detail` 포함)에서 이
// 화면이 쓰는 field만 옮긴 것이다. 화면은 내부 `problem.work`·`problem.interpretation`이 아니라
// 사용자용 `detail`만 읽는다. 문구(label·attention 같은 en 문장)는 problems가 정한
// 값 그대로이고 화면이 다시 해석하거나 합치지 않는다.
import type { SourceResult } from "../source.ts";

export type { SourceResult };

export type IssueStatus = "open" | "fixing" | "closed";

/** 닫힌 이유 네 가지. 서로 다른 사실이다. */
export type IssueClosure =
  | "verified"
  | "user_confirmed"
  | "recovered"
  | "dismissed";

export type IssueTestState =
  | "pending"
  | "running"
  | "pass"
  | "fail"
  | "unconfirmed";

export type IssueTestSummary = IssueTestState | "not_run" | "unknown";

export interface IssueRow {
  readonly id: string;
  readonly status: IssueStatus;
  /** 사람이 겪는 영향 한 문장(problems가 정한 값). */
  readonly impact: string;
  readonly nextAction: string | null;
}

export interface IssueTest {
  /** 한 건의 사람 말 이름(problems가 정한 값). */
  readonly label: string;
  readonly state: IssueTestState;
  readonly endedAt: string | null;
}

export type IssueRecordedState = IssueTestState | "not_run";

/** 지금 값으로 접지 않은 결과. 문구는 problems가 정한 값이다. */
export interface IssueRecorded {
  readonly kind: "reproduction" | "app_test" | "test_command";
  readonly label: string;
  readonly state: IssueRecordedState;
  readonly endedAt: string | null;
}

export interface IssueClosed {
  readonly reason: IssueClosure;
  readonly label: string;
  /** 지금 필요한 주의. */
  readonly attention: string;
  /** 펼친 상세: 실제 확인한 범위. */
  readonly scope: string;
  /** 펼친 상세: 확인하지 못한 부분. 한 줄 이상이다. */
  readonly unconfirmed: readonly string[];
  /** 펼친 상세: 그 닫힘이 본 Version. 모르면 null이다. */
  readonly version: string | null;
  readonly evidence: readonly {
    readonly text: string;
    readonly at: string | null;
  }[];
}

export interface IssueView {
  readonly id: string;
  readonly status: IssueStatus;
  readonly impact: string;
  /** 같은 문제로 묶인 접수 수. */
  readonly seen: number;
  readonly firstSeenAt: string | null;
  readonly lastSeenAt: string | null;
  readonly progress: string;
  /** 지금 수리를 맡은 쪽의 사람 말 이름. */
  readonly owner: string;
  readonly neededAction: string | null;
  readonly repair: {
    readonly label: string;
    readonly needs: readonly string[];
    readonly lastCheckFailed: boolean;
  };
  readonly result: {
    /** 수리 쪽이 고쳤다고 한 주장. 실제 확인이 아니다. */
    readonly claimed: boolean;
    readonly claimLabel: string;
    readonly tests: {
      readonly state: IssueTestSummary;
      readonly label: string;
      readonly items: readonly IssueTest[];
    };
    /** 실제 통과·실패·판정 불가·미실행을 접지 않은 목록. 없으면 지금 값만 보인다. */
    readonly recorded?: readonly IssueRecorded[];
    /** 운영에 적용되지 않아 열린 채로 남는 한 문장. */
    readonly remaining?: string;
  };
  readonly closed: IssueClosed | null;
  /** 결정 선택지가 기댈 사실이 있는지(결정은 main이 독립 read로 다시 고정한다). */
  readonly basis: {
    readonly versionKnown: boolean;
    readonly observationKnown: boolean;
  };
}

/** 사람이 고르는 결정 네 가지. dismiss만 한 줄 이유가 있다. */
export type IssueChoice = "fixed" | "not_fixed" | "not_visible" | "dismiss";

export interface IssueDecision {
  readonly problem: string;
  readonly choice: IssueChoice;
  /** dismiss의 한 줄 이유. 다른 결정은 null이다. */
  readonly note: string | null;
}

export interface IssuesSource {
  list(app: string): Promise<SourceResult<readonly IssueRow[]>>;
  get(problem: string): Promise<SourceResult<IssueView>>;
  /**
   * 결정 창(owner decision)을 연다. 결정 자체는 그 창에서만 받는다. 창이 확정되지 않고 끝나면
   * (닫기·취소·만료·교체) onUnconfirmed를 한 번 부른다.
   */
  decide(
    decision: IssueDecision,
    onUnconfirmed?: () => void,
  ): Promise<SourceResult<true>>;
  /** "직접 해 봤지만 안 됩니다": 그 문제를 고른 채 새 feedback을 연다. */
  reportAgain(app: string, problem: string): Promise<SourceResult<true>>;
}
