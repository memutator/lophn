// question command 테스트다(cli#R7, R21). open은 결정 화면 링크와 대기 사실만 내고 창을
// 열거나 답을 받지 않으며 질문을 바꾸지 않는다. 답·미루기·취소 command가 표에 없다.
// core 대신 route별 답을 정한 흐름 client를 쓴다.
import { assert, assertEquals } from "@std/assert";
import { fail, scriptedFlow } from "../../connection/testing/mod.ts";
import { COMMANDS, findCommand } from "../registry.ts";
import { QUESTION_COMMANDS, runQuestionOpen } from "./question.ts";

const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const HASH = "a".repeat(64);

function record(over: Record<string, unknown> = {}) {
  return {
    id: QUESTION,
    run: "run_01arz3ndektsv4rrffq69g5fav",
    session: null,
    prompt_blob: HASH,
    reason_blob: HASH,
    options: [],
    recommendation: null,
    expires_at: null,
    status: "pending",
    answer: null,
    closed_reason: null,
    closed_reason_blob: null,
    created_seq: "3",
    closed_seq: null,
    applied: false,
    ...over,
  };
}

Deno.test("coding-agent/cli#R21: question 표는 list·show·open뿐이고 답·미루기·취소 command가 없다", () => {
  assertEquals(QUESTION_COMMANDS.map((entry) => entry.name), [
    "question list",
    "question show",
    "question open",
  ]);
  for (
    const name of [
      "question answer",
      "question defer",
      "question cancel",
      "question apply",
      "question create",
      "approval approve",
      "approval reject",
    ]
  ) {
    assertEquals(findCommand(name), undefined, name);
  }
  assertEquals(
    COMMANDS.filter((entry) => entry.name.startsWith("question ")).length,
    3,
  );
  // open은 질문 id만 받는다. 답·옵션·yes 입력은 받지 않는다.
  const open = findCommand("question open");
  assert(open);
  assert(
    open.input.safeParse({ command: "question open", question: QUESTION })
      .success,
  );
  for (
    const extra of [
      { answer: "yes" },
      { yes: true },
      { option: "a" },
      { confirm: true },
    ]
  ) {
    assert(
      !open.input.safeParse({
        command: "question open",
        question: QUESTION,
        ...extra,
      }).success,
    );
  }
});

Deno.test("coding-agent/cli#R7: question open은 대기 사실과 결정 화면 링크만 내고 읽기 외 호출이 없다", async () => {
  const flow = scriptedFlow({
    ReadQuestion: { question: record(), as_of_seq: "9", next_cursor: null },
  });
  const opened = await runQuestionOpen({ question: QUESTION }, {
    client: flow.client,
  });
  assert(opened.ok);
  assertEquals(opened.value.data, {
    question: QUESTION,
    state: "waiting",
    waiting: true,
    decision_link: `lophn://things-to-confirm/${QUESTION}`,
    window_opened: false,
  });
  assert(opened.value.next[0].includes("그대로다"));
  assertEquals(flow.sent.map((call) => [call.kind, call.name]), [[
    "read",
    "ReadQuestion",
  ]]);
});

Deno.test("coding-agent/cli#R7: 닫힌 질문은 링크 없이 열 결정이 없다고 알리고 core 오류는 그대로 낸다", async () => {
  const expired = scriptedFlow({
    ReadQuestion: {
      question: record({
        status: "expired",
        closed_reason: "expired",
        closed_seq: "4",
      }),
      as_of_seq: "9",
      next_cursor: null,
    },
  });
  const closed = await runQuestionOpen({ question: QUESTION }, {
    client: expired.client,
  });
  assert(closed.ok);
  assertEquals(closed.value.data.state, "expired");
  assertEquals(closed.value.data.decision_link, null);
  assertEquals(closed.value.data.waiting, false);
  const absent = scriptedFlow({
    ReadQuestion: fail("not_found", "question not found"),
  });
  const missing = await runQuestionOpen({ question: QUESTION }, {
    client: absent.client,
  });
  assert(!missing.ok);
  assertEquals(missing.error.code, "not_found");
});
