// 출처: AGENT-ROLE L6 (제안) — 제품을 묻는 말은 guide를 읽고 답한다. 만들거나 넘기지 않는다.
import {
  callCount,
  fixtureSession,
  fixtureTrial,
  toolCount,
} from "../../checks/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { LOPHN, PM_ledger } from "./common.ts";

const REQUEST = "Operator는 뭐고 누가 만들어?";

const scenario: Scenario = {
  id: "L6",
  n: 2,
  proposal: true,
  world: [],
  real: [LOPHN],
  steps: [say(LOPHN, REQUEST), untilIdle()],
  checks: [
    toolCount("read-guide", { tool: "guide.read", count: { min: 1 } }),
    callCount("no-call", { count: 0 }),
    toolCount("no-app-create", { tool: "app.create", count: 0 }),
  ],
  fixtures: {
    right: [
      fixtureTrial([
        fixtureSession(LOPHN, [{ tool: "guide.read", effect: "read" }]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([fixtureSession(LOPHN, [])]),
        fails: ["read-guide"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [
            { tool: "guide.read", effect: "read" },
            { call: { to: PM_ledger, reply: "result" } },
          ]),
        ]),
        fails: ["no-call"],
      },
    ],
  },
};
export default scenario;
