// Issues 탭 테스트의 가짜 통로. core를 부르지 않고 부른 것을 기록한다. 문구는 problems가 정한 값을
// 흉내 낸 en 문장이고 화면은 이것을 그대로 보여야 한다.
import type {
  IssueDecision,
  IssueRow,
  IssuesSource,
  IssueView,
  SourceResult,
} from "../source.ts";

export const APP = "app_01h455vb4pex5v6nkc6gd5fd01";
export const PRB_OPEN = "prb_01h455vb4pex5v6nkc6gd5fd01";
export const PRB_FIXING = "prb_01h455vb4pex5v6nkc6gd5fd02";
export const PRB_CLOSED = "prb_01h455vb4pex5v6nkc6gd5fd03";

export const NOW = new Date("2026-10-07T12:00:00Z");
export const now = () => NOW;

const IMPACT_OPEN = "Some bank files can't be read.";
const IMPACT_FIXING = "Your monthly totals don't add up.";
const IMPACT_CLOSED = "The app closes when you add a receipt.";

export const ROWS: readonly IssueRow[] = [
  {
    id: PRB_OPEN,
    status: "open",
    impact: IMPACT_OPEN,
    nextAction: "Ask for a repair.",
  },
  {
    id: PRB_FIXING,
    status: "fixing",
    impact: IMPACT_FIXING,
    nextAction: null,
  },
  {
    id: PRB_CLOSED,
    status: "closed",
    impact: IMPACT_CLOSED,
    nextAction: null,
  },
];

const BASE: Omit<IssueView, "id" | "status" | "impact"> = {
  seen: 3,
  firstSeenAt: "2026-10-05T09:00:00Z",
  lastSeenAt: "2026-10-07T08:00:00Z",
  progress: "Waiting for a repair",
  owner: "Nobody yet",
  neededAction: "Ask the App Engineer to look at it.",
  repair: { label: "No repair work yet", needs: [], lastCheckFailed: false },
  result: {
    claimed: false,
    claimLabel: "Nobody has said it's fixed.",
    tests: { state: "not_run", label: "No tests were run", items: [] },
  },
  closed: null,
  basis: { versionKnown: true, observationKnown: true },
};

export const OPEN_ISSUE: IssueView = {
  ...BASE,
  id: PRB_OPEN,
  status: "open",
  impact: IMPACT_OPEN,
};

export const FIXING_ISSUE: IssueView = {
  ...BASE,
  id: PRB_FIXING,
  status: "fixing",
  impact: IMPACT_FIXING,
  progress: "Being fixed",
  owner: "A coding agent",
  neededAction: null,
  repair: {
    label: "Work in progress",
    needs: ["Two checks haven't run yet."],
    lastCheckFailed: true,
  },
  result: {
    claimed: true,
    claimLabel: "The fix says it's done.",
    tests: {
      state: "fail",
      label: "One test failed",
      items: [
        { label: "Original failure", state: "pass", endedAt: null },
        { label: "Fixed version", state: "fail", endedAt: null },
        { label: "Whole app", state: "unconfirmed", endedAt: null },
      ],
    },
  },
};

export function closedIssue(
  reason: NonNullable<IssueView["closed"]>["reason"],
  overrides: Partial<IssueView> = {},
): IssueView {
  return {
    ...BASE,
    id: PRB_CLOSED,
    status: "closed",
    impact: IMPACT_CLOSED,
    progress: "Closed",
    neededAction: null,
    closed: {
      reason,
      label: reason === "user_confirmed"
        ? "You said it's fixed."
        : "Tests passed on the version in use.",
      attention: "Tell us if it happens again.",
      scope: "Adding one receipt worked.",
      unconfirmed: ["Adding many receipts at once wasn't tried."],
      version: "Version 4",
      evidence: [{ text: "Receipt test passed.", at: "2026-10-07T10:00:00Z" }],
    },
    ...overrides,
  };
}

export interface FakeIssues {
  readonly source: IssuesSource;
  readonly decisions: IssueDecision[];
  readonly again: { app: string; problem: string }[];
  readonly reads: string[];
  /** 열린 결정 창을 모두 거절·닫기로 끝낸다. */
  endDecisions(): void;
}

export interface FakeIssuesOptions {
  list?: SourceResult<readonly IssueRow[]>;
  views?: Record<string, IssueView>;
  decide?: SourceResult<true>;
  reportAgain?: SourceResult<true>;
}

export function fakeIssues(options: FakeIssuesOptions = {}): FakeIssues {
  const decisions: IssueDecision[] = [];
  const again: { app: string; problem: string }[] = [];
  const reads: string[] = [];
  const unconfirmed: (() => void)[] = [];
  const views = options.views ?? {
    [PRB_OPEN]: OPEN_ISSUE,
    [PRB_FIXING]: FIXING_ISSUE,
    [PRB_CLOSED]: closedIssue("verified"),
  };
  const source: IssuesSource = {
    list: () => Promise.resolve(options.list ?? { ok: true, value: ROWS }),
    get: (problem) => {
      reads.push(problem);
      const view = views[problem];
      return Promise.resolve(
        view === undefined
          ? { ok: false as const, code: "not_found" }
          : { ok: true as const, value: view },
      );
    },
    decide: (decision, onUnconfirmed) => {
      decisions.push(decision);
      if (onUnconfirmed !== undefined && options.decide?.ok !== false) {
        unconfirmed.push(onUnconfirmed);
      }
      return Promise.resolve(options.decide ?? { ok: true, value: true });
    },
    reportAgain: (app, problem) => {
      again.push({ app, problem });
      return Promise.resolve(options.reportAgain ?? { ok: true, value: true });
    },
  };
  return {
    source,
    decisions,
    again,
    reads,
    endDecisions: () => {
      for (const end of unconfirmed.splice(0)) end();
    },
  };
}
