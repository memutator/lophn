// IssuesSource를 main의 core 통로로 만든다. 응답은 main의 contract client가 route
// output schema로 이미 검사했다. 아래 모양은 ListProblems·GetProblem(`detail`)에서 이 화면이
// 읽는 field만 옮긴 것이다. 결정은 여기서 쓰지 않고 보호 창(owner decision)을 열기만 한다.
import type { CoreCall } from "../../../../ipc/core.ts";
import type { CoreSource } from "../../../desktop/connection/connection.ts";
import {
  decisionEnds,
  type SubscribeEnded,
  windowEnded,
} from "../decision-end.ts";
import { issueViewOf, type ProblemUserRead } from "./core-read.ts";
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
// 보호 창의 부모. main은 이 값이 아니라 IPC를 보낸 창을 부모로 쓴다.
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

/** GetProblem 응답: 화면이 읽는 사용자용 field(`ProblemUserRead`)에 이 앱 ID가 더 붙는다. */
type ProblemValue = Omit<ProblemUserRead, "detail"> & {
  problem: ProblemUserRead["problem"] & { app: string };
  detail?: ProblemUserRead["detail"];
};

/**
 * core 응답을 화면 모양으로 옮긴다. 옮기는 일은 `issueViewOf`(core-read.ts) 하나이고 여기서는 결정
 * 선택지의 근거만 고친다: 고쳐졌음·현상이 안 보임은 그 문제가 마지막으로 본 release가 아니라 지금
 * 쓰는 release를 기준으로 하므로(보호 창 main kind가 같은 기준으로 다시 읽는다) 활성 release로 정한다.
 * detail이 없는 이전 응답이나 증상 문구가 없는 문제는 보일 상세가 없다.
 */
export function issueView(
  value: ProblemValue,
  activeRelease: string | null,
): IssueView | null {
  if (value.detail === undefined) return null;
  const view = issueViewOf({ ...value, detail: value.detail });
  if (view === null) return null;
  return {
    ...view,
    basis: { ...view.basis, versionKnown: activeRelease !== null },
  };
}

export function coreIssuesSource(
  core: CoreSource,
  open?: OpenIssueDecision,
  subscribeEnded: SubscribeEnded | undefined = windowEnded(),
): IssuesSource {
  const ends = decisionEnds(subscribeEnded);
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
    async decide({ problem, choice, note }, onUnconfirmed) {
      if (open === undefined) return { ok: false, code: "unavailable" };
      try {
        const opened = await open({
          request: {
            kind: "owner_decision",
            concern: CONCERN,
            decision: DECISION,
            targets: [problem],
            choice,
            ...(choice === "dismiss" && note !== null ? { note } : {}),
          },
          parentWindow: PARENT_WINDOW,
        }) as { windowId?: unknown; code?: unknown } | undefined;
        if (typeof opened?.code === "string") {
          return { ok: false, code: opened.code };
        }
        if (typeof opened?.windowId === "string") {
          ends.watch(opened.windowId, onUnconfirmed);
        }
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
