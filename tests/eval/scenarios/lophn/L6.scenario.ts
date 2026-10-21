// 출처: AGENT-ROLE L6 (제안) — 제품을 묻는 말은 사용 안내 skill(`guide-*`)로 답한다. 만들거나 넘기지 않는다.
import {
  callCount,
  fixtureSession,
  fixtureTrial,
  toolCount,
} from "../../checks/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { AE_가계부, LOPHN } from "./common.ts";

const REQUEST = "Operator는 뭐고 누가 만들어?";
const readGuide = (name: string) => ({
  tool: "skill.read",
  effect: "read" as const,
  input: { name },
});

const scenario: Scenario = {
  id: "L6",
  n: 4,
  proposal: true,
  world: [],
  real: [LOPHN],
  steps: [say(LOPHN, REQUEST), untilIdle()],
  checks: [
    toolCount("read-guide", {
      tool: "skill.read",
      input: { name: "guide-roles-and-assignments" },
      count: { min: 1 },
    }),
    callCount("no-call", { count: 0 }),
    toolCount("no-app-create", { tool: "app.create", count: 0 }),
  ],
  fixtures: {
    right: [
      fixtureTrial([
        fixtureSession(LOPHN, [readGuide("guide-roles-and-assignments")]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([fixtureSession(LOPHN, [])]),
        fails: ["read-guide"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [readGuide("guide-settings")]),
        ]),
        fails: ["read-guide"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [
            readGuide("guide-roles-and-assignments"),
            { call: { to: AE_가계부, reply: "result" } },
          ]),
        ]),
        fails: ["no-call"],
      },
    ],
  },
};
export default scenario;
