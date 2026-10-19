// 출처: AGENT-ROLE L4 (제안) 중 등록을 뺀 나머지 — 새 앱은 빈 project를 골라 app.create로 만들고, 그 project의 Project Manager에게 요구를 빠짐없이 넘긴다.
import {
  callAfterAppCreate,
  fixtureAppCreate,
  fixtureSession,
  fixtureTrial,
  toolCount,
} from "../../checks/mod.ts";
import { relayCompleteInput } from "../../judge/mod.ts";
import { say, type Scenario, sentCall, untilIdle } from "../../types.ts";
import { firstCallBody, LOPHN, PM_calendar, PM_notify } from "./common.ts";

// 산출물 call이 calendar-call의 후보가 되어 calendar-mvp의 apiAnswers가 그 call로 만든 앱을 부르므로,
// 사람 말에 app-api key와 입력·출력이 있어야 lophn이 옮길 수 있다. 알림 앱·package, 알림 시각, 주의 정의는 일부러 쓰지 않는다.
const API =
  `- event.add (쓰기). 입력 { title: 문자열, start: { year, month, day, hour, minute } } 다섯 칸은 모두 정수야. 출력 { id, title, start } 이고 start는 "YYYY-MM-DDTHH:mm" 문자열이야.
- event.list (읽기). 입력 { range?: "this_week" | "next_week" | "all" }, 주지 않으면 all이야. 출력은 { id, title, start } 행의 목록이고 start가 빠른 순이야.
- event.remove (쓰기). 입력 { id: 정수 }. 출력 { id, removed: true 또는 false }.`;
const REQUEST =
  `캘린더 앱 만들어 줘. 일정을 넣고, 목록으로 보고, 지우고, 일정 전에 알림도 받고 싶어. app-api는 이 key와 입력·출력으로 만들어 줘. 시각은 쓰는 사람의 지역 시각이야.\n${API}`;
const BODY =
  `캘린더 앱을 만든다. 사람이 원하는 것: 일정을 넣고, 목록으로 보고, 지우고, 일정 전에 알림을 받는 것. app-api는 아래 key와 입력·출력으로 만든다. 시각은 쓰는 사람의 지역 시각이다.\n${API}`;

const scenario: Scenario = {
  id: "L4-new",
  n: 3,
  proposal: true,
  world: ["notify-app@1", "date-range@1", "calendar-home@1"],
  real: [LOPHN],
  steps: [say(LOPHN, REQUEST), untilIdle()],
  save: { "calendar-call": sentCall("캘린더") },
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
          fixtureAppCreate("캘린더", "calendar-project"),
          { call: { to: PM_calendar, reply: "none", body: BODY } },
        ]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [
            fixtureAppCreate("캘린더", "calendar-project"),
          ]),
        ]),
        fails: ["call-after-app-create"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [
            { call: { to: PM_notify, reply: "none", body: BODY } },
          ]),
        ]),
        fails: ["app-create-once", "call-after-app-create"],
      },
    ],
  },
};
export default scenario;
