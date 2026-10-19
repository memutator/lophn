// 출처: roadmap eval "캘린더 단위". Operator가 켜진 캘린더의 app-api로 사람 말대로 일정을 넣고 목록을 본다.
// app-api tool 정확도는 check가 아니라 공통 수치(Metrics.tools)로 scorecard에서 읽는다.
import {
  appApiCalled,
  appApiOrder,
  appApiSession,
} from "../../checks/app/mod.ts";
import { callCount, fixtureTrial } from "../../checks/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { createCalendarOperator, eventInCalendar, OP, PM } from "./common.ts";
import { SAY_API } from "./spec.ts";

const ADD = { tool: "app__fx__event.add", effect: "write" } as const;
const LIST = { tool: "app__fx__event.list" } as const;

const scenario: Scenario = {
  id: "calendar-api",
  n: 2,
  proposal: false,
  world: ["calendar-app@1"],
  setup: createCalendarOperator,
  real: [OP],
  steps: [say(OP, SAY_API), untilIdle()],
  checks: [
    appApiCalled("added", { command: "event.add" }),
    appApiCalled("listed", { command: "event.list" }),
    appApiOrder("list-after-add", { first: "event.add", then: "event.list" }),
    callCount("no-agent-calls", { count: 0 }),
    eventInCalendar,
  ],
  fixtures: {
    right: [fixtureTrial([appApiSession(OP, [ADD, LIST])])],
    wrong: [
      {
        trial: fixtureTrial([appApiSession(OP, [LIST])]),
        fails: ["added", "list-after-add"],
      },
      {
        trial: fixtureTrial([appApiSession(OP, [LIST, ADD])]),
        fails: ["list-after-add"],
      },
      {
        trial: fixtureTrial([
          appApiSession(OP, [
            ADD,
            LIST,
            { call: { to: PM, reply: "none", body: "fixture" } },
          ]),
        ]),
        fails: ["no-agent-calls"],
      },
    ],
  },
};
export default scenario;
