// 출처: roadmap eval "캘린더 단위". 새 앱 요구를 Project Manager가 알림 앱·date-range를 쓰며 만들어 켜는지 본다.
// 만든 앱은 `calendar-app`으로 save된다(뒤 단위 시작점의 후보).
import {
  addCodingCall,
  apiAnswers,
  appActive,
  askedAgainInput,
  cardCoveredInput,
  observationChecks,
  pmCallsOnlyToCodingAgent,
  reuseChecks,
} from "../../checks/app/mod.ts";
import { fixtureSession, fixtureTrial } from "../../checks/mod.ts";
import { activeApp, deliver, type Scenario, untilIdle } from "../../types.ts";
import {
  CODING,
  LOPHN,
  PM,
  pmTicketChecks,
  ticketCreate,
  ticketVerify,
} from "./common.ts";
import { APP, CARD_MVP, MVP_SCRIPT, OBSERVE, REUSE } from "./spec.ts";

const BODY = "캘린더 앱을 만들어 주세요. fixture 본문";
const lophnCall = () =>
  fixtureSession(LOPHN, [{ call: { to: PM, reply: "none", body: BODY } }]);
const pmSession = (steps: Parameters<typeof fixtureSession>[1]) =>
  addCodingCall(fixtureSession(PM, steps), APP, BODY);
const goal = "일정 추가·목록·삭제와 알림이 되는 캘린더 앱을 만든다";

const scenario: Scenario = {
  id: "calendar-mvp",
  n: 2,
  proposal: false,
  world: ["notify-app@1", "date-range@1", "calendar-call@2"],
  real: [PM, CODING],
  human: { card: CARD_MVP, approve: { activation: "allow" } },
  steps: [deliver("calendar-call"), untilIdle()],
  save: { "calendar-app": activeApp(APP) },
  checks: [
    ...pmTicketChecks(),
    pmCallsOnlyToCodingAgent("pm-calls-coding-only"),
    appActive("app-active", { app: APP }),
    apiAnswers("api-answers", { app: APP, steps: MVP_SCRIPT }),
    ...reuseChecks(REUSE),
    // store를 망가뜨리므로 program check의 맨 끝이다.
    ...observationChecks(OBSERVE),
    {
      kind: "judge",
      id: "card-covered",
      premise: ["app-active"],
      criterion: "card-covered@2",
      input: cardCoveredInput(CARD_MVP, APP),
    },
    {
      kind: "judge",
      id: "asked-again",
      premise: ["pm-ticket-created"],
      criterion: "asked-again@2",
      input: askedAgainInput(PM),
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([
        lophnCall(),
        pmSession([ticketCreate(goal), ticketVerify()]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([lophnCall(), pmSession([])]),
        fails: ["pm-ticket-created", "pm-ticket-verified"],
      },
      {
        trial: fixtureTrial([lophnCall(), pmSession([ticketCreate(goal)])]),
        fails: ["pm-ticket-verified"],
      },
      {
        trial: fixtureTrial([
          lophnCall(),
          fixtureSession(PM, [
            ticketCreate(goal),
            ticketVerify(),
            { call: { to: LOPHN, reply: "none", body: BODY } },
          ]),
        ]),
        fails: ["pm-calls-coding-only"],
      },
    ],
  },
};
export default scenario;
