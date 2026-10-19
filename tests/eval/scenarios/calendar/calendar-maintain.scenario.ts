// 출처: roadmap eval "캘린더 단위". 일정 data가 든 켜진 앱에 기능(반복 일정)을 더해도 옛 data와 tool이 남는지 본다.
import {
  addCodingCall,
  apiAnswers,
  appActive,
  askedAgainInput,
  cardCoveredInput,
  pmCallsOnlyToCodingAgent,
  releaseAdvanced,
} from "../../checks/app/mod.ts";
import { fixtureSession, fixtureTrial } from "../../checks/mod.ts";
import { activeApp, say, type Scenario, untilIdle } from "../../types.ts";
import {
  CODING,
  LOPHN,
  PM,
  pmTicketChecks,
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
const pmSession = (steps: Parameters<typeof fixtureSession>[1]) =>
  addCodingCall(fixtureSession(PM, steps), APP, goal);

const scenario: Scenario = {
  id: "calendar-maintain",
  n: 2,
  proposal: false,
  world: ["calendar-app@1", "calendar-data@1"],
  real: [PM, CODING],
  human: { card: CARD_MAINTAIN, approve: { activation: "allow" } },
  steps: [say(PM, SAY_MAINTAIN), untilIdle()],
  save: { "calendar-app": activeApp(APP) },
  checks: [
    ...pmTicketChecks(),
    pmCallsOnlyToCodingAgent("pm-calls-coding-only"),
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
      criterion: "card-covered@2",
      input: cardCoveredInput(CARD_MAINTAIN, APP),
    },
    {
      kind: "judge",
      id: "asked-again",
      premise: ["pm-ticket-created"],
      criterion: "asked-again@2",
      input: askedAgainInput(PM, SAY_MAINTAIN),
    },
  ],
  fixtures: {
    right: [fixtureTrial([pmSession([ticketCreate(goal), ticketVerify()])])],
    wrong: [
      {
        trial: fixtureTrial([pmSession([])]),
        fails: ["pm-ticket-created", "pm-ticket-verified"],
      },
      {
        trial: fixtureTrial([pmSession([ticketCreate(goal)])]),
        fails: ["pm-ticket-verified"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(PM, [
            ticketCreate(goal),
            ticketVerify(),
            { call: { to: LOPHN, reply: "none", body: goal } },
          ]),
        ]),
        fails: ["pm-calls-coding-only"],
      },
    ],
  },
};
export default scenario;
