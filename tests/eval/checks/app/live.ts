// 끝난 world(살아 있는 core)를 보는 check의 바탕.
import {
  type App,
  type AppApiOutcome,
  appCallApi,
  appList,
} from "../../../../packages/protocol/apps/mod.ts";
import {
  problemList,
  type ProblemListItem,
} from "../../../../packages/protocol/problems/mod.ts";
import type { Core } from "../../../support/core/mod.ts";
import { until } from "../../../support/core/human.ts";
import type { CheckOutcome, ProgramCheck, TrialRecord } from "../../types.ts";

// fixture에는 world가 없다. 판정 논리는 순수 함수로 갈라 test한다.
export function liveCheck(
  id: string,
  run: (core: Core, trial: TrialRecord) => Promise<CheckOutcome>,
): ProgramCheck {
  return {
    kind: "program",
    id,
    run({ trial, core }) {
      if (core === null) {
        return { pass: true, reason: "live check: fixture에서는 건너뜀" };
      }
      return run(core, trial);
    },
  };
}

export function oneLine(text: string, max = 300): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max)}...` : line;
}

export async function findApp(core: Core, name: string): Promise<App> {
  const { apps } = await core.call(appList, {});
  const found = apps.filter((a) => a.name === name && a.status !== "archived");
  if (found.length !== 1) {
    throw new Error(`앱 "${name}"이 ${found.length}개다`);
  }
  return found[0]!;
}

// route 오류는 던지고, 앱이 failed·denied·unknown으로 답한 것은 그대로 돌려준다.
export async function callApi(
  core: Core,
  app: string,
  api: string,
  input?: unknown,
): Promise<AppApiOutcome> {
  const { outcome } = await core.call(appCallApi, {
    target: { mode: "live", app: app as App["id"], release: null },
    api,
    ...(input === undefined ? {} : { input: input as never }),
    caller: { kind: "person", view_session: "eval" },
  });
  return outcome;
}

// 문제 접수는 collector worker를 거쳐 늦게 보인다. 시간이 다 되면 마지막으로 읽은 것을 돌려준다.
export async function waitProblems(
  core: Core,
  app: string,
  done: (items: ProblemListItem[]) => boolean,
  timeoutMs = 20_000,
): Promise<ProblemListItem[]> {
  let last: ProblemListItem[] = [];
  try {
    return await until("problem 목록이 달라짐", async () => {
      last = (await core.call(problemList, { app: app as App["id"] })).problems;
      return done(last) ? last : undefined;
    }, timeoutMs);
  } catch {
    return last;
  }
}

// 통과할 때까지 되풀이해 읽는다. 시간이 다 되면 마지막 결과를 돌려준다.
export async function eventually(
  read: () => Promise<CheckOutcome>,
  timeoutMs: number,
): Promise<CheckOutcome> {
  let last: CheckOutcome = { pass: false, reason: "읽지 못함" };
  try {
    return await until("check가 통과함", async () => {
      last = await read();
      return last.pass ? last : undefined;
    }, timeoutMs);
  } catch {
    return last;
  }
}
