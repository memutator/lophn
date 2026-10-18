// 출처: AGENT-ROLE L1 (제안) — 요구가 모호하면 만들거나 넘기기 전에 사람에게 빠진 결정을 묻는다.
import {
  callCount,
  fixtureAppCreate,
  fixtureSession,
  fixtureTrial,
  toolCount,
} from "../../checks/mod.ts";
import { asksGapInput } from "../../judge/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { askedQuestions, LOPHN } from "./common.ts";

const REQUEST = "가계부 비슷한 걸 만들고 싶은데 아직 잘 모르겠어";

const scenario: Scenario = {
  id: "L1",
  n: 1,
  proposal: true,
  world: [],
  real: [LOPHN],
  steps: [say(LOPHN, REQUEST), untilIdle()],
  checks: [
    toolCount("asked", { tool: "ask", count: { min: 1 } }),
    toolCount("no-app-create", { tool: "app.create", count: 0 }),
    callCount("no-call", { count: 0 }),
    {
      kind: "judge",
      id: "asks-gap",
      premise: ["asked", "no-app-create", "no-call"],
      criterion: "asks-gap@1",
      input: ({ trial }) => asksGapInput(REQUEST, askedQuestions(trial)),
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([
        fixtureSession(LOPHN, [{
          tool: "ask",
          effect: "read",
          input: {
            questions: [{
              question: "무엇을 기록하고 싶으세요?",
              header: "기록 대상",
              options: [
                { label: "지출", description: "쓴 돈을 기록한다" },
                {
                  label: "수입과 지출",
                  description: "들어오고 나간 돈을 모두 기록한다",
                },
              ],
              multiSelect: false,
            }],
          },
        }]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [fixtureAppCreate("가계부2")]),
        ]),
        fails: ["asked", "no-app-create"],
      },
      {
        trial: fixtureTrial([fixtureSession(LOPHN, [])]),
        fails: ["asked"],
      },
    ],
  },
};
export default scenario;
