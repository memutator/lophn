import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createIdSource,
  manualClock,
  seededRandom,
} from "../../../../base/mod.ts";
import type { AskInput } from "../../../../protocol/lophn-agent/ask-tool.ts";
import { createQuestionWaits } from "./wait.ts";

const SES = "ses_0000000000000000000000000a";
const TRN = "trn_0000000000000000000000000a";

const ask = (question: string): AskInput["questions"] => [
  {
    question,
    header: "Pick",
    options: [
      { label: "a", description: "first" },
      { label: "b", description: "second" },
    ],
    multiSelect: false,
  },
];

function setup() {
  const clock = manualClock(0);
  const events: { type: string; group: string }[] = [];
  const waits = createQuestionWaits({
    bus: {
      publish: (event) => {
        events.push({
          type: event.type,
          group: (event.payload as { group: string }).group,
        });
      },
    },
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  const call = (tool: string) => ({ session: SES, turn: TRN, tool_call: tool });
  return { waits, events, call };
}

// 한 응답의 ask 여럿은 병렬로 오지만 화면은 session당 질문 하나만 쥔다. 둘째 질문이 첫째를 가리면
// 답한 뒤 첫째가 보이지 않은 채 agent가 멈춘다.
test("한 session의 질문 여럿은 하나씩 열리고 답은 그 질문만 푼다", async () => {
  const { waits, events, call } = setup();
  const first = waits.ask(call("tcl_1"), ask("one?"), false);
  const second = waits.ask(call("tcl_2"), ask("two?"), false);

  assert.deepEqual(
    waits.list(SES).map((one) => one.tool_call),
    ["tcl_1"],
  );
  assert.equal(waits.read(SES, "tcl_2").ok, false);
  assert.equal(
    waits.answer(SES, "tcl_2", [
      { question: "two?", status: "answered", answer: ["a"] },
    ]).ok,
    false,
  );

  const answers = [
    { question: "one?", status: "answered" as const, answer: ["b"] },
  ];
  assert.equal(waits.answer(SES, "tcl_1", answers).ok, true);
  assert.deepEqual(await first, { outcome: "submitted", answers });
  assert.deepEqual(
    waits.list(SES).map((one) => one.tool_call),
    ["tcl_2"],
  );
  assert.deepEqual(
    events.map((one) => one.type),
    ["QuestionAsked", "QuestionResolved", "QuestionAsked"],
  );

  const next = [
    { question: "two?", status: "answered" as const, answer: ["a"] },
  ];
  assert.equal(waits.answer(SES, "tcl_2", next).ok, true);
  assert.deepEqual(await second, { outcome: "submitted", answers: next });
  assert.deepEqual(waits.list(SES), []);
});
