// 출처: AGENT-ROLE L4 (제안) 중 등록을 뺀 나머지 — 새 앱은 app.create로 만들고, 그 앱의 App Engineer에게 요구를 빠짐없이 넘긴다.
import {
  callAfterAppCreate,
  fixtureAppCreate,
  fixtureSession,
  fixtureTrial,
  toolCount,
} from "../../checks/mod.ts";
import { relayCompleteInput } from "../../judge/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { AE_가계부, AE_캘린더, firstCallBody, LOPHN } from "./common.ts";

const REQUEST =
  "캘린더 앱 만들어 줘. 일정 추가(event.add), 일정 목록(event.list), 일정 삭제(event.remove)가 있고 일정 알림도 있어야 해.";
const BODY =
  `캘린더 앱을 만든다. 요구: 일정 추가(event.add), 일정 목록(event.list), 일정 삭제(event.remove), 일정 알림.`;

const scenario: Scenario = {
  id: "L4-new",
  n: 1,
  proposal: true,
  world: ["apps-home@1"],
  real: [LOPHN],
  steps: [say(LOPHN, REQUEST), untilIdle()],
  checks: [
    toolCount("app-create-once", {
      tool: "app.create",
      count: 1,
      success: true,
    }),
    callAfterAppCreate("call-after-app-create", { reply: "none" }),
    {
      kind: "judge",
      id: "relays-request",
      premise: ["app-create-once", "call-after-app-create"],
      criterion: "relay-complete@1",
      input: ({ trial }) =>
        relayCompleteInput(REQUEST, firstCallBody(trial, { reply: "none" })),
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([
        fixtureSession(LOPHN, [
          fixtureAppCreate("캘린더"),
          { call: { to: AE_캘린더, reply: "none", body: BODY } },
        ]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [fixtureAppCreate("캘린더")]),
        ]),
        fails: ["call-after-app-create"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [
            { call: { to: AE_가계부, reply: "none", body: BODY } },
          ]),
        ]),
        fails: ["app-create-once", "call-after-app-create"],
      },
    ],
  },
};
export default scenario;
