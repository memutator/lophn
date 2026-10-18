// 출처: roadmap eval "캘린더 단위". 일정 data가 든 켜진 앱에 기능(반복 일정)을 더해도 옛 data와 app-api가 남는지 본다.
import {
  addCodingCall,
  aeCallsOnlyToCodingAgent,
  apiAnswers,
  appActive,
  askedAgainInput,
  cardCoveredInput,
  releaseAdvanced,
} from "../../checks/app/mod.ts";
import { fixtureSession, fixtureTrial } from "../../checks/mod.ts";
import { activeApp, say, type Scenario, untilIdle } from "../../types.ts";
import {
  AE,
  aeTicketChecks,
  CODING,
  LOPHN,
  ticketCreate,
  ticketVerify,
} from "./common.ts";
import {
  APP,
  CARD_MAINTAIN,
  OLD_SCRIPT,
  REPEAT_SCRIPT,
  RESTORED_RELEASE,
  SAY_MAINTAIN,
  SEED_CALLS,
} from "./spec.ts";

const goal = "event.add에 repeat 입력을 더해 weekly이면 4번 나타나게 한다";
const aeSession = (steps: Parameters<typeof fixtureSession>[1]) =>
  addCodingCall(fixtureSession(AE, steps), APP, goal);

const scenario: Scenario = {
  id: "calendar-maintain",
  n: 1,
  proposal: false,
  world: ["calendar-app@1", "calendar-data@1"],
  real: [AE, CODING],
  human: { card: CARD_MAINTAIN, approve: { activation: "allow" } },
  steps: [say(AE, SAY_MAINTAIN), untilIdle()],
  save: { "calendar-app": activeApp(APP) },
  checks: [
    ...aeTicketChecks(),
    aeCallsOnlyToCodingAgent("ae-calls-coding-only"),
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
      criterion: "card-covered@1",
      input: cardCoveredInput(CARD_MAINTAIN, APP),
    },
    {
      kind: "judge",
      id: "asked-again",
      premise: ["ae-ticket-created"],
      criterion: "asked-again@1",
      input: askedAgainInput(APP, SAY_MAINTAIN),
    },
  ],
  fixtures: {
    right: [fixtureTrial([aeSession([ticketCreate(goal), ticketVerify()])])],
    wrong: [
      {
        trial: fixtureTrial([aeSession([])]),
        fails: ["ae-ticket-created", "ae-ticket-verified"],
      },
      {
        trial: fixtureTrial([aeSession([ticketCreate(goal)])]),
        fails: ["ae-ticket-verified"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(AE, [
            ticketCreate(goal),
            ticketVerify(),
            { call: { to: LOPHN, reply: "none", body: goal } },
          ]),
        ]),
        fails: ["ae-calls-coding-only"],
      },
    ],
  },
};
export default scenario;
