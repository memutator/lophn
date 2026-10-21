// 출처: roadmap eval "캘린더 단위". 일정 data가 든 켜진 앱에 기능(반복 일정)을 더해도 옛 data와 tool이 남는지 본다.
import {
  apiAnswers,
  appActive,
  askedAgainInput,
  releaseAdvanced,
} from "../../checks/app/mod.ts";
import { fixtureSession, fixtureTrial } from "../../checks/mod.ts";
import { activeApp, say, type Scenario, untilIdle } from "../../types.ts";
import { AE } from "./common.ts";
import {
  APP,
  CARD_MAINTAIN,
  OLD_SCRIPT,
  REPEAT_SCRIPT,
  RESTORED_RELEASE,
  SAY_MAINTAIN,
  SEED_CALLS,
} from "./spec.ts";

const scenario: Scenario = {
  id: "calendar-maintain",
  n: 5,
  proposal: false,
  world: ["calendar-app@2", "calendar-data@2"],
  real: [AE],
  human: { card: CARD_MAINTAIN, approve: { activation: "allow" } },
  steps: [say(AE, SAY_MAINTAIN), untilIdle()],
  save: { "calendar-app": activeApp(APP) },
  checks: [
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
      id: "asked-again",
      premise: ["release-advanced"],
      criterion: "asked-again@3",
      input: askedAgainInput(SAY_MAINTAIN),
    },
  ],
  fixtures: { right: [fixtureTrial([fixtureSession(AE, [])])], wrong: [] },
};
export default scenario;
