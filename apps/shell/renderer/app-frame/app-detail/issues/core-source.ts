// IssuesSource를 main의 core 통로로 만든다(shell#T53). 응답은 main의 contract client가 route
// output schema로 이미 검사했다. 아래 모양은 ListProblems·GetProblem(`detail`)에서 이 화면이
// 읽는 field만 옮긴 것이다. 결정은 여기서 쓰지 않고 보호 창(owner decision)을 열기만 한다.
import type { CoreCall } from "../../../../ipc/core.ts";
import type { CoreSource } from "../../../desktop/connection/connection.ts";
import type {
  IssueChoice,
  IssueRow,
  IssuesSource,
  IssueStatus,
  IssueView,
  SourceResult,
} from "./source.ts";

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다. */
const PAGE_LIMIT = 10;
// 보호 창의 부모. main은 이 값이 아니라 IPC를 보낸 창을 부모로 쓴다(contracts#T13).
const PARENT_WINDOW = "requesting-window";
// main confirmation kinds/problem-decision.ts와 같은 값이다.
const CONCERN = "problems/closing";
const DECISION = "problem_decision";

/** 결정 창 열기. choice·note는 main이 독립 read로 다시 고정한다. */
export type OpenIssueDecision = (
  intent: {
    request: {
      kind: "owner_decision";
      concern: string;
      decision: string;
      targets: string[];
      choice: IssueChoice;
      note?: string;
    };
    parentWindow: string;
  },
) => Promise<unknown>;

export function windowIssueDecision(): OpenIssueDecision | undefined {
  const shell = (globalThis as {
    lophnShell?: { openConfirmation?: OpenIssueDecision };
  }).lophnShell;
  return typeof shell?.openConfirmation === "function"
    ? (intent) => shell.openConfirmation!(intent)
    : undefined;
}

async function read<T>(
  core: CoreSource,
  resource: string,
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  const kind: CoreCall["kind"] = "read";
  const reply = await core.call({ kind, resource, method, body });
  if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
  return { ok: true, value: reply.value as T };
}

interface SummaryValue {
  id: string;
  status: IssueStatus;
  symptom: string;
  next_action: string | null;
}

interface DetailValue {
  progress: { state: IssueStatus; label: string };
  owner: { label: string };
  needed_action: string | null;
  repair: { label: string; needs: string[]; last_check_failed: boolean };
  result: {
    fix_report: "none" | "reported";
    fix_report_label: string;
    tests: {
      state: IssueView["result"]["tests"]["state"];
      label: string;
      items: {
        state: IssueView["result"]["tests"]["items"][number]["state"];
        label: string;
        ended_at: string | null;
      }[];
    };
  };
  closed: {
    reason: NonNullable<IssueView["closed"]>["reason"];
    label: string;
    attention: string;
    expanded: {
      scope: string;
      unconfirmed: string[];
      release: string | null;
      evidence: { text: string; at: string | null }[];
    };
  } | null;
}

interface ProblemValue {
  problem: { id: string; app: string; status: IssueStatus };
  detail?: DetailValue;
  text: string | null;
  report_count: number;
  first_observed_at: string | null;
  last_observed_at: string | null;
}

/** core 응답을 화면 모양으로 옮긴다. detail이 없으면 사람에게 보일 상세가 없다. */
export function issueView(
  value: ProblemValue,
  activeRelease: string | null,
): IssueView | null {
  const detail = value.detail;
  if (detail === undefined) return null;
  const closed = detail.closed;
  return {
    id: value.problem.id,
    status: value.problem.status,
    impact: value.text ?? detail.progress.label,
    seen: value.report_count,
    firstSeenAt: value.first_observed_at,
    lastSeenAt: value.last_observed_at,
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
    basis: {
      versionKnown: activeRelease !== null,
      observationKnown: value.report_count > 0,
    },
  };
}

export function coreIssuesSource(
  core: CoreSource,
  open?: OpenIssueDecision,
): IssuesSource {
  return {
    async list(app) {
      const rows: IssueRow[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < PAGE_LIMIT; page += 1) {
        const result = await read<
          { problems: SummaryValue[]; next_cursor: string | null }
        >(
          core,
          "problems",
          "list",
          cursor === undefined ? { app } : { app, cursor },
        );
        if (!result.ok) return result;
        for (const item of result.value.problems) {
          rows.push({
            id: item.id,
            status: item.status,
            impact: item.symptom,
            nextAction: item.next_action,
          });
        }
        if (result.value.next_cursor === null) break;
        cursor = result.value.next_cursor;
      }
      return { ok: true, value: rows };
    },
    async get(problem) {
      const found = await read<ProblemValue>(core, "problems", "get", {
        problem,
      });
      if (!found.ok) return found;
      const app = await read<{ app: { active_release: string | null } }>(
        core,
        "apps",
        "get",
        { app: found.value.problem.app },
      );
      if (!app.ok) return app;
      const view = issueView(found.value, app.value.app.active_release);
      return view === null
        ? { ok: false, code: "unavailable" }
        : { ok: true, value: view };
    },
    async decide({ problem, choice, note }) {
      if (open === undefined) return { ok: false, code: "unavailable" };
      try {
        await open({
          request: {
            kind: "owner_decision",
            concern: CONCERN,
            decision: DECISION,
            targets: [problem],
            choice,
            ...(choice === "dismiss" && note !== null ? { note } : {}),
          },
          parentWindow: PARENT_WINDOW,
        });
        return { ok: true, value: true };
      } catch {
        return { ok: false, code: "unavailable" };
      }
    },
    // 보기 세션은 앱 공간만 안다. 앱 공간이 이 자리를 feedback begin으로 바꿔 끼운다.
    reportAgain() {
      return Promise.resolve({ ok: false, code: "unavailable" });
    },
  };
}
