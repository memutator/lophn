// 출처: roadmap eval "캘린더 단위". 심은 bug를 사람이 앱에서 보고 App Engineer에게 말하면, 원인을 읽고 고쳐 올려 같은 호출이 다시 답하는지 본다.
// callApi가 bug를 터뜨리고, 사람이 App Engineer에게 말한다. problem도 reaction도 session을 열지 않는다.
import { diagnosisChecks, rootCauseInput } from "../../checks/app/mod.ts";
import { fixtureSession, fixtureTrial, type FxStep } from "../../checks/mod.ts";
import { callApi, say, type Scenario, untilIdle } from "../../types.ts";
import { AE } from "./common.ts";
import { APP, BUG, CARD_DIAGNOSE } from "./spec.ts";

const SAY_DIAGNOSE =
  "캘린더에서 다음 주 일정을 보려고 하면 오류가 나. 고쳐 줘.";

const STATUS: FxStep = { tool: "app.status", effect: "read" };
const LOGS: FxStep = { tool: "app.logs", effect: "read" };
const INVOCATIONS: FxStep = {
  tool: "app.invocations",
  effect: "read",
  input: { app: "app_fx_캘린더", status: "failed" },
};
const EDIT: FxStep = {
  tool: "file.edit",
  effect: "write",
  input: { path: "src/events.ts", old_string: "a", new_string: "b" },
};
const REST: FxStep[] = [
  {
    tool: "shell.run",
    effect: "external",
    input: { command: "deno task test" },
  },
  { tool: "release.prepare", effect: "write" },
  { tool: "release.activate", effect: "write" },
];

const scenario: Scenario = {
  id: "calendar-diagnose",
  n: 7,
  proposal: false,
  world: ["calendar-app-bug@4"],
  real: [AE],
  limits: { idle_ms: 60 * 60_000 },
  human: { card: CARD_DIAGNOSE, approve: { activation: "allow" } },
  steps: [callApi(APP, BUG.api, BUG.input), say(AE, SAY_DIAGNOSE), untilIdle()],
  checks: [
    ...diagnosisChecks({ app: APP, bug: BUG }),
    {
      kind: "judge",
      id: "root-cause",
      premise: ["read-before-fix"],
      criterion: "root-cause@4",
      input: rootCauseInput(BUG, APP),
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([
        fixtureSession(AE, [STATUS, LOGS, INVOCATIONS, EDIT, ...REST]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(AE, [STATUS, EDIT, LOGS, INVOCATIONS, ...REST]),
        ]),
        fails: ["read-before-fix"],
      },
    ],
  },
};
export default scenario;
