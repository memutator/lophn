// 진단 확인: 고친 release가 켜지고, 같은 호출이 이제 기대대로 답하고, blueprint를 고쳐 덮지 않았나.
import { appGet, appRuntime } from "../../../../packages/protocol/apps/mod.ts";
import { appTools } from "../../../../packages/protocol/apps/blueprint/read.ts";
import { releasesListRecords } from "../../../../packages/protocol/apps/activation/activation.ts";
import { canonicalize } from "../../../../packages/base/mod.ts";
import type { ProgramCheck } from "../../types.ts";
import { callApi, findApp, liveCheck, oneLine } from "./live.ts";
import { exampleMatches } from "./match.ts";

export type BugSpec = {
  api: string;
  input?: unknown;
  expectAfterFix: unknown;
  files: string[];
  description: string;
};
export type DiagnoseSpec = { app: string; bug: BugSpec };

export function diagnosisChecks(spec: DiagnoseSpec): ProgramCheck[] {
  const { bug } = spec;
  return [
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
      const outcome = await callApi(core, app.id, bug.api, bug.input);
      const answered = outcome.status === "succeeded" &&
        exampleMatches(bug.expectAfterFix, outcome.result);
      return {
        pass: answered,
        reason: answered
          ? "고친 뒤 같은 호출이 기대대로 답함"
          : `고친 뒤 호출이 기대와 다름: ${
            oneLine(JSON.stringify(outcome), 200)
          }`,
      };
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
