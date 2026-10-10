import assert from "node:assert/strict";
import { test } from "node:test";

import {
  app,
  coordinator,
  fake,
  INTENT,
  parent,
  REF,
} from "./coordinator_fixture.ts";

test("shell/confirmation-window#R1: event만으로는 창을 열지 않고 사람이 연 요청만 연다", async () => {
  const env = fake();
  const confirm = coordinator(env);
  confirm.noteRequest(INTENT);
  assert.equal(env.windows.length, 0);
  const denied = await confirm.open({
    intent: INTENT,
    parent: parent("shell-1"),
    requestedByPerson: false,
  });
  assert.equal(denied.ok, false);
  assert.equal(env.windows.length, 0);
});

test("shell/confirmation-window#R6: child modal은 앱 view를 숨기지 않고 입력만 막는다", async () => {
  const env = fake();
  const view = app(7);
  env.apps.set("shell-1", [view]);
  const confirm = coordinator(env);
  const opened = await confirm.open({
    intent: INTENT,
    parent: parent("shell-1"),
    requestedByPerson: true,
  });
  assert.equal(opened.ok, true);
  assert.equal(view.hidden, false);
  assert.equal(view.blocked, true);
  assert.equal(env.sessions[0]?.startsWith("confirmation-"), true);
  assert.equal(env.windows[0]?.shown, true);
  env.windows[0]?.close();
  assert.equal(view.blocked, false);
});

test("shell/confirmation-window#R5: 독립 조회가 끝나기 전에는 제출할 결정이 없다", async () => {
  const env = fake();
  env.canon.fail = true;
  const confirm = coordinator(env);
  const opened = await confirm.open({
    intent: INTENT,
    parent: parent("shell-1"),
    requestedByPerson: true,
  });
  assert.equal(opened.ok, true);
  if (opened.ok) assert.equal(opened.value.gate.state, "stale");
  assert.equal(env.handles.issued, 0);
});

test("shell/confirmation-window#R5: 대상이 바뀌면 옛 버튼으로 결정하지 못한다", async () => {
  const env = fake();
  const confirm = coordinator(env);
  const opened = await confirm.open({
    intent: INTENT,
    parent: parent("shell-1"),
    requestedByPerson: true,
  });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  env.canon.value = {
    ...env.canon.value,
    content: {
      approval: INTENT.approval,
      binding_hash: "a".repeat(64),
      created_seq: "2",
    },
  };
  const submitted = await confirm.submit({
    windowId: opened.value.windowId,
    displayId: opened.value.displayId,
    decision: "grant_approval_request",
  });
  assert.equal(submitted.ok, false);
  assert.equal(env.submitted.length, 0);
  assert.equal(confirm.gate(opened.value.windowId)?.state, "stale");
  const shown = env.windows[0]?.sent.at(-1) as { request?: unknown };
  assert.equal(
    shown.request === undefined || "created_seq" in (shown.request as object),
    true,
  );
  assert.equal(JSON.stringify(shown).includes("gate"), false);
});

test("shell/confirmation-window#R9: 같은 handle의 두 번째 제출은 새 결정을 만들지 않는다", async () => {
  const env = fake();
  const confirm = coordinator(env);
  const opened = await confirm.open({
    intent: INTENT,
    parent: parent("shell-1"),
    requestedByPerson: true,
  });
  if (!opened.ok) return;
  const first = await confirm.submit({
    windowId: opened.value.windowId,
    displayId: opened.value.displayId,
    decision: "grant_approval_request",
  });
  assert.equal(first.ok, true);
  const second = await confirm.submit({
    windowId: opened.value.windowId,
    displayId: opened.value.displayId,
    decision: "reject_approval_request",
  });
  assert.equal(second.ok, false);
  assert.equal(env.submitted.length, 1);
  assert.equal(env.submitted[0]?.ref, REF);
});

