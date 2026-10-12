import assert from "node:assert/strict";
import { test } from "node:test";

import { contentBasis } from "../handle.ts";
import { fakeCore, handle, id, ok } from "./kinds_fixture.ts";
import {
  ANSWER_ACTION,
  readOptionAction,
  submitOptionAction,
} from "./option-action.ts";

const GRP = id("qgr", 1);
const QST = id("qst", 1);
const DOC = id("doc", 1);
const BINDING = "b".repeat(64);

const MOVE_ACTION = {
  concern: "documents/addressing",
  command: "document.move",
  targets: [DOC],
  input: { kind: "inline", value: { place: "archive/" } },
  input_hash: "4".repeat(64),
  comparison: { base_revision: "3" },
  binding_hash: BINDING,
};

function plainQuestion(n: number) {
  return {
    id: id("qst", n),
    group: GRP,
    position: n,
    options: [{ key: "ok", label: "Fine", action: null }],
    recommendation: null,
  };
}

// questions/read {group}의 응답. 질문은 묶음 안에 있고 고정 action 선택지는 질문 하나짜리
// 묶음에만 있다.
function group(
  status = "pending",
  action: unknown = MOVE_ACTION,
  extra: unknown[] = [],
) {
  return {
    group: {
      id: GRP,
      status,
      created_seq: "20",
      expires_at: null,
      questions: [{
        id: QST,
        group: GRP,
        position: 1,
        options: [
          { key: "keep", label: "Keep it", action: null },
          { key: "move", label: "Move to archive", action },
        ],
        recommendation: { option_key: "move" },
      }, ...extra],
    },
  };
}

// questions/text {group}의 응답. 질문마다의 글이 묶음 순서대로 있다.
const TEXT = {
  group: GRP,
  questions: [{
    question: QST,
    prompt: "Where should this note go?",
    reason: "It has not changed for a year.",
    options: [
      { key: "keep", description: "Leave it where it is." },
      { key: "move", description: "Move the note into the archive folder." },
    ],
    recommendation: null,
    answer_text: null,
  }],
  closed_reason_text: null,
};

test("shell/confirmation-window#R2, lophn-agent/questions#R4, lophn-agent/questions#R13: option action은 묶음을 {group}으로 읽어 고르기 전에 concern·command·대상·정확한 입력·비교 기준을 그대로 보인다", async () => {
  const core = fakeCore({
    "read:questions/read": () => ok(group()),
    "read:questions/text": () => ok(TEXT),
  });
  const read = await readOptionAction(core, GRP, "move");
  assert.equal(read.ok, true);
  if (!read.ok) return;
  // 읽기는 질문 id가 아니라 묶음 id 하나로 한다.
  assert.deepEqual(
    core.calls.map((call) => [call.resource, call.method, call.body]),
    [["questions", "read", { group: GRP }], ["questions", "text", {
      group: GRP,
    }]],
  );
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
  assert.equal(view.prompt, "Where should this note go?");
  assert.equal(view.reason, "It has not changed for a year.");
  assert.equal(view.description, "Move the note into the archive folder.");
  assert.equal(view.recommended, true);
  assert.deepEqual(read.value.allowed, [ANSWER_ACTION]);
  // handle은 AnswerQuestionAction binding(group·created_seq·answer·binding_hash)에 묶인다.
  assert.equal(read.value.targetRef, GRP);
  assert.equal(
    contentBasis(read.value.content),
    contentBasis({
      group: GRP,
      created_seq: "20",
      answer: { kind: "option", option_key: "move" },
      binding_hash: BINDING,
    }),
  );
  // 창에 보내는 요청은 묶음이 정본 참조이고 답할 질문과 비교 기준을 함께 싣는다.
  assert.deepEqual(read.value.request, {
    kind: "question_option_action",
    group: GRP,
    question: QST,
    option_key: "move",
    created_seq: "20",
    binding_hash: BINDING,
  });
});

test("shell/confirmation-window#R5, lophn-agent/questions#R13: 끝난 묶음이나 고정 동작 없는 선택지나 없는 선택지는 이 창의 결정이 아니다", async () => {
  const answered = await readOptionAction(
    fakeCore({
      "read:questions/read": () => ok(group("answered")),
      "read:questions/text": () => ok(TEXT),
    }),
    GRP,
    "move",
  );
  assert.equal(answered.ok, false);
  const plain = await readOptionAction(
    fakeCore({
      "read:questions/read": () => ok(group()),
      "read:questions/text": () => ok(TEXT),
    }),
    GRP,
    "keep",
  );
  assert.equal(plain.ok, false);
  const absent = await readOptionAction(
    fakeCore({
      "read:questions/read": () => ok(group()),
      "read:questions/text": () => ok(TEXT),
    }),
    GRP,
    "nope",
  );
  assert.equal(absent.ok, false);
});

test("shell/confirmation-window#R5, lophn-agent/questions#R13: 질문이 둘 이상인 묶음은 고정 action 선택지가 있어도 이 창의 결정이 아니고 글도 읽지 않는다", async () => {
  const core = fakeCore({
    "read:questions/read": () =>
      ok(group("pending", MOVE_ACTION, [
        plainQuestion(2),
      ])),
    "read:questions/text": () => ok(TEXT),
  });
  const read = await readOptionAction(core, GRP, "move");
  assert.equal(read.ok, false);
  assert.equal(core.calls.some((call) => call.method === "text"), false);
});

test("lophn-agent/questions#R13: 고르면 AnswerQuestionAction을 묶음 ref와 증거와 handle로 보내고 접수로 돌려준다", async () => {
  const core = fakeCore({
    "command:questions/answer-action": () =>
      ok({ id: GRP, status: "answered", closed_seq: "21", replayed: false }),
  });
  const sent = await submitOptionAction(core, {
    handle: handle(),
    group: GRP,
    question: QST,
    optionKey: "move",
    createdSeq: "20",
    bindingHash: BINDING,
  });
  assert.deepEqual(sent, {
    ok: true,
    value: { receipt: { kind: "entity", id: GRP }, result: "accepted" },
  });
  const body = core.calls[0]!.body as Record<string, unknown>;
  assert.deepEqual(body.input, {
    group: GRP,
    created_seq: "20",
    answer: { kind: "option", option_key: "move" },
    binding_hash: BINDING,
    evidence: { question: QST, option: "move" },
  });
  assert.deepEqual(body.compare, { created_seq: "20" });
  assert.equal(body.confirmation, "H".repeat(43));
});
