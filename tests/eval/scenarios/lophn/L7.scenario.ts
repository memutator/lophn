// 출처: AGENT-ROLE L7 (제안) — 앱 상태를 묻는 말은 읽는 tool로만 답한다(app, problem, ticket).
import {
  fixtureAppCreate,
  fixtureSession,
  fixtureTrial,
  noWriteTools,
  toolsCalled,
} from "../../checks/mod.ts";
import { openProblem, openTicket } from "../../restore/setup.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { LOPHN } from "./common.ts";

const REQUEST = "가계부 앱 잘 돌아?";
const read = (tool: string) => ({ tool, effect: "read" as const });
const READS = [read("problem.list"), read("ticket.list")];

const scenario: Scenario = {
  id: "L7",
  n: 3,
  proposal: true,
  world: ["apps-home@1"],
  real: [LOPHN],
  setup: async (ctx) => {
    await openProblem(ctx, "가계부");
    await openTicket(ctx, "가계부", "월별 합계 화면 오류 고치기");
  },
  steps: [say(LOPHN, REQUEST), untilIdle()],
  checks: [
    toolsCalled("read-all", [
      ["app.get", "app.list"],
      "problem.list",
      "ticket.list",
    ]),
    noWriteTools("no-write"),
  ],
  fixtures: {
    right: [
      fixtureTrial([fixtureSession(LOPHN, [read("app.get"), ...READS])]),
      fixtureTrial([fixtureSession(LOPHN, [read("app.list"), ...READS])]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [read("app.get"), read("problem.list")]),
        ]),
        fails: ["read-all"],
      },
      {
        trial: fixtureTrial([fixtureSession(LOPHN, READS)]),
        fails: ["read-all"],
      },
      {
        trial: fixtureTrial([
          fixtureSession(LOPHN, [
            read("app.get"),
            ...READS,
            fixtureAppCreate("가계부2"),
          ]),
        ]),
        fails: ["no-write"],
      },
    ],
  },
};
export default scenario;
