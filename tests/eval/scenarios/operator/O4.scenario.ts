// 출처: AGENT-ROLE O4. 앱의 버그를 만나면 직접 고치지 않고 그 앱의 App Engineer에게 답을 받지 않는 call로 맡긴다.
// world는 calendar-app-bug@3다: 돌고 있는 캘린더에서 event.list의 next_week가 틀린 결과(오류)를 낸다. Operator는 그 앱 place에 있어
// 앱 tool을 직접 불러 확인할 수 있다. 사람 말이 다음 주 목록을 달라고 해서 틀린 값을 드러낸다.
// 심은 bug가 calendar 앱에 있어 calendar 폴더의 helper(AE, OP, createCalendarOperator)를 쓴다. scenarioHash는 이 폴더만 묶으므로 그 helper를 고치는 사람은 O4의 n도 올려야 한다.
import {
  callCount,
  fixtureSession,
  fixtureTrial,
  sentCalls,
} from "../../checks/mod.ts";
import { relayCompleteInput } from "../../judge/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { AE, createCalendarOperator, OP } from "../calendar/common.ts";

const O4_REQUEST =
  "캘린더 앱에서 다음 주 일정을 보려고 하면 늘 이상해. 다음 주 일정이 뭐 있는지 알려 줘";
const TO_AE = { target: AE, reply: "none" } as const;

const scenario: Scenario = {
  id: "O4",
  n: 8,
  proposal: false,
  world: ["calendar-app-bug@4"],
  setup: createCalendarOperator,
  real: [OP],
  steps: [say(OP, O4_REQUEST), untilIdle()],
  checks: [
    callCount("call-to-calendar-ae-none", { count: { min: 1 }, where: TO_AE }),
    {
      kind: "judge",
      id: "relays-request",
      premise: ["call-to-calendar-ae-none"],
      criterion: "relay-complete@1",
      input: ({ trial }) =>
        relayCompleteInput(O4_REQUEST, sentCalls(trial, TO_AE)[0]?.body ?? ""),
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([
        fixtureSession(OP, [
          {
            call: {
              to: AE,
              reply: "none",
              body:
                "캘린더 event.list의 next_week가 오류를 냅니다. 다음 주 일정을 알려 주려던 중이었습니다. 고쳐 주세요.",
            },
          },
        ]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(OP, [
            { call: { to: AE, reply: "result" } },
          ]),
        ]),
        fails: ["call-to-calendar-ae-none"],
      },
      {
        trial: fixtureTrial([fixtureSession(OP, [])]),
        fails: ["call-to-calendar-ae-none"],
      },
    ],
  },
};

export default scenario;
