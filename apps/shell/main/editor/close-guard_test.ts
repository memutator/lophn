import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CLOSE_GUARD_TIMEOUT_MS,
  CloseGuard,
  CloseGuards,
  type GuardTimer,
  guardWindowClose,
} from "./close-guard.ts";
import { createQuitFlow } from "../desktop/quit.ts";

function manualTimer() {
  const pending = new Map<number, { callback: () => void; ms: number }>();
  let next = 0;
  const timer: GuardTimer = {
    set(callback, ms) {
      next += 1;
      pending.set(next, { callback, ms });
      return next;
    },
    clear(handle) {
      pending.delete(handle as number);
    },
  };
  return {
    timer,
    pending,
    fire() {
      for (const [id, entry] of [...pending]) {
        pending.delete(id);
        entry.callback();
      }
    },
  };
}

function guard(timer = manualTimer()) {
  const sent: number[] = [];
  const logs: string[] = [];
  const made = new CloseGuard({
    send: (request) => sent.push(request),
    log: (message) => logs.push(message),
    timer: timer.timer,
  });
  return { guard: made, sent, logs, timer };
}

function fakeWindow() {
  let listener: ((event: { preventDefault(): void }) => void) | undefined;
  let closes = 0;
  let destroyed = false;
  return {
    window: {
      onClose(next: (event: { preventDefault(): void }) => void) {
        listener = next;
      },
      close() {
        closes += 1;
        // 다시 닫으면 OS가 close event를 다시 보낸다.
        const prevented = emit();
        if (!prevented) destroyed = true;
      },
      isDestroyed: () => destroyed,
    },
    /** 사람이 창 닫기를 눌렀다. 막혔으면 true. */
    emit,
    get closes() {
      return closes;
    },
    get destroyed() {
      return destroyed;
    },
  };
  function emit(): boolean {
    let prevented = false;
    listener?.({ preventDefault: () => (prevented = true) });
    if (!prevented) destroyed = true;
    return prevented;
  }
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

test("shell/editor#R1: 편집 중인 문서가 없으면 묻지 않고 창을 닫는다", () => {
  const { guard: made, sent } = guard();
  const win = fakeWindow();
  guardWindowClose(win.window, made, () => false);
  assert.equal(win.emit(), false);
  assert.equal(win.destroyed, true);
  assert.deepEqual(sent, []);
});

test("shell/editor#R1: 저장 중이거나 편집 종료가 남으면 창 닫기를 막고 renderer가 마지막 고침을 보낸 뒤 허락하면 한 번만 닫는다", async () => {
  const { guard: made, sent } = guard();
  const win = fakeWindow();
  guardWindowClose(win.window, made, () => false);
  made.setCounts({ unsettled: 0, open: 1 });
  assert.equal(win.emit(), true);
  assert.deepEqual(sent, [1]);
  made.answer(1, "allow");
  await settle();
  assert.equal(win.closes, 1);
  assert.equal(win.destroyed, true);
});

test("shell/editor#R1: 질문이 나가 있는 동안 온 닫기는 다시 묻지 않고 삼킨다", () => {
  const { guard: made, sent } = guard();
  const win = fakeWindow();
  guardWindowClose(win.window, made, () => false);
  made.setCounts({ unsettled: 1, open: 0 });
  assert.equal(win.emit(), true);
  assert.equal(win.emit(), true);
  assert.equal(win.emit(), true);
  assert.deepEqual(sent, [1]);
});

test("shell/editor#R1: 사람이 계속 편집을 고르면 창을 남기고, 사람에게 묻는 동안은 기한으로 닫지 않는다", async () => {
  const timer = manualTimer();
  const { guard: made, sent } = guard(timer);
  const win = fakeWindow();
  guardWindowClose(win.window, made, () => false);
  made.setCounts({ unsettled: 1, open: 0 });
  win.emit();
  assert.equal(timer.pending.size, 1);
  assert.equal([...timer.pending.values()][0]!.ms, CLOSE_GUARD_TIMEOUT_MS);
  made.answer(1, "asking");
  assert.equal(timer.pending.size, 0);
  made.answer(1, "stay");
  await settle();
  assert.equal(win.destroyed, false);
  // 다음 닫기는 새 질문이다.
  win.emit();
  assert.deepEqual(sent, [1, 2]);
});

test("shell/editor#R1: renderer가 답하지 않으면 기한 뒤 닫고 그 사실을 log로 남기며 늦은 답은 버린다", async () => {
  const timer = manualTimer();
  const { guard: made, logs } = guard(timer);
  const win = fakeWindow();
  guardWindowClose(win.window, made, () => false);
  made.setCounts({ unsettled: 1, open: 0 });
  win.emit();
  timer.fire();
  await settle();
  assert.equal(win.destroyed, true);
  assert.equal(logs.length, 1);
  made.answer(1, "stay");
  assert.equal(made.busy, false);
});

test("shell/editor#R1: 끄는 중이면 창 닫기를 묻지 않는다", () => {
  const { guard: made, sent } = guard();
  const win = fakeWindow();
  guardWindowClose(win.window, made, () => true);
  made.setCounts({ unsettled: 2, open: 0 });
  assert.equal(win.emit(), false);
  assert.deepEqual(sent, []);
});

test("shell/editor#R1 shell/desktop#R21: 끄기 확인의 저장 중 수는 창마다 renderer가 알린 저장 중·실패·불명·충돌 문서 수의 합이다", async () => {
  const guards = new CloseGuards();
  const first = guard().guard;
  const second = guard().guard;
  guards.add(1, first);
  guards.add(2, second);
  first.setCounts({ unsettled: 2, open: 3 });
  second.setCounts({ unsettled: 1, open: 0 });
  assert.equal(guards.pendingSaves(), 3);
  // tray Quit은 이 수로 묻는다.
  const prompts: string[] = [];
  const quit = createQuitFlow({
    work: {
      runningTerminals: () => 0,
      pendingSaves: () => guards.pendingSaves(),
    },
    confirm: (prompt) => {
      prompts.push(prompt.detail);
      return Promise.resolve(false);
    },
    stop: () => {},
    quitApp: () => {},
  });
  assert.equal(await quit.request(), "cancelled");
  assert.equal(prompts.length, 1);
  guards.remove(1);
  assert.equal(guards.pendingSaves(), 1);
  second.setCounts({ unsettled: 0, open: 1 });
  assert.equal(guards.pendingSaves(), 0);
});
