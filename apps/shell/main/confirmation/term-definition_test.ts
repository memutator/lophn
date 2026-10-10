import assert from "node:assert/strict";
import { test } from "node:test";

import { confirmTermDefinition } from "./term-definition.ts";
import { fakeCore, id, ok } from "./kinds/kinds_fixture.ts";

const QST = id("qst", 1);
const BINDING = "b".repeat(64);

function action(command: string) {
  return {
    concern: command === "app.create"
      ? "apps/registration"
      : command === "term.define"
      ? "documents/terms"
      : "documents/addressing",
    command,
    targets: [id("app", 1)],
    input: { kind: "inline", value: {} },
    input_hash: "4".repeat(64),
    comparison: {},
    binding_hash: BINDING,
  };
}

function core(command: string) {
  return fakeCore({
    "read:questions/read": () =>
      ok({
        question: {
          id: QST,
          status: "pending",
          created_seq: "20",
          expires_at: null,
          options: [{ key: "go", label: "Go", action: action(command) }],
          recommendation: null,
        },
      }),
    "read:questions/text": () =>
      ok({
        question: QST,
        prompt: "Go?",
        reason: "Because.",
        options: [{ key: "go", description: "Go ahead." }],
        recommendation: null,
        answer_text: null,
        closed_reason_text: null,
      }),
    "command:questions/answer-action": () =>
      ok({ id: QST, status: "answered", closed_seq: "21", replayed: false }),
  });
}

async function confirm(command: string) {
  const registered: unknown[] = [];
  const fake = core(command);
  const result = await confirmTermDefinition({
    core: fake,
    register: (request) => {
      registered.push(request);
      return Promise.resolve({
        ok: true as const,
        confirmation: "H".repeat(43),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
    },
    windowId: "cfw_1",
    question: QST,
    optionKey: "go",
    nowMs: Date.now(),
  });
  return { result, registered, calls: fake.calls };
}

for (const command of ["term.define", "app.create"]) {
  test(`shell/confirmation-window#R5, lophn-agent/questions#R13: ${command} 선택지는 확인 창 없이 정본을 다시 읽어 답으로 접수한다`, async () => {
    const { result, calls } = await confirm(command);
    assert.deepEqual(result, { ok: true });
    const sent = calls.find((call) => call.method === "answer-action");
    assert.ok(sent !== undefined);
    const body = sent.body as { input: Record<string, unknown> };
    assert.deepEqual(body.input["answer"], {
      kind: "option",
      option_key: "go",
    });
    assert.equal(body.input["binding_hash"], BINDING);
  });
}

test("shell/confirmation-window#R5, lophn-agent/questions#R13: 그 밖 command의 선택지는 확인 창 없이 접수하지 않는다", async () => {
  const { result, registered, calls } = await confirm("document.move");
  assert.deepEqual(result, { ok: false, code: "forbidden" });
  assert.equal(registered.length, 0);
  assert.equal(calls.some((call) => call.method === "answer-action"), false);
});
