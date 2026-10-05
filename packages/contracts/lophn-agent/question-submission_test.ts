import { assert, assertEquals } from "@std/assert";
import { canonicalize } from "../../base/mod.ts";
import { QUESTION_TEXT_MAX_BYTES } from "./question-text.ts";
import {
  createQuestionInputSchema,
  createQuestionSubmissionOutputSchema,
  optionActionSchema,
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
const input = {
  id: `qst_${suffix}`,
  run: `run_${suffix}`,
  session: null,
  prompt: "Adopt the design?",
  reason: "The design is final.",
  options: [option],
  recommendation: { option_key: "adopt", explanation: "It matches the goal." },
  expires_at: null,
};
const { description: _description, ...optionBase } = option;
const storedOption = { ...optionBase, description_blob: hash };
const { prompt: _prompt, reason: _reason, ...inputBase } = input;
const stored = {
  ...inputBase,
  prompt_blob: hash,
  reason_blob: hash,
  options: [storedOption],
  recommendation: { option_key: "adopt", explanation_blob: hash },
};

Deno.test("lophn-agent/harness/waiting-and-recovery#R1: new question submission is exact and sessionless", () => {
  assert(createQuestionInputSchema.safeParse(input).success);
  for (
    const value of [
      { ...input, run: null },
      { ...input, session: `run_${suffix}` },
      { ...input, prepared: [] },
      { ...input, options: [option, option] },
      {
        ...input,
        recommendation: { option_key: "missing", explanation: "why" },
      },
      {
        ...input,
        recommendation: { option_key: null, explanation: "why" },
      },
      { ...input, prompt: "  " },
      { ...input, reason: "" },
      { ...input, prompt: "x".repeat(QUESTION_TEXT_MAX_BYTES + 1) },
      { ...input, prompt_blob: hash },
      { ...input, options: [{ ...option, description: " " }] },
      { ...input, options: [{ ...option, description_blob: hash }] },
      { ...input, options: [], recommendation: input.recommendation },
    ]
  ) assert(!createQuestionInputSchema.safeParse(value).success);
  assert(
    createQuestionInputSchema.safeParse({
      ...input,
      options: [],
      recommendation: { option_key: null, explanation: "why" },
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
    recommendation: { ...stored.recommendation, future: true },
  };
  assert(!createQuestionInputSchema.safeParse(value).success);
  assertEquals(
    createQuestionSubmissionOutputSchema.parse(value) as unknown,
    stored as unknown,
  );
  assert(
    !createQuestionSubmissionOutputSchema.safeParse({
      ...value,
      options: [storedOption, storedOption],
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
  const output = createQuestionSubmissionOutputSchema.parse({
    ...stored,
    options: [{ ...storedOption, action: value }],
  });
  assertEquals(canonicalize(output.options[0].action), canonicalize(value));
});
