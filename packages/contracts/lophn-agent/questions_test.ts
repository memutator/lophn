import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/mod.ts";
import { optionActionSchema } from "./question-submission.ts";
import {
  answerQuestion,
  answerQuestionAction,
  answerQuestionActionInputSchema,
  answerQuestionInputSchema,
  applyQuestionOptionInputSchema,
  cancelQuestionInputSchema,
  createQuestion,
  QUESTION_COMMANDS,
  QUESTION_EVENTS,
  questionCancelled,
  questionCreated,
  questionExpired,
  questionRead,
  questionText,
  questionTextOutputSchema,
} from "./questions.ts";

const suffix = "01arz3ndektsv4rrffq69g5fav";
const hash = "a".repeat(64);
const question = `qst_${suffix}`;
const action = {
  concern: "documents/versions",
  command: "move_document",
  targets: [`doc_${suffix}`],
  input: { kind: "inline", value: { place: `prj_${suffix}` } },
  input_hash: hash,
  comparison: { revision: 1 },
  binding_hash: hash,
};

Deno.test("lophn-agent/questions#R2: question routes and the four named events", () => {
  assertEquals(QUESTION_COMMANDS.map(routePath), [
    "/v1/questions/create",
    "/v1/questions/answer",
    "/v1/questions/answer-action",
    "/v1/questions/defer",
    "/v1/questions/cancel",
    "/v1/questions/expire",
    "/v1/questions/apply-option",
    "/v1/questions/read",
    "/v1/questions/list",
    "/v1/questions/text",
  ]);
  assertEquals(QUESTION_EVENTS.map((event) => event.type), [
    "QuestionCreated",
    "QuestionAnswered",
    "QuestionExpired",
    "QuestionCancelled",
  ]);
  for (const route of QUESTION_COMMANDS) {
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
  }
});

Deno.test("lophn-agent/questions#R6: only an explicit answer closes a question as answered", () => {
  assertEquals(createQuestion.actors, ["agent"]);
  assertEquals(answerQuestion.actors, ["user"]);
  assertEquals(answerQuestionAction.actors, ["user"]);
  const base = { question, created_seq: "4" };
  assert(
    answerQuestionInputSchema.safeParse({
      ...base,
      answer: { kind: "text", text: "Use the second one." },
    }).success,
  );
  assert(
    answerQuestionInputSchema.safeParse({
      ...base,
      answer: { kind: "option", option_key: "second" },
    }).success,
  );
  for (
    const value of [
      // 빈 답·공백뿐인 답은 답이 아니다.
      { ...base, answer: { kind: "text", text: "  \n" } },
      { ...base, answer: { kind: "option", option_key: "" } },
      // 호출자는 hash를 만들지 않고 글을 값으로 싣는다.
      { ...base, answer: { kind: "text", text_blob: hash } },
      { ...base, answer: { kind: "text", option_key: null, text_blob: hash } },
      // 일반 답은 action 증거를 싣지 않는다.
      {
        ...base,
        answer: { kind: "option", option_key: "second" },
        binding_hash: hash,
        evidence: { question, option: "second" },
      },
    ]
  ) assert(!answerQuestionInputSchema.safeParse(value).success);
});

Deno.test("platform/identity#R14: only the answer that picks a fixed action asks for a confirmation handle", () => {
  // 일반 답(action 없는 선택지·자유 답)은 사람 결정 확인을 요구하지 않는다.
  assertEquals(answerQuestion.confirmation, undefined);
  assertEquals(answerQuestion.binding, undefined);
  // action 답은 확인 handle을 요구하고 표시는 같은 질문의 questions/read다.
  assertEquals(answerQuestionAction.confirmation, "required");
  assertEquals(answerQuestionAction.display_read, "/v1/questions/read");
  assertEquals(answerQuestionAction.binding, [
    "question",
    "created_seq",
    "answer",
    "binding_hash",
  ]);
  const base = {
    question,
    created_seq: "4",
    answer: { kind: "option", option_key: "move" },
    binding_hash: hash,
    evidence: { question, option: "move" },
  };
  assert(answerQuestionActionInputSchema.safeParse(base).success);
  for (
    const value of [
      // action 답은 binding_hash와 evidence가 모두 있어야 한다.
      { ...base, binding_hash: null },
      { ...base, evidence: null },
      { ...base, evidence: undefined },
      // evidence는 답한 선택지와 질문을 가리켜야 한다.
      { ...base, evidence: { question, option: "other" } },
      {
        ...base,
        evidence: { question: `qst_${suffix.slice(0, -1)}w`, option: "move" },
      },
      // 자유 답은 action이 아니다.
      { ...base, answer: { kind: "text", text: "move it" } },
    ]
  ) assert(!answerQuestionActionInputSchema.safeParse(value).success);
});

Deno.test("lophn-agent/questions#R13: a fixed option action is applied once from the saved answer", () => {
  assert(optionActionSchema.safeParse(action).success);
  assertEquals(
    Object.keys(optionActionSchema.shape).sort(),
    [
      "binding_hash",
      "command",
      "comparison",
      "concern",
      "input",
      "input_hash",
      "targets",
    ],
  );
  assert(
    applyQuestionOptionInputSchema.safeParse({
      question,
      answered_seq: "5",
      option_key: "move",
      action,
      evidence: { question, option: "move" },
    }).success,
  );
  assert(
    !applyQuestionOptionInputSchema.safeParse({
      question,
      answered_seq: "5",
      option_key: "move",
      action,
      evidence: { question, option: "other" },
    }).success,
  );
});

