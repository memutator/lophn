// settings backup 복원(pipe 연결) 테스트. contract 모양의 pipe 메시지로 계획 읽기·handle
// 발급·복원 제출을 확인한다(platform#T42, shell#T58). fake pipe는 보낸 메시지를 기록하고
// 등록된 listener에게 응답 frame을 흘려 보낸다.
import assert from "node:assert/strict";
import { test } from "node:test";

import type { CoreToMainMessage, MainToCoreMessage } from "../../../../protocol/supervision/mod.ts";

import { readRestorePlan, type RestorePipe, submitRestore } from "./restore.ts";

function fakePipe(): RestorePipe & {
  sent: MainToCoreMessage[];
  push(payload: CoreToMainMessage): void;
} {
  const sent: MainToCoreMessage[] = [];
  const listeners = new Set<(payload: CoreToMainMessage) => void>();
  return {
    sent,
    phase: "ready",
    restore(message) {
      sent.push(message);
      return true;
    },
    confirmation(message) {
      sent.push(message as MainToCoreMessage);
      return true;
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    push(payload) {
      for (const listener of listeners) listener(payload);
    },
  };
}

const CREATED_AT = "2026-10-01T00:00:00.000Z";

const PLAN = {
  type: "restore_plan",
  created_at: CREATED_AT,
  through_seq: "100",
  current_through_seq: "150",
  lost: { from_seq: "101", through_seq: "150", events: 50 },
  target: CREATED_AT,
  content_hash: "a".repeat(64),
};

test("shell/wording#R10: 복원 계획은 restore_plan_request로 읽고 잃을 기록 범위를 돌려준다", async () => {
  const pipe = fakePipe();
  const waiting = readRestorePlan(pipe, CREATED_AT, undefined, 50);
  await new Promise((resolve) => setTimeout(resolve, 1));
  // pipe에는 등록 요청 하나. handle 등록은 없다.
  assert.equal(pipe.sent.length, 1);
  assert.deepEqual(pipe.sent[0], {
    type: "restore_plan_request",
    created_at: CREATED_AT,
  });
  pipe.push(PLAN as CoreToMainMessage);
  const plan = await waiting;
  assert.deepEqual(plan, {
    ok: true,
    created_at: CREATED_AT,
    through_seq: "100",
    current_through_seq: "150",
    lost: { from_seq: "101", through_seq: "150", events: 50 },
  });
});

test("shell/wording#R10: 계획을 읽지 못한 복원은 restore_failed를 그대로 알리고 다른 결정을 만들지 않는다", async () => {
  const pipe = fakePipe();
  const waiting = readRestorePlan(pipe, CREATED_AT, undefined, 50);
  await new Promise((resolve) => setTimeout(resolve, 1));
  pipe.push({
    type: "restore_failed",
    stage: "plan",
    created_at: CREATED_AT,
    code: "not_found",
    message: "backup이 없다",
    restarted: false,
  });
  const plan = await waiting;
  assert.deepEqual(plan, {
    ok: false,
    code: "not_found",
    message: "backup이 없다",
  });
  assert.equal(
    pipe.sent.some((message) => message.type === "restore_request"),
    false,
  );
});

test("shell/wording#R10: 사람이 확인하면 결정 handle을 발급하고 restore_request를 보낸다", async () => {
  const pipe = fakePipe();
  const issued: { target: string; contentHash: string }[] = [];
  const waiting = submitRestore(
    pipe,
    (request) => {
      issued.push({ target: request.target, contentHash: request.contentHash });
      return Promise.resolve({
        ok: true,
        confirmation: "b".repeat(43),
        expiresAt: "2026-10-01T00:02:00.000Z",
      });
    },
    {
      createdAt: CREATED_AT,
      target: PLAN.target,
      contentHash: PLAN.content_hash,
    },
    undefined,
    5_000,
  );
  await new Promise((resolve) => setTimeout(resolve, 1));
  assert.deepEqual(issued, [
    { target: CREATED_AT, contentHash: PLAN.content_hash },
  ]);
  assert.equal(pipe.sent.length, 1);
  assert.deepEqual(pipe.sent[0], {
    type: "restore_request",
    created_at: CREATED_AT,
    confirmation: "b".repeat(43),
  });
  pipe.push({
    type: "restore_result",
    created_at: CREATED_AT,
    restored_through_seq: "100",
    previous_through_seq: "150",
  });
  const result = await waiting;
  assert.deepEqual(result, {
    ok: true,
    created_at: CREATED_AT,
    restored_through_seq: "100",
    previous_through_seq: "150",
    restarted: true,
  });
});

test("shell/wording#R10: handle을 받지 못한 복원은 아무것도 보내지 않고 그렇게 말한다", async () => {
  const pipe = fakePipe();
  const result = await submitRestore(
    pipe,
    () => Promise.resolve({ ok: false }),
    {
      createdAt: CREATED_AT,
      target: PLAN.target,
      contentHash: PLAN.content_hash,
    },
    undefined,
    50,
  );
  assert.deepEqual(result, {
    ok: false,
    code: "unavailable",
    message: "확인 handle을 받지 못했다",
    restarted: false,
  });
  assert.equal(pipe.sent.length, 0);
});

test("shell/wording#R10: 복원 실패는 restarted를 구별해 알린다", async () => {
  const pipe = fakePipe();
  const waiting = submitRestore(
    pipe,
    () =>
      Promise.resolve({
        ok: true,
        confirmation: "b".repeat(43),
        expiresAt: "2026-10-01T00:02:00.000Z",
      }),
    {
      createdAt: CREATED_AT,
      target: PLAN.target,
      contentHash: PLAN.content_hash,
    },
    undefined,
    5_000,
  );
  await new Promise((resolve) => setTimeout(resolve, 1));
  pipe.push({
    type: "restore_failed",
    stage: "restore",
    created_at: CREATED_AT,
    code: "conflict",
    message: "틀린 확인이다",
    restarted: false,
  });
  const result = await waiting;
  assert.deepEqual(result, {
    ok: false,
    code: "conflict",
    message: "틀린 확인이다",
    restarted: false,
  });
});
