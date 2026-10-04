import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/mod.ts";
import { optionActionSchema } from "./question-submission.ts";
import {
  answerQuestion,
  answerQuestionInputSchema,
  applyQuestionOptionInputSchema,
  cancelQuestionInputSchema,
  createQuestion,
  QUESTION_COMMANDS,
  QUESTION_EVENTS,
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
    "/v1/questions/defer",
    "/v1/questions/cancel",
    "/v1/questions/expire",
    "/v1/questions/apply-option",
    "/v1/questions/read",
    "/v1/questions/list",
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
  assertEquals(answerQuestion.confirmation, "required");
  assertEquals(answerQuestion.display_read, "/v1/questions/read");
  const base = { question, created_seq: "4" };
  assert(
    answerQuestionInputSchema.safeParse({
      ...base,
      answer: { kind: "text", option_key: null, text_blob: hash },
      binding_hash: null,
      evidence: null,
    }).success,
  );
  assert(
    !answerQuestionInputSchema.safeParse({
      ...base,
      answer: { kind: "text", option_key: null, text_blob: hash },
      binding_hash: hash,
      evidence: null,
    }).success,
  );
  assert(
    !answerQuestionInputSchema.safeParse({
      ...base,
      answer: { kind: "option", option_key: "", text_blob: null },
      binding_hash: null,
      evidence: null,
    }).success,
  );
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
      closed_reason_blob: hash,
    }).success,
  );
  assert(
    !cancelQuestionInputSchema.safeParse({
      question,
      created_seq: "4",
      closed_reason: "deferred",
      closed_reason_blob: hash,
    }).success,
  );
});
