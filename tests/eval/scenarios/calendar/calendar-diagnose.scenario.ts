// 출처: roadmap eval "캘린더 단위". 심은 bug가 연 problem을 App Engineer가 읽고 원인을 고쳐 다시 나지 않게 하는지 본다.
// 사람 자격 callApi가 bug를 터뜨리면 problem이 열리고 program이 App Engineer를 부른다.
import {
  addCodingCall,
  diagnosisChecks,
  rootCauseInput,
} from "../../checks/app/mod.ts";
import { fixtureSession, fixtureTrial, toolCount } from "../../checks/mod.ts";
import { callApi, type Scenario, untilIdle } from "../../types.ts";
import {
  AE,
  CODING,
  problemGet,
  ticketCreate,
  ticketVerify,
} from "./common.ts";
import { APP, BUG, CARD_DIAGNOSE } from "./spec.ts";

const goal =
  "event.list의 next_week가 TypeError를 던진다. RANGE_RULES에 next_week를 더한다";
const aeSession = (steps: Parameters<typeof fixtureSession>[1]) =>
  addCodingCall(fixtureSession(AE, steps), APP, goal);

const [readProblem, ...liveChecks] = diagnosisChecks({ app: APP, bug: BUG });

const scenario: Scenario = {
  id: "calendar-diagnose",
  n: 5,
  proposal: false,
  world: ["calendar-app-bug@2"],
  real: [AE, CODING],
  human: { card: CARD_DIAGNOSE, approve: { activation: "allow" } },
  steps: [callApi(APP, BUG.api, BUG.input), untilIdle()],
  checks: [
    readProblem!,
    toolCount("ae-ticket-created", {
      tool: "ticket.create",
      count: { min: 1 },
    }),
    ...liveChecks,
    {
      kind: "judge",
      id: "root-cause",
      premise: ["evidence-has-problem"],
      criterion: "root-cause@3",
      input: rootCauseInput(BUG, APP),
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([
        aeSession([problemGet(), ticketCreate(goal), ticketVerify()]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([aeSession([ticketCreate(goal), ticketVerify()])]),
        fails: ["read-problem"],
      },
      {
        trial: fixtureTrial([aeSession([problemGet()])]),
        fails: ["ae-ticket-created"],
      },
    ],
  },
};
export default scenario;
