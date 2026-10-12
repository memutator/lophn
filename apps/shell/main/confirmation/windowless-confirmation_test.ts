import assert from "node:assert/strict";
import { test } from "node:test";

import { confirmWithoutWindow } from "./windowless-confirmation.ts";
import { fakeCore, id, ok } from "./kinds/kinds_fixture.ts";

const GRP = id("qgr", 1);
const QST = id("qst", 1);
const BINDING = "b".repeat(64);

function action(command: string) {
  return {
    concern: command === "app.create"
      ? "apps/registration"
      : "documents/addressing",
    command,
    targets: [id("app", 1)],
    input: { kind: "inline", value: {} },
    input_hash: "4".repeat(64),
    comparison: {},
    binding_hash: BINDING,
  };
}

function core(command: string, extra: unknown[] = []) {
  return fakeCore({
    "read:questions/read": () =>
      ok({
        group: {
          id: GRP,
          status: "pending",
          created_seq: "20",
          expires_at: null,
          questions: [{
            id: QST,
            group: GRP,
            position: 1,
            options: [{ key: "go", label: "Go", action: action(command) }],
            recommendation: null,
          }, ...extra],
        },
      }),
    "read:questions/text": () =>
      ok({
        group: GRP,
        questions: [{
          question: QST,
          prompt: "Go?",
          reason: "Because.",
          options: [{ key: "go", description: "Go ahead." }],
          recommendation: null,
          answer_text: null,
        }],
        closed_reason_text: null,
      }),
    "command:questions/answer-action": () =>
      ok({ id: GRP, status: "answered", closed_seq: "21", replayed: false }),
  });
}

async function confirm(command: string, extra: unknown[] = []) {
  const registered: unknown[] = [];
  const fake = core(command, extra);
  const result = await confirmWithoutWindow({
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
    group: GRP,
    optionKey: "go",
    nowMs: Date.now(),
  });
  return { result, registered, calls: fake.calls };
}

for (const command of ["app.create", "apply_settings"]) {
  test(`shell/confirmation-window#R5, lophn-agent/questions#R13: ${command} 선택지는 확인 창 없이 정본을 다시 읽어 답으로 접수한다`, async () => {
    const { result, calls } = await confirm(command);
    assert.deepEqual(result, { ok: true });
    const sent = calls.find((call) => call.method === "answer-action");
    assert.ok(sent !== undefined);
    const body = sent.body as { input: Record<string, unknown> };
    // 묶음이 정본 참조이고 evidence가 답한 질문과 선택지를 가리킨다.
    assert.equal(body.input["group"], GRP);
    assert.equal(body.input["created_seq"], "20");
    assert.deepEqual(body.input["evidence"], { question: QST, option: "go" });
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

test("shell/confirmation-window#R5, lophn-agent/questions#R13: 질문이 둘 이상인 묶음은 app.create 선택지가 있어도 접수하지 않는다", async () => {
  const extra = [{
    id: id("qst", 2),
    group: GRP,
    position: 2,
    options: [{ key: "ok", label: "Fine", action: null }],
    recommendation: null,
  }];
  const { result, registered, calls } = await confirm("app.create", extra);
  assert.equal(result.ok, false);
  assert.equal(registered.length, 0);
  assert.equal(calls.some((call) => call.method === "answer-action"), false);
});
