import { assert, assertEquals } from "@std/assert";
import { canonicalize } from "../../base/mod.ts";
import { QUESTION_TEXT_MAX_BYTES } from "./question-text.ts";
import {
  createQuestionGroupInputSchema,
  createQuestionGroupSubmissionOutputSchema,
  optionActionSchema,
  questionInputSchema,
  questionOptionSchema,
} from "./question-submission.ts";

const hash = "a".repeat(64);
const suffix = "01arz3ndektsv4rrffq69g5fav";
const reference = {
  document: `doc_${suffix}`,
  version: `ver_${suffix}`,
  section: null,
};
const action = {
  concern: "documents/versions",
  command: "save_version",
  targets: [`doc_${suffix}`],
  input: { kind: "inline", value: { title: "exact" } },
  input_hash: hash,
  comparison: { revision: 1 },
  binding_hash: hash,
};
// 요청은 글을 값으로 싣고(Q38) 저장된 질문은 그 blob의 hash를 가리킨다.
const option = {
  key: "adopt",
  label: "Adopt",
  description: "Adopt this version.",
  evidence: [reference],
  adoption: reference,
  action,
};
const question = {
  id: `qst_${suffix}`,
  prompt: "Adopt the design?",
  reason: "The design is final.",
  options: [option],
  recommendation: { option_key: "adopt", explanation: "It matches the goal." },
};
const input = {
  id: `qgr_${suffix}`,
  run: `run_${suffix}`,
  session: null,
  expires_at: null,
  questions: [question],
};
const { description: _description, ...optionBase } = option;
const storedOption = { ...optionBase, description_blob: hash };
const { prompt: _prompt, reason: _reason, ...questionBase } = question;
const stored = {
  id: input.id,
  run: input.run,
  session: null,
  expires_at: null,
  questions: [{
    ...questionBase,
    group: input.id,
    position: 1,
    prompt_blob: hash,
    reason_blob: hash,
    options: [storedOption],
    recommendation: { option_key: "adopt", explanation_blob: hash },
  }],
};

Deno.test("lophn-agent/harness/waiting-and-recovery#R1: new question group submission is exact and sessionless", () => {
  assert(createQuestionGroupInputSchema.safeParse(input).success);
  const withQuestion = (change: Record<string, unknown>) => ({
    ...input,
    questions: [{ ...question, ...change }],
  });
  for (
    const value of [
      { ...input, run: null },
      { ...input, session: `run_${suffix}` },
      { ...input, prepared: [] },
      { ...input, id: `qst_${suffix}` },
      withQuestion({ options: [option, option] }),
      withQuestion({
        recommendation: { option_key: "missing", explanation: "why" },
      }),
      withQuestion({
        recommendation: { option_key: null, explanation: "why" },
      }),
      withQuestion({ prompt: "  " }),
      withQuestion({ reason: "" }),
      withQuestion({ prompt: "x".repeat(QUESTION_TEXT_MAX_BYTES + 1) }),
      withQuestion({ prompt_blob: hash }),
      withQuestion({ options: [{ ...option, description: " " }] }),
      withQuestion({ options: [{ ...option, description_blob: hash }] }),
      withQuestion({
        options: [],
        recommendation: question.recommendation,
      }),
    ]
  ) assert(!createQuestionGroupInputSchema.safeParse(value).success);
  assert(
    createQuestionGroupInputSchema.safeParse(
      withQuestion({
        options: [],
        recommendation: { option_key: null, explanation: "why" },
      }),
    ).success,
  );
  assert(questionInputSchema.safeParse(question).success);
});

const plain = {
  key: "plain",
  label: "Plain",
  description: "No fixed action.",
  evidence: [],
  adoption: null,
  action: null,
};
function nth(index: number) {
  return {
    id: `qst_01arz3ndektsv4rrffq69g5f${"abcd"[index]}${"v"}`,
    prompt: `Question ${index + 1}?`,
    reason: "Independent decision.",
    options: [plain],
    recommendation: null,
  };
}

Deno.test("lophn-agent/questions#R1: a group holds one to four questions", () => {
  const group = (count: number) => ({
    ...input,
    questions: Array.from({ length: count }, (_, index) => nth(index)),
  });
  for (const count of [1, 2, 3, 4]) {
    assert(createQuestionGroupInputSchema.safeParse(group(count)).success);
  }
  assert(!createQuestionGroupInputSchema.safeParse(group(0)).success);
  assert(!createQuestionGroupInputSchema.safeParse(group(5)).success);
  // 같은 질문 ID를 두 번 쓰지 않는다.
  assert(
    !createQuestionGroupInputSchema.safeParse({
      ...input,
      questions: [nth(0), nth(0)],
    }).success,
  );
});

