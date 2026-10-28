// 출처: AGENT.md L4 (제안). 이미 있는 앱에 하는 일은 그 앱 place의 lophn에게 답을 받지 않는 call로 한 번 넘긴다
// (remove-role README "domain 일을 받는 쪽은 주인 그릇 place의 lophn session").
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
  LOPHN_가계부,
  LOPHN_캘린더,
  LOPHN_할일,
} from "./common.ts";

const REQUEST = "가계부 앱에 월별 지출 합계 화면을 넣고 싶어";
const BODY = `사람 요청: ${REQUEST}`;

const scenario: Scenario = {
  id: "L4-app",
  n: 5,
  proposal: true,
  world: ["apps-home@1"],
  real: [LOPHN],
  steps: [say(LOPHN, REQUEST), untilIdle()],
  checks: [
    callCount("one-call", { count: 1 }),
    callCount("to-gagyebu-none", {
      count: 1,
      where: { target: LOPHN_가계부, reply: "none" },
    }),
    toolCount("no-app-create", { tool: "app.create", count: 0 }),
    {
      kind: "judge",
      id: "relays-request",
      premise: ["one-call", "to-gagyebu-none", "no-app-create"],
      criterion: "relay-complete@1",
      input: ({ trial }) => relayCompleteInput(REQUEST, firstCallBody(trial)),
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([
        fixtureSession(LOPHN, [
          { call: { to: LOPHN_가계부, reply: "none", body: BODY } },
        ]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [
            fixtureAppCreate("캘린더"),
            { call: { to: LOPHN_캘린더, reply: "none", body: BODY } },
          ]),
        ]),
        fails: ["no-app-create", "to-gagyebu-none"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [
            { call: { to: LOPHN_할일, reply: "none", body: BODY } },
          ]),
        ]),
        fails: ["to-gagyebu-none"],
      },
    ],
  },
};
export default scenario;
