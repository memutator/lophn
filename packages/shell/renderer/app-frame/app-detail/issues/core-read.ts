// Issues 화면이 core의 GetProblem을 읽는 자리. 받는 값은 contracts의
// `getProblemUserOutputSchema`(ID 없는 `problem`과 사용자용 `detail`)이고, 아래 모양은 그 schema에서
// 이 화면이 읽는 field만 옮긴 것이다. 내부 `problem.work`·`problem.interpretation`(ticket·version ID)은
// 읽지 않는다. 담당·수리·결과·닫힘 문구는 problems가 정한 en 그대로다.
import type {
  IssueClosure,
  IssueRecorded,
  IssueStatus,
  IssueTestState,
  IssueTestSummary,
  IssueView,
} from "./source.ts";

export interface ProblemUserRead {
  problem: { id: string; status: IssueStatus };
  detail: {
    progress: { label: string };
    owner: { label: string };
    needed_action: string | null;
    repair: { label: string; needs: string[]; last_check_failed: boolean };
    result: {
      fix_report: "none" | "reported";
      fix_report_label: string;
      tests: {
        state: IssueTestSummary;
        label: string;
        items: {
          state: IssueTestState;
          label: string;
          ended_at: string | null;
        }[];
      };
      recorded?: {
        kind: IssueRecorded["kind"];
        state: IssueRecorded["state"];
        label: string;
        ended_at: string | null;
      }[];
      remaining?: string;
    };
    closed: {
      reason: IssueClosure;
      label: string;
      attention: string;
      expanded: {
        scope: string;
        unconfirmed: string[];
        release: string | null;
        evidence: { text: string; at: string | null }[];
      };
    } | null;
  };
  text: string | null;
  report_count: number;
  first_observed_at: string | null;
  last_observed_at: string | null;
  last_release: string | null;
}

/** 사용자용 GetProblem을 상세 화면 값으로 옮긴다. 증상 문구가 없으면 null이다. */
export function issueViewOf(read: ProblemUserRead): IssueView | null {
  if (read.text === null) return null;
  const { detail } = read;
  const closed = detail.closed;
  return {
    id: read.problem.id,
    status: read.problem.status,
    impact: read.text,
    seen: read.report_count,
    firstSeenAt: read.first_observed_at,
    lastSeenAt: read.last_observed_at,
    progress: detail.progress.label,
    owner: detail.owner.label,
    neededAction: detail.needed_action,
    repair: {
      label: detail.repair.label,
      needs: detail.repair.needs,
      lastCheckFailed: detail.repair.last_check_failed,
    },
    result: {
      claimed: detail.result.fix_report === "reported",
      claimLabel: detail.result.fix_report_label,
      tests: {
        state: detail.result.tests.state,
        label: detail.result.tests.label,
        items: detail.result.tests.items.map((item) => ({
          label: item.label,
          state: item.state,
          endedAt: item.ended_at,
        })),
      },
      recorded: detail.result.recorded?.map((item) => ({
        kind: item.kind,
        label: item.label,
        state: item.state,
        endedAt: item.ended_at,
      })),
      remaining: detail.result.remaining,
    },
    closed: closed === null ? null : {
      reason: closed.reason,
      label: closed.label,
      attention: closed.attention,
      scope: closed.expanded.scope,
      unconfirmed: closed.expanded.unconfirmed,
      version: closed.expanded.release,
      evidence: closed.expanded.evidence,
    },
    // 결정 선택지의 근거 유무만 본다. 결정 자체는 main이 독립 read로 다시 고정한다.
    basis: {
      versionKnown: read.last_release !== null,
      observationKnown: read.last_observed_at !== null,
    },
  };
}