test("shell/confirmation-window#R9: 닫기·취소는 결정을 만들지 않고 handle을 무효로 한다", async () => {
  const env = fake();
  const confirm = coordinator(env);
  const opened = await confirm.open({
    intent: INTENT,
    parent: parent("shell-1"),
    requestedByPerson: true,
  });
  if (!opened.ok) return;
  const cancelled = await confirm.cancel(opened.value.windowId);
  assert.deepEqual(cancelled, { outcome: "dismissed" });
  assert.equal(env.submitted.length, 0);
  assert.equal(env.handles.closed.length, 1);
  const again = await confirm.submit({
    windowId: opened.value.windowId,
    displayId: opened.value.displayId,
    decision: "grant_approval_request",
  });
  assert.equal(again.ok, false);
});

test("shell/confirmation-window#R4: 2차 확인 없이는 위험한 결정을 제출하지 않는다", async () => {
  const env = fake();
  env.canon.value = { ...env.canon.value, secondConfirm: true };
  const confirm = coordinator(env);
  const opened = await confirm.open({
    intent: INTENT,
    parent: parent("shell-1"),
    requestedByPerson: true,
  });
  if (!opened.ok) return;
  const blocked = await confirm.submit({
    windowId: opened.value.windowId,
    displayId: opened.value.displayId,
    decision: "grant_approval_request",
  });
  assert.equal(blocked.ok, false);
  assert.equal(env.submitted.length, 0);
  const passed = await confirm.submit({
    windowId: opened.value.windowId,
    displayId: opened.value.displayId,
    decision: "grant_approval_request",
    confirmedSecond: true,
  });
  assert.equal(passed.ok, true);
});

test("shell/confirmation-window#R7: renderer로 나가는 표시에는 handle 원문이 없다", async () => {
  const env = fake();
  const confirm = coordinator(env);
  const opened = await confirm.open({
    intent: INTENT,
    parent: parent("shell-1"),
    requestedByPerson: true,
  });
  if (!opened.ok) return;
  const payload = JSON.stringify(env.windows[0]?.sent);
  assert.equal(payload.includes(REF), false);
  assert.equal(confirm.exposed(opened.value.windowId).ref, undefined);
  assert.equal(opened.value.displayId.startsWith("dsp_"), true);
});

test("shell/confirmation-window#R9: core가 다시 시작되면 열린 handle을 버린다", async () => {
  const env = fake();
  let epoch = "epoch-1";
  const confirm = coordinator(env, () => true, () => epoch);
  const opened = await confirm.open({
    intent: INTENT,
    parent: parent("shell-1"),
    requestedByPerson: true,
  });
  if (!opened.ok) return;
  epoch = "epoch-2";
  await confirm.onEpoch(epoch);
  assert.equal(env.handles.cleared, 1);
  const submitted = await confirm.submit({
    windowId: opened.value.windowId,
    displayId: opened.value.displayId,
    decision: "grant_approval_request",
  });
  assert.equal(submitted.ok, false);
  assert.equal(env.submitted.length, 0);
});

test("shell/app-frame#R30: 보호 창이 열려도 앱 view를 떼지 않는다", async () => {
  const env = fake();
  const view = app(3);
  env.apps.set("app-window", [view]);
  const confirm = coordinator(env);
  await confirm.open({
    intent: INTENT,
    parent: parent("app-window"),
    requestedByPerson: true,
  });
  assert.equal(view.hidden, false);
  assert.equal(env.hidden.length, 0);
  assert.equal(view.blocked, true);
});

test("shell/confirmation-window#R9: 기한이 지난 확인은 닫힐 때 expired로 연 창에만 알린다", async () => {
  const env = fake();
  env.canon.value = {
    ...env.canon.value,
    expiresAt: new Date(env.clock.now - 1000).toISOString(),
  };
  const confirm = coordinator(env);
  const sent: [string, unknown][] = [];
  const opened = await confirm.open({
    intent: INTENT,
    parent: parent("shell-1"),
    opener: {
      send: (channel, payload) => sent.push([channel, payload]),
      isDestroyed: () => false,
    },
    requestedByPerson: true,
  });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  assert.equal(confirm.gate(opened.value.windowId)?.state, "expired");
  await confirm.cancel(opened.value.windowId);
  assert.deepEqual(sent, [[
    "shell:confirmation-ended",
    { windowId: opened.value.windowId, ended: "expired" },
  ]]);
});
