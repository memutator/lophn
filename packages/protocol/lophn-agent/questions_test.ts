import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../base/route.ts";
import { optionActionSchema } from "./question-submission.ts";
import {
  answerQuestionAction,
  answerQuestionActionInputSchema,
  answerQuestionGroup,
  answerQuestionGroupInputSchema,
  applyQuestionOptionInputSchema,
  cancelQuestionGroupInputSchema,
  createQuestionGroup,
  deferQuestionGroup,
  QUESTION_ANSWER_DECISION,
  QUESTION_COMMANDS,
  QUESTION_EVENTS,
  questionAnswered,
  questionCancelled,
  questionCreated,
  questionExpired,
  questionList,
  questionRead,
  questionText,
  questionTextOutputSchema,
} from "./questions.ts";

const suffix = "01arz3ndektsv4rrffq69g5fav";
const hash = "a".repeat(64);
const question = `qst_${suffix}`;
const second = "qst_01arz3ndektsv4rrffq69g5faw";
const group = `qgr_${suffix}`;
const action = {
  concern: "documents/versions",
  command: "move_document",
  targets: [`doc_${suffix}`],
  input: { kind: "inline", value: { place: `prj_${suffix}` } },
  input_hash: hash,
  comparison: { revision: 1 },
  binding_hash: hash,
};

