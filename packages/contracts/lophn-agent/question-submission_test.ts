import { assert, assertEquals } from "@std/assert";
import { canonicalize } from "../../base/mod.ts";
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
const option = {
  key: "adopt",
  label: "Adopt",
  description_blob: hash,
  evidence: [reference],
  adoption: reference,
  action,
};
const input = {
  id: `qst_${suffix}`,
  run: `run_${suffix}`,
  session: null,
  prompt_blob: hash,
  reason_blob: hash,
  options: [option],
  recommendation: { option_key: "adopt", explanation_blob: hash },
  expires_at: null,
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
        recommendation: { option_key: "missing", explanation_blob: hash },
      },
      {
        ...input,
        recommendation: { option_key: null, explanation_blob: hash },
      },
      { ...input, options: [], recommendation: input.recommendation },
    ]
  ) assert(!createQuestionInputSchema.safeParse(value).success);
  assert(
    createQuestionInputSchema.safeParse({
      ...input,
      options: [],
      recommendation: { option_key: null, explanation_blob: hash },
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
    ...input,
    future: true,
    options: [{
      ...option,
      future: true,
      evidence: [{ ...reference, future: true }],
      adoption: { ...reference, future: true },
      action: {
        ...action,
        future: true,
        input: { ...action.input, future: true },
      },
    }],
    recommendation: { ...input.recommendation, future: true },
  };
  assert(!createQuestionInputSchema.safeParse(value).success);
  assertEquals(
    createQuestionSubmissionOutputSchema.parse(value),
    createQuestionInputSchema.parse(input),
  );
  assert(
    !createQuestionSubmissionOutputSchema.safeParse({
      ...value,
      options: [option, option],
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
    ...input,
    options: [{ ...option, action: value }],
  });
  assertEquals(canonicalize(output.options[0].action), canonicalize(value));
});
