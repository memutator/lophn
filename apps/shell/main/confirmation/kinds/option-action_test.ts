import assert from "node:assert/strict";
import { test } from "node:test";

import { contentBasis } from "../handle.ts";
import { fakeCore, handle, id, ok } from "./kinds_fixture.ts";
import {
  ANSWER_ACTION,
  readOptionAction,
  submitOptionAction,
} from "./option-action.ts";

const QST = id("qst", 1);
const DOC = id("doc", 1);
const BINDING = "b".repeat(64);

function question(status = "pending", action: unknown = {
  concern: "documents/addressing",
  command: "document.move",
  targets: [DOC],
  input: { kind: "inline", value: { place: "archive/" } },
  input_hash: "4".repeat(64),
  comparison: { base_revision: "3" },
  binding_hash: BINDING,
}) {
  return {
    question: {
      id: QST,
      status,
      created_seq: "20",
      expires_at: null,
      options: [
        { key: "keep", label: "Keep it", action: null },
        { key: "move", label: "Move to archive", action },
      ],
      recommendation: { option_key: "move" },
    },
  };
}

const TEXT = {
  question: QST,
  prompt: "Where should this note go?",
  reason: "It has not changed for a year.",
  options: [
    { key: "keep", description: "Leave it where it is." },
    { key: "move", description: "Move the note into the archive folder." },
  ],
  recommendation: null,
  answer_text: null,
  closed_reason_text: null,
};

test("shell/confirmation-window#R2, lophn-agent/questions#R4, lophn-agent/questions#R13: option action은 고르기 전에 concern·command·대상·정확한 입력·비교 기준을 그대로 보인다", async () => {
  const core = fakeCore({
    "read:questions/read": () => ok(question()),
    "read:questions/text": () => ok(TEXT),
  });
  const read = await readOptionAction(core, QST, "move");
  assert.equal(read.ok, true);
  if (!read.ok) return;
  const view = read.value.view!;
  assert.equal(view.kind, "option_action");
  assert.equal(view.concern, "documents/addressing");
  assert.equal(view.command, "document.move");
  assert.deepEqual(view.targets, [DOC]);
  assert.deepEqual(view.input, {
    kind: "inline",
    value: { place: "archive/" },
  });
  assert.deepEqual(view.comparison, { base_revision: "3" });
  assert.equal(view.label, "Move to archive");
  assert.equal(view.description, "Move the note into the archive folder.");
  assert.equal(view.recommended, true);
  assert.deepEqual(read.value.allowed, [ANSWER_ACTION]);
  // handle은 AnswerQuestionAction binding(question·created_seq·answer·binding_hash)에 묶인다.
  assert.equal(read.value.targetRef, QST);
  assert.equal(
    contentBasis(read.value.content),
    contentBasis({
      question: QST,
      created_seq: "20",
      answer: { kind: "option", option_key: "move" },
      binding_hash: BINDING,
    }),
  );
});

test("shell/confirmation-window#R5: 끝난 질문이나 고정 동작 없는 선택지는 이 창의 결정이 아니다", async () => {
  const answered = await readOptionAction(
    fakeCore({
      "read:questions/read": () => ok(question("answered")),
      "read:questions/text": () => ok(TEXT),
    }),
    QST,
    "move",
  );
  assert.equal(answered.ok, false);
  const plain = await readOptionAction(
    fakeCore({
      "read:questions/read": () => ok(question()),
      "read:questions/text": () => ok(TEXT),
    }),
    QST,
    "keep",
  );
  assert.equal(plain.ok, false);
});

test("lophn-agent/questions#R13: 고르면 AnswerQuestionAction을 증거와 handle로 보내고 접수로 돌려준다", async () => {
  const core = fakeCore({
    "command:questions/answer-action": () =>
      ok({ id: QST, status: "answered", closed_seq: "21", replayed: false }),
  });
  const sent = await submitOptionAction(core, {
    handle: handle(),
    question: QST,
    optionKey: "move",
    createdSeq: "20",
    bindingHash: BINDING,
  });
  assert.deepEqual(sent, {
    ok: true,
    value: { receipt: { kind: "entity", id: QST }, result: "accepted" },
  });
  const body = core.calls[0]!.body as Record<string, unknown>;
  assert.deepEqual(body.input, {
    question: QST,
    created_seq: "20",
    answer: { kind: "option", option_key: "move" },
    binding_hash: BINDING,
    evidence: { question: QST, option: "move" },
  });
  assert.deepEqual(body.compare, { created_seq: "20" });
  assert.equal(body.confirmation, "H".repeat(43));
});