Deno.test("lophn-agent/questions#R2: question group routes and the four named events", () => {
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

Deno.test("lophn-agent/questions#R6: only an explicit submit of the whole group closes it as answered", () => {
  assertEquals(createQuestionGroup.actors, ["agent"]);
  assertEquals(answerQuestionGroup.actors, ["user"]);
  assertEquals(answerQuestionAction.actors, ["user"]);
  assertEquals(deferQuestionGroup.actors, ["user"]);
  const base = { group, created_seq: "4" };
  assert(
    answerQuestionGroupInputSchema.safeParse({
      ...base,
      answers: [
        { question, answer: { kind: "text", text: "Use the second one." } },
        { question: second, answer: { kind: "option", option_key: "first" } },
      ],
    }).success,
  );
  assert(
    answerQuestionGroupInputSchema.safeParse({
      ...base,
      answers: [{ question, answer: { kind: "option", option_key: "second" } }],
    }).success,
  );
  const one = { question, answer: { kind: "option", option_key: "second" } };
  for (
    const value of [
      // 빈 답·공백뿐인 답은 답이 아니다.
      {
        ...base,
        answers: [{ question, answer: { kind: "text", text: "  \n" } }],
      },
      {
        ...base,
        answers: [{ question, answer: { kind: "option", option_key: "" } }],
      },
      // 묶음의 답은 하나 이상이고 네 개를 넘지 않는다.
      { ...base, answers: [] },
      { ...base, answers: [one, one] },
      {
        ...base,
        answers: Array.from({ length: 5 }, (_, index) => ({
          question: `qst_01arz3ndektsv4rrffq69g5f${"abcde"[index]}v`,
          answer: { kind: "option", option_key: "a" },
        })),
      },
      // 호출자는 hash를 만들지 않고 글을 값으로 싣는다.
      {
        ...base,
        answers: [{ question, answer: { kind: "text", text_blob: hash } }],
      },
      // 질문 하나만 따로 답하는 옛 모양은 없다.
      { ...base, question, answer: { kind: "option", option_key: "a" } },
      // 묶음 ID가 아니라 질문 ID로 묶음을 가리킬 수 없다.
      { group: question, created_seq: "4", answers: [one] },
      // 일반 답은 action 증거를 싣지 않는다.
      {
        ...base,
        answers: [one],
        binding_hash: hash,
        evidence: { question, option: "second" },
      },
    ]
  ) assert(!answerQuestionGroupInputSchema.safeParse(value).success);
});

Deno.test("lophn-agent/questions#R6: Skip defers the whole group and cannot carry an answer", () => {
  assert(
    deferQuestionGroup.input.safeParse({ group, created_seq: "4" }).success,
  );
  for (
    const extra of [
      { answers: [] },
      { answer: { kind: "text", text: "later" } },
      { question },
    ]
  ) {
    assert(
      !deferQuestionGroup.input.safeParse({ group, created_seq: "4", ...extra })
        .success,
    );
  }
  assert(
    !deferQuestionGroup.input.safeParse({ question, created_seq: "4" }).success,
  );
});

Deno.test("platform/identity#R14: only the answer that picks a fixed action asks for a confirmation handle", () => {
  // 일반 답(action 없는 선택지·자유 답)은 사람 결정 확인을 요구하지 않는다.
  assertEquals(answerQuestionGroup.confirmation, undefined);
  assertEquals(answerQuestionGroup.binding, undefined);
  // action 답은 확인 handle을 요구하고 표시는 같은 묶음의 questions/read다.
  assertEquals(answerQuestionAction.confirmation, "required");
  assertEquals(answerQuestionAction.display_read, "/v1/questions/read");
  assertEquals(answerQuestionAction.binding, [
    "group",
    "created_seq",
    "answer",
    "binding_hash",
  ]);
  const base = {
    group,
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
      // evidence는 답한 선택지를 가리켜야 한다.
      { ...base, evidence: { question, option: "other" } },
      // 묶음 ID가 아니라 질문 ID로 가리킬 수 없다.
      { ...base, group: question },
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

Deno.test("lophn-agent/questions#R9: cancelling a group needs a reason and the created content", () => {
  assert(
    cancelQuestionGroupInputSchema.safeParse({
      group,
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
      !cancelQuestionGroupInputSchema.safeParse({
        group,
        created_seq: "4",
        ...value,
      }).success,
    );
  }
});

Deno.test("lophn-agent/questions#R13: QuestionCreated keeps each question's option keys and their fixed settings changes for platform/settings", () => {
  const changes = [{
    layer: "common" as const,
    key: "shell.reading_width",
    action: "set" as const,
    value: 90,
  }];
  const parsed = questionCreated.payload.parse({
    run: `run_${suffix}`,
    session: null,
    questions: [{
      id: question,
      options: [{ key: "adopt", changes }, { key: "explain", changes: null }],
    }],
  });
  // 파싱이 선택지 key와 변경 목록을 지우지 않는다(ledger가 파싱한 값을 그대로 저장한다).
  assertEquals(parsed.questions, [{
    id: question,
    options: [
      { key: "adopt", changes },
      { key: "explain", changes: null },
    ],
  }]);
  // 선택지가 없는 질문은 빈 목록으로 읽는다.
  assertEquals(
    questionCreated.payload.parse({
      run: `run_${suffix}`,
      session: null,
      questions: [{ id: question }],
    }).questions[0].options,
    [],
  );
  assert(
    !questionCreated.payload.safeParse({
      run: `run_${suffix}`,
      session: null,
      questions: [{
        id: question,
        options: [{ key: "bad", changes: [{ key: "x", action: "set" }] }],
      }],
    }).success,
  );
  // 묶음은 질문 1~4개다.
  const withCount = (count: number) => ({
    run: `run_${suffix}`,
    session: null,
    questions: Array.from({ length: count }, () => ({ id: question })),
  });
  assert(questionCreated.payload.safeParse(withCount(4)).success);
  assert(!questionCreated.payload.safeParse(withCount(0)).success);
  assert(!questionCreated.payload.safeParse(withCount(5)).success);
});

Deno.test("lophn-agent/questions#R10: QuestionAnswered carries one answer per question for the whole group", () => {
  const answers = [
    { question, answer: { kind: "option", option_key: "a", text_blob: null } },
    {
      question: second,
      answer: { kind: "text", option_key: null, text_blob: hash },
    },
  ];
  assert(
    questionAnswered.payload.safeParse({
      created_seq: "4",
      answers,
      binding_hash: null,
    }).success,
  );
  assert(
    !questionAnswered.payload.safeParse({
      created_seq: "4",
      answers: [],
      binding_hash: null,
    }).success,
  );
  assert(
    !questionAnswered.payload.safeParse({
      created_seq: "4",
      answer: answers[0].answer,
      binding_hash: null,
    }).success,
  );
});

Deno.test("lophn-agent/questions#R8: an expired group carries its own closed reason and is not a cancel input", () => {
  assert(
    !cancelQuestionGroupInputSchema.safeParse({
      group,
      created_seq: "4",
      closed_reason: "expired",
      closed_reason_text: "late",
    }).success,
  );
});

function recorded(change: Record<string, unknown> = {}) {
  return {
    id: question,
    group,
    position: 1,
    prompt_blob: hash,
    reason_blob: hash,
    options: [],
    recommendation: null,
    answer: null,
    applied: false,
    ...change,
  };
}

Deno.test("lophn-agent/questions#R8: only a typed cancel keeps a reason blob, a deferral and an expiry point at no stored blob", () => {
  const base = {
    id: group,
    run: `run_${suffix}`,
    session: null,
    expires_at: null,
    created_seq: "4",
    questions: [recorded()],
  };
  const record = (closure: Record<string, unknown>) =>
    questionRead.output.safeParse({
      group: { ...base, ...closure },
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

Deno.test("lophn-agent/questions#R10: an answered group has an answer for every question and nothing else does", () => {
  const answered = {
    status: "answered",
    closed_reason: null,
    closed_reason_blob: null,
    closed_seq: "7",
  };
  const answer = { kind: "option", option_key: "a", text_blob: null };
  const record = (value: Record<string, unknown>) =>
    questionRead.output.safeParse({
      group: {
        id: group,
        run: `run_${suffix}`,
        session: null,
        expires_at: null,
        created_seq: "4",
        closed_reason: null,
        closed_reason_blob: null,
        closed_seq: null,
        status: "pending",
        questions: [recorded()],
        ...value,
      },
      as_of_seq: "9",
      next_cursor: null,
    });
  const two = (first: unknown, next: unknown) => [
    recorded({ answer: first }),
    recorded({ id: second, position: 2, answer: next }),
  ];
  assert(record({}).success);
  assert(
    record({ ...answered, questions: two(answer, answer) }).success,
  );
  // 일부만 답한 묶음은 없다.
  assert(!record({ ...answered, questions: two(answer, null) }).success);
  // 답이 있으면 묶음이 answered다.
  assert(!record({ questions: two(answer, answer) }).success);
  assert(!record({ ...answered, questions: [recorded()] }).success);
  // 적용 결과는 answered 묶음에서만 있다.
  assert(
    !record({ questions: [recorded({ applied: true })] }).success,
  );
  // 순서는 1부터 연속이고 묶음 안 질문 ID는 겹치지 않는다.
  assert(
    !record({ questions: [recorded({ position: 2 })] }).success,
  );
  assert(
    !record({
      questions: [recorded(), recorded({ position: 2 })],
    }).success,
  );
  assert(!record({ questions: [] }).success);
  assert(
    !record({
      questions: Array.from({ length: 5 }, (_, index) =>
        recorded({
          id: `qst_01arz3ndektsv4rrffq69g5f${"abcde"[index]}v`,
          position: index + 1,
        })),
    }).success,
  );
});

Deno.test("lophn-agent/questions#R2: the group list filters by run, session, assignment and status", () => {
  const filters = {
    run: `run_${suffix}`,
    session: `ses_${suffix}`,
    assignment: `asg_${suffix}`,
    status: "pending",
  };
  assert(questionList.input.safeParse(filters).success);
  assert(questionList.input.safeParse({}).success);
  assert(!questionList.input.safeParse({ ...filters, status: "done" }).success);
  assert(!questionList.input.safeParse({ question }).success);
  assert(questionRead.input.safeParse({ group }).success);
  assert(!questionRead.input.safeParse({ question }).success);
});

Deno.test("lophn-agent/questions#R4: the group text read is open to the person's screens and carries the human text of every question", () => {
  assertEquals(questionText.actors, [
    "user",
    "agent",
    "machine",
    "coding_agent",
  ]);
  assert(questionText.errors.includes("not_found"));
  assert(questionText.errors.includes("unavailable"));
  assert(questionText.input.safeParse({ group }).success);
  assert(!questionText.input.safeParse({ group, extra: 1 }).success);
  assert(!questionText.input.safeParse({ question }).success);
  const text = {
    question,
    prompt: "Which one?",
    reason: "Both are fine.",
    options: [{ key: "a", description: "The first." }],
    recommendation: { option_key: "a", explanation: "Smaller." },
    answer_text: null,
  };
  const body = {
    group,
    questions: [text],
    closed_reason_text: null,
    as_of_seq: "9",
    next_cursor: null,
  };
  assert(questionTextOutputSchema.safeParse(body).success);
  assert(
    questionTextOutputSchema.safeParse({
      ...body,
      questions: [{ ...text, answer_text: "Use a." }],
    }).success,
  );
  assert(
    !questionTextOutputSchema.safeParse({
      ...body,
      questions: [{ ...text, prompt: 3 }],
    }).success,
  );
  assert(
    !questionTextOutputSchema.safeParse({ ...body, questions: [] }).success,
  );
});

Deno.test("lophn-agent/questions#R13: 확인 handle의 결정 이름 상수는 ledger가 검사하는 action 답 command 이름이다", () => {
  assertEquals(QUESTION_ANSWER_DECISION, answerQuestionAction.name);
  assertEquals(answerQuestionAction.name, "AnswerQuestionAction");
});