Deno.test("lophn-agent/questions#R13: a question with a fixed action option is a group of one", () => {
  const fixed = { ...nth(0), options: [option] };
  assert(
    createQuestionGroupInputSchema.safeParse({ ...input, questions: [fixed] })
      .success,
  );
  // 고정 action이 있는 질문을 다른 질문과 한 묶음에 넣으면 거절한다.
  assert(
    !createQuestionGroupInputSchema.safeParse({
      ...input,
      questions: [fixed, nth(1)],
    }).success,
  );
  assert(
    !createQuestionGroupInputSchema.safeParse({
      ...input,
      questions: [nth(1), fixed],
    }).success,
  );
  // action 없는 선택지만 있으면 여럿을 묶을 수 있다.
  assert(
    createQuestionGroupInputSchema.safeParse({
      ...input,
      questions: [nth(0), nth(1)],
    }).success,
  );
  // 저장된 묶음도 같은 규칙을 지킨다.
  const storedQuestion = (index: number, position: number) => ({
    ...stored.questions[0],
    id: nth(index).id,
    position,
  });
  assert(
    !createQuestionGroupSubmissionOutputSchema.safeParse({
      ...stored,
      questions: [storedQuestion(0, 1), storedQuestion(1, 2)],
    }).success,
  );
});

Deno.test("lophn-agent/handoff#R3: question option evidence and adoption retain fixed doc version references", () => {
  assert(questionOptionSchema.safeParse(option).success);
  for (
    const value of [
      { ...option, evidence: [reference, reference] },
      { ...option, adoption: { ...reference, version: `doc_${suffix}` } },
      { ...option, key: " " },
      { ...option, label: "\t" },
      { ...option, action: { ...action, caller: "agent" } },
    ]
  ) assert(!questionOptionSchema.safeParse(value).success);
  assert(
    optionActionSchema.safeParse({
      ...action,
      input: { kind: "blob", sha256: hash },
    }).success,
  );
  for (
    const value of [
      { ...action, targets: [] },
      { ...action, targets: [...action.targets, ...action.targets] },
      { ...action, input: { arbitrary: true } },
      { ...action, extra: true },
    ]
  ) assert(!optionActionSchema.safeParse(value).success);
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R5: question submission output is additive at each value boundary", () => {
  const value = {
    ...stored,
    future: true,
    questions: [{
      ...stored.questions[0],
      future: true,
      options: [{
        ...storedOption,
        future: true,
        evidence: [{ ...reference, future: true }],
        adoption: { ...reference, future: true },
        action: {
          ...action,
          future: true,
          input: { ...action.input, future: true },
        },
      }],
      recommendation: { ...stored.questions[0].recommendation, future: true },
    }],
  };
  assert(!createQuestionGroupInputSchema.safeParse(value).success);
  assertEquals(
    createQuestionGroupSubmissionOutputSchema.parse(value) as unknown,
    stored as unknown,
  );
  assert(
    !createQuestionGroupSubmissionOutputSchema.safeParse({
      ...value,
      questions: [{
        ...value.questions[0],
        options: [storedOption, storedOption],
      }],
    }).success,
  );
  // 질문 순서(position)는 1부터 연속이고 소속 묶음을 가리킨다.
  assert(
    !createQuestionGroupSubmissionOutputSchema.safeParse({
      ...stored,
      questions: [{ ...stored.questions[0], position: 2 }],
    }).success,
  );
  assert(
    !createQuestionGroupSubmissionOutputSchema.safeParse({
      ...stored,
      questions: [{
        ...stored.questions[0],
        group: `qgr_${suffix.slice(0, -1)}w`,
      }],
    }).success,
  );
});

Deno.test("lophn-agent/harness/waiting-and-recovery#R1: option action JSON preserves own and nested proto keys in fixed input and CAS", () => {
  const exact = JSON.parse(
    '{"__proto__":{"own":true},"nested":{"__proto__":{"value":1}}}',
  );
  const value = {
    ...action,
    input: { kind: "inline", value: exact },
    comparison: exact,
  };
  const parsed = optionActionSchema.parse(value);
  assertEquals(canonicalize(parsed), canonicalize(value));
  assert(Object.hasOwn(parsed.comparison, "__proto__"));
  const output = createQuestionGroupSubmissionOutputSchema.parse({
    ...stored,
    questions: [{
      ...stored.questions[0],
      options: [{ ...storedOption, action: value }],
    }],
  });
  assertEquals(
    canonicalize(output.questions[0].options[0].action),
    canonicalize(value),
  );
});
