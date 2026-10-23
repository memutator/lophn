// 출처: roadmap eval "캘린더 단위". Operator가 켜진 캘린더의 tool로 사람 말대로 일정을 넣고 목록을 본다.
// tool 정확도는 check가 아니라 공통 수치(Metrics.tools)로 scorecard에서 읽는다.
import { appToolCalled, appToolSession } from "../../checks/app/mod.ts";
import { callCount, fixtureTrial } from "../../checks/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { AE, createCalendarOperator, eventInCalendar, OP } from "./common.ts";
import { SAY_API } from "./spec.ts";

const ADD = { tool: "domain__fx__event.add", effect: "write" } as const;
const LIST = { tool: "domain__fx__event.list" } as const;

const scenario: Scenario = {
  id: "calendar-api",
  n: 7,
  proposal: false,
  world: ["calendar-app@4"],
  setup: createCalendarOperator,
  real: [OP],
  steps: [say(OP, SAY_API), untilIdle()],
  checks: [
    appToolCalled("added", { command: "event.add" }),
    appToolCalled("listed", { command: "event.list" }),
    callCount("no-agent-calls", { count: 0 }),
    eventInCalendar,
  ],
  fixtures: {
    right: [fixtureTrial([appToolSession(OP, [ADD, LIST])])],
    wrong: [
      {
        trial: fixtureTrial([appToolSession(OP, [LIST])]),
        fails: ["added"],
      },
      {
        trial: fixtureTrial([
          appToolSession(OP, [
            ADD,
            LIST,
            { call: { to: AE, reply: "none", body: "fixture" } },
          ]),
        ]),
        fails: ["no-agent-calls"],
      },
    ],
  },
};
export default scenario;
