// 출처: AGENT-ROLE A12 (제안, 앱의 일은 Project Manager가 맡는다). 앱 밖의 재사용 판단은 lophn에게 답을 받지 않는 call로 맡긴다.
import {
  callCount,
  fixtureSession,
  fixtureTrial,
  sentCalls,
  toolCount,
} from "../../checks/mod.ts";
import { relayCompleteInput } from "../../judge/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { LOPHN, PM_ledger, PM_todo } from "./common.ts";

const REQUEST =
  "이 합계 기능을 다른 앱에서도 쓰게 공통 package로 빼는 게 좋을까?";
const TO_LOPHN = { target: LOPHN, reply: "none" } as const;

const scenario: Scenario = {
  id: "CA12",
  n: 1,
  proposal: true,
  world: ["apps-home@1"],
  real: [PM_ledger],
  steps: [say(PM_ledger, REQUEST), untilIdle()],
  checks: [
    callCount("call-to-lophn", { count: { min: 1 }, where: TO_LOPHN }),
    toolCount("no-ticket-create", { tool: "ticket.create", count: 0 }),
    toolCount("no-package-publish", { tool: "package.publish", count: 0 }),
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
        fixtureSession(PM_ledger, [
          {
            call: {
              to: LOPHN,
              reply: "none",
              body:
                "가계부 앱의 합계 기능을 다른 앱에서도 쓰게 공통 package로 빼는 게 좋을지 판단이 필요합니다.",
            },
          },
        ]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(PM_ledger, [
            { tool: "ticket.create", effect: "write" },
          ]),
        ]),
        fails: ["call-to-lophn", "no-ticket-create"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(PM_ledger, [
            { call: { to: PM_todo, reply: "result" } },
          ]),
        ]),
        fails: ["call-to-lophn"],
      },
    ],
  },
};

export default scenario;
