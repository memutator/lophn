// 출처: AGENT-ROLE L8 — 앱에 붙는 Operator는 그 앱의 App Engineer에게 넘긴다.
import { callCount, fixtureSession, fixtureTrial } from "../../checks/mod.ts";
import { relayCompleteInput } from "../../judge/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { AE_가계부, AE_할일, firstCallBody, LOPHN, PM_tax } from "./common.ts";

const REQUEST = "가계부 앱에 월말 정리용 Operator를 만들어 줘";
const BODY = `가계부 앱에 월말 정리용 Operator를 만든다. 사람 요청: ${REQUEST}`;

const scenario: Scenario = {
  id: "L8",
  n: 3,
  proposal: false,
  world: ["apps-home@1", "projects-home@1"],
  real: [LOPHN],
  steps: [say(LOPHN, REQUEST), untilIdle()],
  checks: [
    callCount("call-to-gagyebu-ae", {
      count: { min: 1 },
      where: { target: AE_가계부 },
    }),
    callCount("no-other-calls", { count: 0, where: { notTarget: AE_가계부 } }),
    {
      kind: "judge",
      id: "relays-request",
      premise: ["call-to-gagyebu-ae", "no-other-calls"],
      criterion: "relay-complete@1",
      input: ({ trial }) =>
        relayCompleteInput(
          REQUEST,
          firstCallBody(trial, { target: AE_가계부 }),
        ),
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([
        fixtureSession(LOPHN, [
          { call: { to: AE_가계부, reply: "none", body: BODY } },
        ]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [
            { call: { to: PM_tax, reply: "none", body: BODY } },
          ]),
        ]),
        fails: ["call-to-gagyebu-ae", "no-other-calls"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [
            { call: { to: AE_가계부, reply: "none", body: BODY } },
            { call: { to: AE_할일, reply: "none", body: BODY } },
          ]),
        ]),
        fails: ["no-other-calls"],
      },
    ],
  },
};
export default scenario;
