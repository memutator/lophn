// 출처: AGENT-ROLE A1(앱의 ticket 일은 Project Manager가 맡는다. "만들거나 고쳐 달라고 하면 ticket을 만든다")과 R4(사람에게 올림),
// ASK_TOOL_RULES(사람이 정해야 하고 요청·파일·기본값으로 못 정할 때만 묻는다).
// 요청이 너무 막연해 ticket을 만들 수 없으면 묻는다. session은 ask에 사람이 답하기를 기다리는 채로 끝나고,
// runner가 이를 조용함으로 센다.
import {
  fixtureSession,
  fixtureTrial,
  toolCallsOf,
  toolCount,
} from "../../checks/mod.ts";
import { asksGapInput } from "../../judge/mod.ts";
import type { AskInput } from "../../../../packages/protocol/lophn-agent/ask-tool.ts";
import { say, type Scenario, untilIdle } from "../../types.ts";
import { PM_ledger } from "./common.ts";

const REQUEST = "앱을 좀 더 좋게 만들어 줘";

const questions: AskInput["questions"] = [{
  question: "가계부 앱에서 어떤 점을 더 좋게 만들까요?",
  header: "개선 방향",
  options: [
    { label: "화면", description: "보이는 모양과 배치를 다듬는다" },
    { label: "기능", description: "새 기능을 더한다" },
    { label: "속도", description: "느린 곳을 빠르게 한다" },
  ],
  multiSelect: false,
}];

const scenario: Scenario = {
  id: "CA1-ask",
  n: 1,
  proposal: false,
  world: ["apps-home@1"],
  real: [PM_ledger],
  steps: [say(PM_ledger, REQUEST), untilIdle()],
  checks: [
    toolCount("no-ticket-create", { tool: "ticket.create", count: 0 }),
    toolCount("asked", { tool: "ask", count: { min: 1 } }),
    {
      kind: "judge",
      id: "asks-gap",
      premise: ["no-ticket-create", "asked"],
      criterion: "asks-gap@1",
      input: ({ trial }) =>
        asksGapInput(
          REQUEST,
          toolCallsOf(trial, "ask").flatMap((c) =>
            (c.input as AskInput | null)?.questions ?? []
          ),
        ),
    },
  ],
  fixtures: {
    right: [
      fixtureTrial([
        fixtureSession(PM_ledger, [{ tool: "ask", input: { questions } }]),
      ]),
    ],
    wrong: [
      {
        trial: fixtureTrial([
          fixtureSession(PM_ledger, [
            { tool: "ticket.create", effect: "write" },
          ]),
        ]),
        fails: ["no-ticket-create", "asked"],
      },
      {
        trial: fixtureTrial([fixtureSession(PM_ledger, [])]),
        fails: ["asked"],
      },
    ],
  },
};

export default scenario;
