// 출처: AGENT-ROLE C8 (제안). 새 project나 앱이 필요하다고 판단하면 lophn에게 답을 받지 않는 call로 맡긴다.
// 말 상대인 PM이 있으려면 project가 있어야 해서 projects-home@1을 둔다.
import {
  callCount,
  fixtureSession,
  fixtureTrial,
  sentCalls,
} from "../../checks/mod.ts";
import { relayCompleteInput } from "../../judge/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { LOPHN, PM_hr, PM_tax } from "./common.ts";

const REQUEST = "영수증 data를 보여 줄 앱이 있어야 할 것 같아";
const TO_LOPHN = { target: LOPHN, reply: "none" } as const;

const scenario: Scenario = {
  id: "C8",
  n: 1,
  proposal: true,
  world: ["projects-home@1"],
  real: [PM_tax],
  steps: [say(PM_tax, REQUEST), untilIdle()],
  checks: [
    callCount("call-to-lophn", { count: { min: 1 }, where: TO_LOPHN }),
    {
      kind: "judge",
      id: "relays-request",
      premise: ["call-to-lophn"],
      criterion: "relay-complete@1",
      input: ({ trial }) =>
        relayCompleteInput(REQUEST, sentCalls(trial, TO_LOPHN)[0]?.body ?? ""),
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([
        fixtureSession(PM_tax, [
          {
            call: {
              to: LOPHN,
              reply: "none",
              body:
                "세무 project의 영수증 data를 보여 줄 새 앱이 필요해 보입니다.",
            },
          },
        ]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(PM_tax, [{ call: { to: PM_hr, reply: "none" } }]),
        ]),
        fails: ["call-to-lophn"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(PM_tax, [{ call: { to: LOPHN, reply: "result" } }]),
        ]),
        fails: ["call-to-lophn"],
      },
    ],
  },
};

export default scenario;
