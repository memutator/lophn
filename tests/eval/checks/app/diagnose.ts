// 진단 확인: problem을 읽고, ticket에 붙이고, 고친 뒤 다시 안 나나. 원인을 짚었나의 뜻은 judge `root-cause@2`이 본다.
import {
  type App,
  appGet,
  appRuntime,
} from "../../../../packages/protocol/apps/mod.ts";
import { appTools } from "../../../../packages/protocol/apps/blueprint/read.ts";
import { releasesListRecords } from "../../../../packages/protocol/apps/activation/activation.ts";
import { canonicalize } from "../../../../packages/base/mod.ts";
import { problemGet } from "../../../../packages/protocol/problems/mod.ts";
import type { Core } from "../../../support/core/mod.ts";
import type { CheckOutcome, ProgramCheck } from "../../types.ts";
import { readProblem } from "./calls.ts";
import { callApi, findApp, liveCheck, oneLine } from "./live.ts";
import { exampleMatches } from "./match.ts";
import { appProblems, filesOf, problemTickets } from "./tickets.ts";

export type BugSpec = {
  api: string;
  input?: unknown;
  expectAfterFix: unknown;
  files: string[];
  description: string;
};
export type DiagnoseSpec = { app: string; bug: BugSpec };

type Snap = {
  id: string;
  name: string;
  occurrence_count: number;
  recurred: unknown | null;
};

// 고친 뒤 같은 호출이 새 problem을 열거나, 발생 수를 늘리거나, 해결됨 problem을 다시 열면(recurred) 떨어진다.
export function decideNoRecurrence(
  before: Snap[],
  after: Snap[],
): CheckOutcome {
  const count = new Map(before.map((p) => [p.id, p.occurrence_count]));
  const opened = after.filter((p) => !count.has(p.id));
  const grown = after.filter((p) =>
    count.has(p.id) && p.occurrence_count > count.get(p.id)!
  );
  const reopened = after.filter((p) => p.recurred !== null);
  const names = (items: Snap[]) => items.map((p) => `"${p.name}"`).join(", ");
  const why = [
    opened.length > 0 ? `새 problem ${names(opened)}` : "",
    grown.length > 0 ? `발생 수 늘어남 ${names(grown)}` : "",
    reopened.length > 0 ? `다시 열림 ${names(reopened)}` : "",
  ].filter((s) => s !== "");
  return {
    pass: why.length === 0,
    reason: why.length === 0 ? "다시 나지 않음" : why.join(", "),
  };
}

async function snapshot(core: Core, app: App["id"]): Promise<Snap[]> {
  const items = await appProblems(core, app);
  return await Promise.all(items.map(async (p) => {
    const { problem, occurrence_count } = await core.call(problemGet, {
      problem: p.id,
    });
    return {
      id: p.id,
      name: p.name,
      occurrence_count,
      recurred: problem.recurred,
    };
  }));
}

export function diagnosisChecks(spec: DiagnoseSpec): ProgramCheck[] {
  const { bug } = spec;
  return [
    readProblem("read-problem"),
    liveCheck("evidence-has-problem", async (core) => {
      const app = await findApp(core, spec.app);
      const tickets = await problemTickets(core, app.id);
      return {
        pass: tickets.length > 0,
        reason: `problem을 근거로 붙인 ticket ${tickets.length}개`,
      };
    }),
    liveCheck("ticket-points-at-bug", async (core) => {
      const app = await findApp(core, spec.app);
      const tickets = await problemTickets(core, app.id);
      const hit = tickets.find((t) =>
        t.goal.includes(bug.api) ||
        filesOf(t).some((f) => bug.files.some((b) => f.endsWith(b)))
      );
      return {
        pass: hit !== undefined,
        reason: hit === undefined
          ? `ticket ${tickets.length}개 중 ${bug.api}나 ${
            bug.files.join(", ")
          }를 가리키는 것이 없음`
          : `ticket ${hit.id}이 bug를 가리킴`,
      };
    }),
    liveCheck("fixed-release-active", async (core) => {
      const app = await findApp(core, spec.app);
      const { releases } = await core.call(releasesListRecords, {
        app: app.id,
      });
      const sorted = [...releases].sort((a, b) => a.number - b.number);
      const active = sorted.find((r) => r.status === "active");
      const first = sorted[0];
      const runtime = await core.call(appRuntime, { app: app.id });
      const seen = runtime.observation;
      const up = runtime.state.state === "running" && seen !== null &&
        seen.ready && seen.accepting;
      const pass = active !== undefined && active.number >= 2 &&
        first?.status === "superseded" && up;
      return {
        pass,
        reason: `release ${
          sorted.map((r) => `${r.number}:${r.status}`).join(" ")
        }, runtime ${runtime.state.state}${up ? " ready" : ""}`,
      };
    }),
    liveCheck("no-recurrence", async (core) => {
      const app = await findApp(core, spec.app);
      const before = await snapshot(core, app.id);
      const outcome = await callApi(core, app.id, bug.api, bug.input);
      const answered = outcome.status === "succeeded" &&
        exampleMatches(bug.expectAfterFix, outcome.result);
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const after = decideNoRecurrence(
        before,
        await snapshot(core, app.id),
      );
      if (!answered) {
        return {
          pass: false,
          reason: `고친 뒤 호출이 기대와 다름: ${
            oneLine(JSON.stringify(outcome), 200)
          }`,
        };
      }
      return after;
    }),
    // blueprint를 고쳐 문제를 덮지 않았다: 옛 release의 tool이 모두 남고 bug.api의 effect와 input이 같다.
    liveCheck("blueprint-kept", async (core) => {
      const app = await findApp(core, spec.app);
      const { app: got } = await core.call(appGet, { app: app.id });
      const { releases } = await core.call(releasesListRecords, {
        app: app.id,
      });
      const sorted = [...releases].sort((a, b) => a.number - b.number);
      const first = sorted[0];
      if (first === undefined || got.active_release === null) {
        return { pass: false, reason: "release가 없음" };
      }
      let old;
      try {
        old = await core.call(appTools, { app: app.id, release: first.id });
      } catch (e) {
        return {
          pass: false,
          reason: `옛 release ${first.number}의 blueprint를 못 읽음: ${
            e instanceof Error ? oneLine(e.message, 200) : String(e)
          }`,
        };
      }
      const now = await core.call(appTools, {
        app: app.id,
        release: got.active_release,
      });
      const names = new Set(now.tools.map((a) => a.name));
      const lost = old.tools.filter((a) => !names.has(a.name)).map((a) =>
        a.name
      );
      const shape = (items: typeof old.tools) => {
        const a = items.find((x) => x.name === bug.api);
        return a === undefined
          ? null
          : canonicalize({ effect: a.effect, input: a.inputSchema });
      };
      const sameShape = shape(old.tools) !== null &&
        shape(old.tools) === shape(now.tools);
      return {
        pass: lost.length === 0 && sameShape,
        reason: lost.length > 0
          ? `사라진 tool: ${lost.join(", ")}`
          : sameShape
          ? "tool이 모두 남고 bug api의 effect와 input이 같음"
          : `${bug.api}의 effect나 input이 바뀜`,
      };
    }),
  ];
}
