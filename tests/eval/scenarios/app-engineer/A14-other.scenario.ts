// 출처: AGENT-ROLE A14. 다른 앱의 Operator는 다루지 않고 그 앱의 App Engineer에게 맡긴다.
// operator.create가 앱 밖 Operator에게는 막히므로 그 횟수는 재지 않는다.
import {
  callCount,
  fixtureSession,
  fixtureTrial,
  sentCalls,
} from "../../checks/mod.ts";
import { relayCompleteInput } from "../../judge/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { AE_가계부, AE_할일, LOPHN } from "./common.ts";

const REQUEST = "할일 앱에도 월말 Operator를 만들어 줘";

const scenario: Scenario = {
  id: "A14-other",
  n: 1,
  proposal: false,
  world: ["apps-home@1"],
  real: [AE_가계부],
  steps: [say(AE_가계부, REQUEST), untilIdle()],
  checks: [
    callCount("call-to-todo-ae", {
      count: { min: 1 },
      where: { target: AE_할일 },
    }),
    {
      kind: "judge",
      id: "relays-request",
      premise: ["call-to-todo-ae"],
      criterion: "relay-complete@1",
      input: ({ trial }) =>
        relayCompleteInput(
          REQUEST,
          sentCalls(trial, { target: AE_할일 })[0]?.body ?? "",
        ),
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([
        fixtureSession(AE_가계부, [
          {
            call: {
              to: AE_할일,
              reply: "none",
              body: "사람이 할일 앱에도 월말 Operator를 만들어 달라고 합니다.",
            },
          },
        ]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(AE_가계부, [{ call: { to: LOPHN, reply: "none" } }]),
        ]),
        fails: ["call-to-todo-ae"],
      },
      {
        trial: fixtureTrial([fixtureSession(AE_가계부, [])]),
        fails: ["call-to-todo-ae"],
      },
    ],
  },
};

export default scenario;
