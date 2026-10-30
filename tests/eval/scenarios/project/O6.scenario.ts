// 출처: AGENT.md C1(사람, 2026-10-29), project 지침 "kind가 필요하면 skill `write-kinds`로 그 domain의
// `kinds.yaml`을 쓴다". project place의 agent는 kind 파일을 직접 고치고 아무에게도 call하지 않는다.
import {
  callCount,
  fixtureSession,
  fixtureTrial,
  toolCallsOf,
} from "../../checks/mod.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { LOPHN_tax, 세무정리_tax } from "./common.ts";

const REQUEST =
  "영수증 kind에 '공급자' 칸이 필요한데 kinds.yaml에 없네. 일은 계속해 줘";
const WRITES = ["file.edit", "file.write"];
const KINDS_PATH = "domains/dom_0000000000000000000000tx01/kinds.yaml";

const scenario: Scenario = {
  id: "O6",
  n: 6,
  proposal: false,
  world: ["projects-home@1", "tax-kinds@2", "agents-home@1"],
  real: [세무정리_tax],
  steps: [say(세무정리_tax, REQUEST), untilIdle()],
  checks: [
    callCount("no-call", { count: 0 }),
    {
      kind: "program",
      id: "edits-kinds",
      run({ trial }) {
        const edits = WRITES.flatMap((tool) => toolCallsOf(trial, tool)).filter(
          (c) =>
            c.call.outcome?.kind === "success" &&
            String((c.input as { path?: unknown } | null)?.path ?? "").endsWith(
              "kinds.yaml",
            ),
        );
        return {
          pass: edits.length > 0,
          reason:
            edits.length > 0
              ? `kinds.yaml 쓰기 ${edits.length}번`
              : "kinds.yaml을 쓰지 않음",
        };
      },
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([
        fixtureSession(세무정리_tax, [
          {
            tool: "file.edit",
            effect: "write",
            input: {
              path: KINDS_PATH,
              old_string: "      date: { type: date, required: true }",
              new_string:
                "      date: { type: date, required: true }\n      supplier: { type: string }",
            },
          },
        ]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(세무정리_tax, [
            { call: { to: LOPHN_tax, reply: "result" } },
          ]),
        ]),
        fails: ["no-call", "edits-kinds"],
      },
      {
        trial: fixtureTrial([fixtureSession(세무정리_tax, [])]),
        fails: ["edits-kinds"],
      },
    ],
  },
};

export default scenario;