Deno.test("lophn-agent/questions#R9: cancelling a question needs a reason and the created content", () => {
  assert(
    cancelQuestionInputSchema.safeParse({
      question,
      created_seq: "4",
      closed_reason: "superseded",
      closed_reason_text: "The premise changed.",
    }).success,
  );
  for (
    const value of [
      { closed_reason: "deferred", closed_reason_text: "later" },
      { closed_reason: "cancelled", closed_reason_text: " " },
      // 이유는 글을 값으로 싣는다. hash는 받지 않는다.
      { closed_reason: "cancelled", closed_reason_blob: hash },
    ]
  ) {
    assert(
      !cancelQuestionInputSchema.safeParse({
        question,
        created_seq: "4",
        ...value,
      }).success,
    );
  }
});

Deno.test("lophn-agent/questions#R13: QuestionCreated keeps each option key and its fixed settings changes for platform/settings", () => {
  const changes = [{
    layer: "common" as const,
    key: "shell.reading_width",
    action: "set" as const,
    value: 90,
  }];
  const parsed = questionCreated.payload.parse({
    run: `run_${suffix}`,
    session: null,
    options: [{ key: "adopt", changes }, { key: "explain", changes: null }],
  });
  // 파싱이 선택지 key와 변경 목록을 지우지 않는다(ledger가 파싱한 값을 그대로 저장한다).
  assertEquals(parsed.options, [
    { key: "adopt", changes },
    { key: "explain", changes: null },
  ]);
  // 선택지가 없는 옛 모양은 빈 목록으로 읽는다.
  assertEquals(
    questionCreated.payload.parse({ run: `run_${suffix}`, session: null })
      .options,
    [],
  );
  assert(
    !questionCreated.payload.safeParse({
      run: `run_${suffix}`,
      session: null,
      options: [{ key: "bad", changes: [{ key: "x", action: "set" }] }],
    }).success,
  );
});

Deno.test("lophn-agent/questions#R8: an expired question carries its own closed reason and is not a cancel input", () => {
  assert(
    !cancelQuestionInputSchema.safeParse({
      question,
      created_seq: "4",
      closed_reason: "expired",
      closed_reason_text: "late",
    }).success,
  );
});

Deno.test("lophn-agent/questions#R8: only a typed cancel keeps a reason blob, a deferral and an expiry point at no stored blob", () => {
  const base = {
    id: question,
    run: `run_${suffix}`,
    session: null,
    prompt_blob: hash,
    reason_blob: hash,
    options: [],
    recommendation: null,
    expires_at: null,
    answer: null,
    created_seq: "4",
    applied: false,
  };
  const record = (closure: Record<string, unknown>) =>
    questionRead.output.safeParse({
      question: { ...base, ...closure },
      as_of_seq: "9",
      next_cursor: null,
    });
  const closed = { closed_seq: "7" };
  assert(
    record({
      ...closed,
      status: "cancelled",
      closed_reason: "deferred",
      closed_reason_blob: null,
    }).success,
  );
  assert(
    record({
      ...closed,
      status: "expired",
      closed_reason: "expired",
      closed_reason_blob: null,
    }).success,
  );
  assert(
    record({
      ...closed,
      status: "cancelled",
      closed_reason: "superseded",
      closed_reason_blob: hash,
    }).success,
  );
  // 저장하지 않은 blob을 가리키거나 typed 취소의 blob을 빼면 안 된다.
  assert(
    !record({
      ...closed,
      status: "cancelled",
      closed_reason: "deferred",
      closed_reason_blob: hash,
    }).success,
  );
  assert(
    !record({
      ...closed,
      status: "expired",
      closed_reason: "expired",
      closed_reason_blob: hash,
    }).success,
  );
  assert(
    !record({
      ...closed,
      status: "cancelled",
      closed_reason: "cancelled",
      closed_reason_blob: null,
    }).success,
  );
  assert(
    !record({
      ...closed,
      status: "expired",
      closed_reason: "cancelled",
      closed_reason_blob: null,
    }).success,
  );
  assertEquals(
    questionExpired.payload.safeParse({ created_seq: "4" }).success,
    true,
  );
  assert(
    questionCancelled.payload.safeParse({
      created_seq: "4",
      closed_reason_blob: null,
      deferred: true,
    }).success,
  );
  assert(
    !questionCancelled.payload.safeParse({
      created_seq: "4",
      closed_reason_blob: hash,
      deferred: true,
    }).success,
  );
  assert(
    !questionCancelled.payload.safeParse({
      created_seq: "4",
      closed_reason_blob: null,
      deferred: false,
    }).success,
  );
});

Deno.test("lophn-agent/questions#R4: the question text read is open to the person's screens and carries the human text", () => {
  assertEquals(questionText.actors, [
    "user",
    "agent",
    "machine",
    "coding_agent",
  ]);
  assert(questionText.errors.includes("not_found"));
  assert(questionText.errors.includes("unavailable"));
  assert(questionText.input.safeParse({ question }).success);
  assert(!questionText.input.safeParse({ question, extra: 1 }).success);
  const body = {
    question,
    prompt: "Which one?",
    reason: "Both are fine.",
    options: [{ key: "a", description: "The first." }],
    recommendation: { option_key: "a", explanation: "Smaller." },
    answer_text: null,
    closed_reason_text: null,
    as_of_seq: "9",
    next_cursor: null,
  };
  assert(questionTextOutputSchema.safeParse(body).success);
  assert(
    questionTextOutputSchema.safeParse({ ...body, answer_text: "Use a." })
      .success,
  );
  assert(!questionTextOutputSchema.safeParse({ ...body, prompt: 3 }).success);
});
