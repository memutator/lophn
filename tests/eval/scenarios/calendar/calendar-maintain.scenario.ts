// 출처: roadmap eval "캘린더 단위". 일정 data가 든 켜진 앱에 기능(반복 일정)을 더해도 옛 data와 tool이 남는지 본다.
// App Engineer가 바꾼다: DESIGN.md를 쓰고, test하고, release를 준비해 preview로 보고, 켠다.
import {
  apiAnswers,
  appActive,
  askedAgainInput,
  cardCoveredInput,
  releaseAdvanced,
} from "../../checks/app/mod.ts";
import { fixtureSession, fixtureTrial } from "../../checks/mod.ts";
import { activeApp, say, type Scenario, untilIdle } from "../../types.ts";
import { AE, aeFlowChecks, aeFlowSteps } from "./common.ts";
import {
  APP,
  CARD_MAINTAIN,
  OLD_SCRIPT,
  REPEAT_SCRIPT,
  RESTORED_RELEASE,
  SAY_MAINTAIN,
  SEED_CALLS,
} from "./spec.ts";

const goal = "캘린더 앱에 매주 반복하는 일정을 더한다";
const flow = aeFlowSteps(goal);

const scenario: Scenario = {
  id: "calendar-maintain",
  n: 6,
  proposal: false,
  world: ["calendar-app@3", "calendar-data@3"],
  real: [AE],
  limits: { idle_ms: 60 * 60_000 },
  human: { card: CARD_MAINTAIN, approve: { activation: "allow" } },
  steps: [say(AE, SAY_MAINTAIN), untilIdle()],
  save: { "calendar-app": activeApp(APP) },
  checks: [
    ...aeFlowChecks(),
    appActive("app-active", { app: APP }),
    releaseAdvanced("release-advanced", {
      app: APP,
      after: RESTORED_RELEASE,
    }),
    // data를 바꾸는 둘은 data-remains 뒤다.
    apiAnswers("data-remains", { app: APP, steps: SEED_CALLS }),
    apiAnswers("old-api-answers", { app: APP, steps: OLD_SCRIPT }),
    apiAnswers("repeat-works", { app: APP, steps: REPEAT_SCRIPT }),
    {
      kind: "judge",
      id: "card-covered",
      premise: ["release-advanced"],
      criterion: "card-covered@4",
      input: cardCoveredInput(CARD_MAINTAIN, APP),
    },
    {
      kind: "judge",
      id: "asked-again",
      premise: ["design-first"],
      criterion: "asked-again@3",
      input: askedAgainInput(SAY_MAINTAIN),
    },
  ],
  fixtures: {
    right: [fixtureTrial([fixtureSession(AE, flow)])],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(
            AE,
            flow.filter((s) => !("tool" in s) || s.tool !== "file.write"),
          ),
        ]),
        fails: ["design-first"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(
            AE,
            flow.filter((s) =>
              !("tool" in s) || !s.tool.startsWith("preview.")
            ),
          ),
        ]),
        fails: ["ae-previewed"],
      },
    ],
  },
};
export default scenario;
