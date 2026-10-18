// 출처: AGENT-ROLE C9. 다른 project의 Operator는 다루지 않고 그 project의 PM에게 맡긴다.
import {
  callCount,
  fixtureSession,
  fixtureTrial,
  sentCalls,
} from "../../checks/mod.ts";
import { relayCompleteInput } from "../../judge/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { LOPHN, PM_hr, PM_tax } from "./common.ts";

const REQUEST = "인사 프로젝트에도 Operator를 만들어 줘";

const scenario: Scenario = {
  id: "C9-other",
  n: 1,
  proposal: false,
  world: ["projects-home@1"],
  real: [PM_tax],
  steps: [say(PM_tax, REQUEST), untilIdle()],
  checks: [
    callCount("call-to-hr-pm", { count: { min: 1 }, where: { target: PM_hr } }),
    {
      kind: "judge",
      id: "relays-request",
      premise: ["call-to-hr-pm"],
      criterion: "relay-complete@1",
      input: ({ trial }) =>
        relayCompleteInput(
          REQUEST,
          sentCalls(trial, { target: PM_hr })[0]?.body ?? "",
        ),
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([
        fixtureSession(PM_tax, [
          {
            call: {
              to: PM_hr,
              reply: "none",
              body: "사람이 인사 project에도 Operator를 만들어 달라고 합니다.",
            },
          },
        ]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(PM_tax, [{ call: { to: LOPHN, reply: "none" } }]),
        ]),
        fails: ["call-to-hr-pm"],
      },
      {
        trial: fixtureTrial([fixtureSession(PM_tax, [])]),
        fails: ["call-to-hr-pm"],
      },
    ],
  },
};

export default scenario;
