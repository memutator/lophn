// 출처: AGENT.md C8 (제안), project 지침 "새 project나 project 밖의 기획은 home의 lophn에게 답을 받지 않는 call로".
// 새 앱은 home에서 등록하므로 project place의 lophn은 home의 lophn에게 넘긴다.
// 말 상대가 project place에 있으려면 project가 있어야 해서 projects-home@1을 둔다.
import {
  callCount,
  fixtureSession,
  fixtureTrial,
  sentCalls,
} from "../../checks/mod.ts";
import { relayCompleteInput } from "../../judge/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { LOPHN, LOPHN_hr, LOPHN_tax } from "./common.ts";

const REQUEST = "영수증 data를 보여 줄 앱이 있어야 할 것 같아";
const TO_HOME = { target: LOPHN, reply: "none" } as const;

const scenario: Scenario = {
  id: "C8",
  n: 4,
  proposal: true,
  world: ["projects-home@1"],
  real: [LOPHN_tax],
  steps: [say(LOPHN_tax, REQUEST), untilIdle()],
  checks: [
    callCount("call-to-home", { count: { min: 1 }, where: TO_HOME }),
    {
      kind: "judge",
      id: "relays-request",
      premise: ["call-to-home"],
      criterion: "relay-complete@1",
      input: ({ trial }) =>
        relayCompleteInput(REQUEST, sentCalls(trial, TO_HOME)[0]?.body ?? ""),
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([
        fixtureSession(LOPHN_tax, [
          {
            call: {
              to: LOPHN,
              reply: "none",
              body: "세무 project의 영수증 data를 보여 줄 새 앱이 필요해 보입니다.",
            },
          },
        ]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN_tax, [
            { call: { to: LOPHN_hr, reply: "none" } },
          ]),
        ]),
        fails: ["call-to-home"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN_tax, [{ call: { to: LOPHN, reply: "result" } }]),
        ]),
        fails: ["call-to-home"],
      },
    ],
  },
};

export default scenario;
