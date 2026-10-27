import type { ProgramCheck } from "../../types.ts";
import { exampleMatches } from "./match.ts";
import { callApi, findApp, liveCheck, oneLine } from "./live.ts";

export type ApiStep = {
  api: string;
  input?: unknown | ((prev: unknown[]) => unknown);
  // 값이면 exampleMatches, 함수이면 null을 돌려줘야 통과다(정렬이 정해지지 않은 배열 같은 것을 볼 때 쓴다).
  expect: unknown | ((result: unknown) => string | null);
};

// 정해 둔 tool 호출을 차례로 하고 첫 불일치에서 멈춘다.
export function apiAnswers(
  id: string,
  opts: { app: string; steps: ApiStep[] },
): ProgramCheck {
  return liveCheck(id, async (core) => {
    const app = await findApp(core, opts.app);
    const results: unknown[] = [];
    for (const [i, step] of opts.steps.entries()) {
      const where = `step ${i + 1} ${step.api}`;
      const input =
        typeof step.input === "function" ? step.input(results) : step.input;
      const outcome = await callApi(core, app.id, step.api, input);
      if (outcome.status !== "succeeded") {
        return {
          pass: false,
          reason: `${where}: ${outcome.status} ${oneLine(
            JSON.stringify(outcome),
            200,
          )}`,
        };
      }
      const why =
        typeof step.expect === "function"
          ? (step.expect as (r: unknown) => string | null)(outcome.result)
          : exampleMatches(step.expect, outcome.result)
            ? null
            : "결과가 기대와 다름";
      if (why !== null) {
        return {
          pass: false,
          reason: `${where}: ${why} (실제 ${oneLine(
            JSON.stringify(outcome.result),
            200,
          )})`,
        };
      }
      results.push(outcome.result);
    }
    return {
      pass: true,
      reason: `${opts.steps.length}단계 모두 기대대로 답함`,
    };
  });
}
