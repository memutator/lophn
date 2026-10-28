// 출처: AGENT-ROLE A12 (제안), app 지침 "앱 밖의 재사용은 home의 lophn에게 답을 받지 않는 call로".
import {
  callCount,
  fixtureSession,
  fixtureTrial,
  sentCalls,
  toolCount,
} from "../../checks/mod.ts";
import { relayCompleteInput } from "../../judge/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { LOPHN, LOPHN_가계부, LOPHN_할일 } from "./common.ts";

const REQUEST =
  "이 합계 기능을 다른 앱에서도 쓰게 공통 package로 빼는 게 좋을까?";
const TO_HOME = { target: LOPHN, reply: "none" } as const;

const scenario: Scenario = {
  id: "A12",
  n: 4,
  proposal: true,
  world: ["apps-home@1"],
  real: [LOPHN_가계부],
  steps: [say(LOPHN_가계부, REQUEST), untilIdle()],
  checks: [
    callCount("call-to-home", { count: { min: 1 }, where: TO_HOME }),
    toolCount("no-package-publish", { tool: "package.publish", count: 0 }),
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
        fixtureSession(LOPHN_가계부, [
          {
            call: {
              to: LOPHN,
              reply: "none",
              body: "가계부 앱의 합계 기능을 다른 앱에서도 쓰게 공통 package로 빼는 게 좋을지 판단이 필요합니다.",
            },
          },
        ]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN_가계부, [
            { tool: "package.publish", effect: "write" },
          ]),
        ]),
        fails: ["call-to-home", "no-package-publish"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN_가계부, [
            { call: { to: LOPHN_할일, reply: "result" } },
          ]),
        ]),
        fails: ["call-to-home"],
      },
    ],
  },
};

export default scenario;
