// 출처: AGENT-ROLE L4 (제안) 중 등록을 뺀 나머지 — 새 앱은 `app.create`로 만들고(project를 고르지 않는다. 앱 이름의 domain이 같이 생긴다) 그 앱의 App Engineer에게 요구를 빠짐없이 넘긴다.
import {
  callAfterAppCreate,
  fixtureAppCreate,
  fixtureSession,
  fixtureTrial,
  toolCount,
} from "../../checks/mod.ts";
import { relayCompleteInput } from "../../judge/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { AE_알림, AE_캘린더, firstCallBody, LOPHN, PM_tax } from "./common.ts";

// 사람은 개발자가 아니다. tool 이름이나 입력·출력 없이 원하는 것만 말한다. 알림 앱·package, 알림 시각, 주의 정의는 일부러 쓰지 않는다.
const REQUEST =
  "캘린더 앱 하나 만들어 줘. 일정을 넣어 두고, 한눈에 보고, 필요 없으면 지울 수 있었으면 좋겠어. 일정 시작하기 전에 알려 주기도 하고.";
const BODY =
  "캘린더 앱을 만든다. 사람이 원하는 것: 일정을 넣어 두고, 한눈에 보고, 필요 없으면 지우는 것. 일정 시작 전에 알림을 받는 것.";

const scenario: Scenario = {
  id: "L4-new",
  n: 8,
  proposal: true,
  world: ["notify-app@4", "date-range@4"],
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
            { call: { to: PM_tax, reply: "none", body: BODY } },
          ]),
        ]),
        fails: ["app-create-once", "call-after-app-create"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [
            fixtureAppCreate("캘린더"),
            { call: { to: AE_알림, reply: "none", body: BODY } },
          ]),
        ]),
        fails: ["call-after-app-create"],
      },
    ],
  },
};
export default scenario;
