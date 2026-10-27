// 출처: AGENT-ROLE A1(짓기 전에 `DESIGN.md`를 쓰고 직접 짓는다)과 App Engineer 지침(사람이 정할 것만 묻는다),
// ASK_TOOL_RULES(사람이 정해야 하고 요청·파일·기본값으로 못 정할 때만 묻는다).
// 요청이 너무 막연해 설계도 할 수 없으면 쓰기 전에 묻는다. session은 ask에 사람이 답하기를 기다리는 채로 끝나고,
// runner가 이를 조용함으로 센다. shell.run은 막지 않는다: 묻기 전에 `git log` 같은 읽기를 할 수 있다.
import {
  fixtureSession,
  fixtureTrial,
  toolCallsOf,
  toolCount,
} from "../../checks/mod.ts";
import { asksGapInput } from "../../judge/mod.ts";
import type { AskInput } from "../../../../packages/protocol/lophn-agent/ask-tool.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { AE_가계부 } from "./common.ts";

const REQUEST = "앱을 좀 더 좋게 만들어 줘";

const questions: AskInput["questions"] = [
  {
    question: "가계부 앱에서 어떤 점을 더 좋게 만들까요?",
    header: "개선 방향",
    options: [
      { label: "화면", description: "보이는 모양과 배치를 다듬는다" },
      { label: "기능", description: "새 기능을 더한다" },
      { label: "속도", description: "느린 곳을 빠르게 한다" },
    ],
    multiSelect: false,
  },
];

const scenario: Scenario = {
  id: "A1-ask",
  n: 3,
  proposal: false,
  world: ["apps-home@1"],
  real: [AE_가계부],
  steps: [say(AE_가계부, REQUEST), untilIdle()],
  checks: [
    toolCount("no-build", {
      tool: ["file.write", "file.edit", "release.prepare"],
      count: 0,
    }),
    toolCount("asked", { tool: "ask", count: { min: 1 } }),
    {
      kind: "judge",
      id: "asks-gap",
      premise: ["no-build", "asked"],
      criterion: "asks-gap@1",
      input: ({ trial }) =>
        asksGapInput(
          REQUEST,
          toolCallsOf(trial, "ask").flatMap(
            (c) => (c.input as AskInput | null)?.questions ?? [],
          ),
        ),
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([
        fixtureSession(AE_가계부, [{ tool: "ask", input: { questions } }]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(AE_가계부, [{ tool: "file.write", effect: "write" }]),
        ]),
        fails: ["no-build", "asked"],
      },
      {
        trial: fixtureTrial([fixtureSession(AE_가계부, [])]),
        fails: ["asked"],
      },
    ],
  },
};

export default scenario;
