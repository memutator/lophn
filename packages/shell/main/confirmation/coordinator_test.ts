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
import { contentBasis } from "./handle.ts";

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

const GRANT_APPROVAL = "grant_approval_request";
const REJECT_APPROVAL = "reject_approval_request";
const THREE = {
  approval: INTENT.approval,
  binding_hash: "a".repeat(64),
  created_seq: "1",
};

/** session 허락이 되는 request의 정본: session을 미리 고르면 binding 내용에 scope가 묶인다. */
function sessionCanon(env: ReturnType<typeof fake>) {
  const base = env.canon.value;
  env.canon.byIntent = (intent) => ({
    ...base,
    content: intent.kind === "approval_request" &&
        intent.preselect === "allow_session"
      ? { ...THREE, scope: "session" }
      : THREE,
  });
}

test("platform/approvals#R19, shell/confirmation-window#R1 [agent-I42]: 창은 미리 고른 범위로 열려 handle을 그 범위의 binding 내용에 묶는다", async () => {
  const env = fake();
  sessionCanon(env);
  const confirm = coordinator(env);
  const opened = await confirm.open({
    intent: { ...INTENT, preselect: "allow_session" },
    parent: parent("shell-1"),
    requestedByPerson: true,
  });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  assert.deepEqual(env.canon.intents[0], {
    ...INTENT,
    preselect: "allow_session",
  });
  assert.deepEqual(env.handles.registered, [
    contentBasis({ ...THREE, scope: "session" }),
  ]);
  // 고른 범위 그대로 허락하면 handle을 다시 만들지 않는다.
  const granted = await confirm.submit({
    windowId: opened.value.windowId,
    displayId: opened.value.displayId,
    decision: GRANT_APPROVAL,
    commandInput: { scope: "session" },
  });
  assert.equal(granted.ok, true);
  assert.equal(env.handles.issued, 1);
  assert.equal(env.submitted.length, 1);
  assert.equal(
    env.submitted[0]?.contentHash,
    contentBasis({ ...THREE, scope: "session" }),
  );
});

test("platform/approvals#R19, shell/confirmation-window#R1 [agent-I42]: 창에서 범위를 바꿔 결정하면 그 범위에 handle을 다시 묶은 뒤에만 제출한다", async () => {
  // once 미리 선택 -> session 허락.
  const env = fake();
  sessionCanon(env);
  const confirm = coordinator(env);
  const opened = await confirm.open({
    intent: { ...INTENT, preselect: "allow_once" },
    parent: parent("shell-1"),
    requestedByPerson: true,
  });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  assert.deepEqual(env.handles.registered, [contentBasis(THREE)]);
  const session = await confirm.submit({
    windowId: opened.value.windowId,
    displayId: opened.value.displayId,
    decision: GRANT_APPROVAL,
    commandInput: { scope: "session" },
  });
  assert.equal(session.ok, true);
  assert.deepEqual(env.handles.registered, [
    contentBasis(THREE),
    contentBasis({ ...THREE, scope: "session" }),
  ]);
  assert.equal(env.submitted.length, 1);
  assert.equal(
    env.submitted[0]?.contentHash,
    contentBasis({ ...THREE, scope: "session" }),
  );

  // session 미리 선택 -> Deny는 scope 없는 binding이다.
  const other = fake();
  sessionCanon(other);
  const rejecting = coordinator(other);
  const window = await rejecting.open({
    intent: { ...INTENT, preselect: "allow_session" },
    parent: parent("shell-1"),
    requestedByPerson: true,
  });
  assert.equal(window.ok, true);
  if (!window.ok) return;
  const rejected = await rejecting.submit({
    windowId: window.value.windowId,
    displayId: window.value.displayId,
    decision: REJECT_APPROVAL,
  });
  assert.equal(rejected.ok, true);
  assert.deepEqual(other.submitted.map((sent) => sent.decision), [
    REJECT_APPROVAL,
  ]);
  assert.equal(other.submitted[0]?.contentHash, contentBasis(THREE));

  // session 미리 선택 -> once 허락도 scope 없는 binding이다.
  const third = fake();
  sessionCanon(third);
  const once = coordinator(third);
  const shown = await once.open({
    intent: { ...INTENT, preselect: "allow_session" },
    parent: parent("shell-1"),
    requestedByPerson: true,
  });
  assert.equal(shown.ok, true);
  if (!shown.ok) return;
  const allowed = await once.submit({
    windowId: shown.value.windowId,
    displayId: shown.value.displayId,
    decision: GRANT_APPROVAL,
  });
  assert.equal(allowed.ok, true);
  assert.equal(third.submitted[0]?.contentHash, contentBasis(THREE));
});

test("platform/approvals#R18, platform/approvals#R20 [agent-I42]: 계속 허락 같은 범위나 session을 쓸 수 없는 request의 session 허락은 제출하지 않는다", async () => {
  const env = fake();
  sessionCanon(env);
  const confirm = coordinator(env);
  const opened = await confirm.open({
    intent: INTENT,
    parent: parent("shell-1"),
    requestedByPerson: true,
  });
  assert.equal(opened.ok, true);
  if (!opened.ok) return;
  for (const scope of ["always", "project", "", null, 1]) {
    const result = await confirm.submit({
      windowId: opened.value.windowId,
      displayId: opened.value.displayId,
      decision: GRANT_APPROVAL,
      commandInput: { scope },
    });
    assert.equal(result.ok, false, String(scope));
    if (!result.ok) assert.equal(result.error.code, "invalid_input");
  }
  assert.equal(env.submitted.length, 0);
  assert.equal(env.handles.issued, 1);

  // session 허락이 아닌 request는 정본이 session을 받아 주지 않는다. once로 바꿔 보내지 않는다.
  const closed = fake();
  const fixed = closed.canon.value;
  closed.canon.byIntent = () => ({ ...fixed, content: THREE });
  const plain = coordinator(closed);
  const window = await plain.open({
    intent: { ...INTENT, preselect: "allow_session" },
    parent: parent("shell-1"),
    requestedByPerson: true,
  });
  assert.equal(window.ok, true);
  if (!window.ok) return;
  const denied = await plain.submit({
    windowId: window.value.windowId,
    displayId: window.value.displayId,
    decision: GRANT_APPROVAL,
    commandInput: { scope: "session" },
  });
  assert.equal(denied.ok, false);
  assert.equal(closed.submitted.length, 0);
});
