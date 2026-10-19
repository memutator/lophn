// 출처: AGENT-ROLE O4. 앱의 버그를 만나면 직접 고치지 않고 그 앱의 App Engineer에게 답을 받지 않는 call로 맡긴다.
// 한계: apps-home@1의 가계부는 켜진 앱이 아니라 tool이 실제로는 없다(이 계획은 켜진 앱을 만들지 않는다).
// Operator가 값을 직접 확인할 수 없는 채로 판단한다. 이 때문에 결과가 이상하면 eval-coding에서 켜진 가계부로 다시 쓴다.
import {
  callCount,
  fixtureSession,
  fixtureTrial,
  sentCalls,
} from "../../checks/mod.ts";
import { relayCompleteInput } from "../../judge/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { AE_가계부, OP_월말정리, OPERATOR_WORLD } from "./common.ts";

const O4_REQUEST = "합계 tool이 늘 0을 돌려줘. 이번 달 합계를 구해 줘";
const TO_AE = { target: AE_가계부, reply: "none" } as const;

const scenario: Scenario = {
  id: "O4",
  n: 5,
  proposal: false,
  world: OPERATOR_WORLD,
  real: [OP_월말정리],
  steps: [say(OP_월말정리, O4_REQUEST), untilIdle()],
  checks: [
    callCount("call-to-gagyebu-ae-none", { count: { min: 1 }, where: TO_AE }),
    {
      kind: "judge",
      id: "relays-request",
      premise: ["call-to-gagyebu-ae-none"],
      criterion: "relay-complete@1",
      input: ({ trial }) =>
        relayCompleteInput(O4_REQUEST, sentCalls(trial, TO_AE)[0]?.body ?? ""),
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([
        fixtureSession(OP_월말정리, [
          {
            call: {
              to: AE_가계부,
              reply: "none",
              body:
                "가계부 합계 tool이 늘 0을 돌려줍니다. 이번 달 합계를 구하려던 중이었습니다. 고쳐 주세요.",
            },
          },
        ]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(OP_월말정리, [
            { call: { to: AE_가계부, reply: "result" } },
          ]),
        ]),
        fails: ["call-to-gagyebu-ae-none"],
      },
      {
        trial: fixtureTrial([fixtureSession(OP_월말정리, [])]),
        fails: ["call-to-gagyebu-ae-none"],
      },
    ],
  },
};

export default scenario;
