// 출처: AGENT-ROLE L4 (제안) — 이미 있는 앱에 하는 일은 그 앱 project의 Project Manager에게 한 번 넘긴다.
import {
  callCount,
  fixtureAppCreate,
  fixtureSession,
  fixtureTrial,
  toolCount,
} from "../../checks/mod.ts";
import { relayCompleteInput } from "../../judge/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import {
  firstCallBody,
  LOPHN,
  PM_calendar,
  PM_ledger,
  PM_todo,
} from "./common.ts";

const REQUEST = "가계부 앱에 월별 지출 합계 화면을 넣고 싶어";
const BODY = `사람 요청: ${REQUEST}`;

const scenario: Scenario = {
  id: "L4-app",
  n: 2,
  proposal: true,
  world: ["apps-home@1"],
  real: [LOPHN],
  steps: [say(LOPHN, REQUEST), untilIdle()],
  checks: [
    callCount("one-call", { count: 1 }),
    callCount("to-ledger-pm-none", {
      count: 1,
      where: { target: PM_ledger, reply: "none" },
    }),
    toolCount("no-app-create", { tool: "app.create", count: 0 }),
    {
      kind: "judge",
      id: "relays-request",
      premise: ["one-call", "to-ledger-pm-none", "no-app-create"],
      criterion: "relay-complete@1",
      input: ({ trial }) => relayCompleteInput(REQUEST, firstCallBody(trial)),
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([
        fixtureSession(LOPHN, [
          { call: { to: PM_ledger, reply: "none", body: BODY } },
        ]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [
            fixtureAppCreate("캘린더", "calendar-project"),
            { call: { to: PM_calendar, reply: "none", body: BODY } },
          ]),
        ]),
        fails: ["no-app-create", "to-ledger-pm-none"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [
            { call: { to: PM_todo, reply: "none", body: BODY } },
          ]),
        ]),
        fails: ["to-ledger-pm-none"],
      },
    ],
  },
};
export default scenario;
