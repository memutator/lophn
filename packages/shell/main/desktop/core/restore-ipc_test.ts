// settings backup 복원 통로의 main IPC 테스트(platform#T54가 shell#T58을 제품 조립에 잇는다).
// desktop 창 본문만 부르고, 사람이 본 계획의 target·content_hash로만 결정 handle을 발급한다.
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RESTORE_CANCEL_CHANNEL,
  RESTORE_PLAN_CHANNEL,
  RESTORE_SUBMIT_CHANNEL,
} from "../../../ipc/restore.ts";
import {
  type CallerContents,
  ContentsRegistry,
  type IpcEvent,
} from "../ipc-guard.ts";
import { registerRestoreIpc, removeRestoreIpc } from "./restore-ipc.ts";
import type { RestorePipe } from "./restore.ts";

function sender(id: number, url: string): CallerContents {
  return { id, isDestroyed: () => false, mainFrame: { url, parent: null } };
}

function eventOf(contents: CallerContents): IpcEvent {
  return { sender: contents, senderFrame: contents.mainFrame };
}

const desktop = sender(1, "lophn-shell://desktop/index.html");
const overlay = sender(2, "lophn-shell://overlay/index.html");

function registry(): ContentsRegistry {
  const table = new ContentsRegistry();
  table.register({
    contents: desktop,
    origin: { scheme: "lophn-shell", host: "desktop", path: "/index.html" },
  });
  table.register({
    contents: overlay,
    origin: { scheme: "lophn-shell", host: "overlay", path: "/index.html" },
  });
  return table;
}

const CREATED_AT = "2026-10-01T00:00:00.000Z";
const HASH = "a".repeat(64);

// restore_plan_request에는 계획을, restore_request에는 결과를 바로 돌려주는 pipe.
function fakePipe() {
  const sent: unknown[] = [];
  const listeners = new Set<(payload: unknown) => void>();
  const push = (payload: unknown) => {
    for (const listener of [...listeners]) listener(payload);
  };
  const pipe: RestorePipe = {
    phase: "ready",
    restore(message) {
      sent.push(message);
      const body = message as { type: string; created_at: string };
      queueMicrotask(() =>
        push(
          body.type === "restore_plan_request"
            ? {
              type: "restore_plan",
              created_at: body.created_at,
              through_seq: "10",
              current_through_seq: "12",
              lost: { from_seq: "11", through_seq: "12", events: 2 },
              target: body.created_at,
              content_hash: HASH,
            }
            : {
              type: "restore_result",
              created_at: body.created_at,
              restored_through_seq: "10",
              previous_through_seq: "12",
            },
        )
      );
      return true;
    },
    confirmation(message) {
      sent.push(message);
      return true;
    },
    onMessage(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return { pipe, sent };
}

function setup() {
  const handlers = new Map<
    string,
    (event: IpcEvent, input: unknown) => Promise<unknown>
  >();
  const ipc = {
    handle: (
      channel: string,
      listener: (event: IpcEvent, input: unknown) => Promise<unknown>,
    ) => {
      handlers.set(channel, listener);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  };
  const { pipe, sent } = fakePipe();
  const registered: unknown[] = [];
  registerRestoreIpc(ipc, {
    registry: registry(),
    pipe: () => pipe,
    register: (request) => {
      registered.push(request);
      return Promise.resolve({
        ok: true,
        confirmation: "cfm_1",
        expiresAt: "2026-10-01T00:02:00.000Z",
      });
    },
    now: () => Date.parse(CREATED_AT),
  });
  const call = (channel: string, contents: CallerContents, input: unknown) =>
    handlers.get(channel)!(eventOf(contents), input);
  return { ipc, handlers, sent, registered, call };
}

test("platform/backup-and-migration#R13: overlay·앱 view는 복원 통로를 부르지 못한다", async () => {
  const { call, sent } = setup();
  const plan = await call(RESTORE_PLAN_CHANNEL, overlay, {
    created_at: CREATED_AT,
  });
  assert.deepEqual(plan, { ok: false, code: "forbidden", message: "" });
  const bad = await call(RESTORE_PLAN_CHANNEL, desktop, { created_at: 1 });
  assert.equal((bad as { code: string }).code, "invalid_input");
  assert.equal(sent.length, 0);
});

test("platform/backup-and-migration#R13: 계획을 읽지 않은 묶음은 handle 없이 거절한다", async () => {
  const { call, sent, registered } = setup();
  const reply = await call(RESTORE_SUBMIT_CHANNEL, desktop, {
    created_at: CREATED_AT,
  });
  assert.equal((reply as { code: string }).code, "precondition_failed");
  assert.equal(registered.length, 0);
  assert.equal(sent.length, 0);
});

test("platform/backup-and-migration#R13: 사람이 본 계획의 target·content_hash로 restore_backup handle을 발급해 복원한다", async () => {
  const { call, sent, registered, ipc, handlers } = setup();
  const plan = await call(RESTORE_PLAN_CHANNEL, desktop, {
    created_at: CREATED_AT,
  });
  assert.deepEqual(plan, {
    ok: true,
    created_at: CREATED_AT,
    through_seq: "10",
    current_through_seq: "12",
    lost: { from_seq: "11", through_seq: "12", events: 2 },
  });
  const result = await call(RESTORE_SUBMIT_CHANNEL, desktop, {
    created_at: CREATED_AT,
  });
  assert.deepEqual(result, {
    ok: true,
    created_at: CREATED_AT,
    restored_through_seq: "10",
    previous_through_seq: "12",
    restarted: true,
  });
  assert.deepEqual(registered, [{
    type: "confirmation_handle_register",
    window_id: "settings-restore",
    target_ref: CREATED_AT,
    content_hash: HASH,
    allowed_decisions: ["restore_backup"],
    expires_at: "2026-10-01T00:02:00.000Z",
  }]);
  assert.deepEqual(sent.at(-1), {
    type: "restore_request",
    created_at: CREATED_AT,
    confirmation: "cfm_1",
  });
  // 한 번 확인은 한 번 복원이다. 같은 묶음을 다시 내려면 계획을 다시 읽는다.
  const again = await call(RESTORE_SUBMIT_CHANNEL, desktop, {
    created_at: CREATED_AT,
  });
  assert.equal((again as { code: string }).code, "precondition_failed");
  removeRestoreIpc(ipc);
  assert.equal(handlers.size, 0);
});

test("platform/backup-and-migration#R13: 확인 자리를 닫으면 계획을 버려 그 뒤 제출은 거절한다", async () => {
  const { call, sent, registered } = setup();
  await call(RESTORE_PLAN_CHANNEL, desktop, { created_at: CREATED_AT });
  const sentAfterPlan = sent.length;
  const cancelled = await call(RESTORE_CANCEL_CHANNEL, desktop, {
    created_at: CREATED_AT,
  });
  assert.deepEqual(cancelled, { ok: true });
  const reply = await call(RESTORE_SUBMIT_CHANNEL, desktop, {
    created_at: CREATED_AT,
  });
  assert.equal((reply as { code: string }).code, "precondition_failed");
  assert.equal(registered.length, 0);
  assert.equal(sent.length, sentAfterPlan);
});
