// 출처: AGENT-ROLE O6. kind 파일을 바꿔야 하면 직접 고치지 않고 Project Manager에게 call로 맡긴다(답 방식은 정하지 않는다).
import {
  callCount,
  fixtureSession,
  fixtureTrial,
  sentCalls,
} from "../../checks/mod.ts";
import { relayCompleteInput } from "../../judge/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import {
  AE_가계부,
  LOPHN,
  OP_세무정리,
  OPERATOR_WORLD,
  PM_tax,
} from "./common.ts";

const REQUEST =
  "영수증 kind에 '공급자' 칸이 필요한데 kinds.yaml에 없네. 일은 계속해 줘";

const scenario: Scenario = {
  id: "O6",
  n: 6,
  proposal: false,
  world: OPERATOR_WORLD,
  real: [OP_세무정리],
  steps: [say(OP_세무정리, REQUEST), untilIdle()],
  checks: [
    callCount("call-to-tax-pm", {
      count: { min: 1 },
      where: { target: PM_tax },
    }),
    {
      kind: "judge",
      id: "relays-request",
      premise: ["call-to-tax-pm"],
      criterion: "relay-complete@1",
      input: ({ trial }) =>
        relayCompleteInput(
          REQUEST,
          sentCalls(trial, { target: PM_tax })[0]?.body ?? "",
        ),
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([
        fixtureSession(OP_세무정리, [
          {
            call: {
              to: PM_tax,
              reply: "result",
              body:
                "영수증 kind에 '공급자' 칸이 없습니다. 칸을 더해 주세요. 저는 그동안 일을 계속합니다.",
            },
          },
        ]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(OP_세무정리, [
            { call: { to: AE_가계부, reply: "none" } },
          ]),
        ]),
        fails: ["call-to-tax-pm"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(OP_세무정리, [{ call: { to: LOPHN, reply: "none" } }]),
        ]),
        fails: ["call-to-tax-pm"],
      },
    ],
  },
};

export default scenario;
