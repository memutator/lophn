import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createPromptDelivery,
  type PromptTimer,
} from "../../../terminal-host/prompt-delivery.ts";

function fakeTimer() {
  const timers: { ms: number; fire: () => void; cancelled: boolean }[] = [];
  const timer: PromptTimer = (ms, fire) => {
    const entry = { ms, fire, cancelled: false };
    timers.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  return { timer, timers };
}

const stdin = {
  mode: "stdin_after_ready" as const,
  readiness: "Ready for input",
  deadline_ms: 10_000 as const,
};

test("shell/terminal#R12: argv는 PTY에 입력을 쓰지 않고 기한도 세지 않는다", () => {
  const writes: string[] = [];
  const { timer, timers } = fakeTimer();
  const run = createPromptDelivery({
    delivery: { mode: "argv" },
    prompt: "do the ticket",
    write: (text) => writes.push(text),
    timer,
  });
  run.start();
  run.output("Ready for input");
  run.exited();
  assert.equal(run.outcome(), "none");
  assert.deepEqual(writes, []);
  assert.equal(timers.length, 0);
});

test("shell/terminal#R12: stdin_after_ready는 readiness를 보면 정확히 한 번만 쓰고 delivered다", () => {
  const writes: string[] = [];
  const seen: string[] = [];
  const { timer, timers } = fakeTimer();
  const run = createPromptDelivery({
    delivery: stdin,
    prompt: "line one\nline two",
    write: (text) => writes.push(text),
    timer,
    onChange: (outcome) => seen.push(outcome),
  });
  run.start();
  assert.equal(run.outcome(), "pending");
  assert.equal(timers[0]?.ms, 10_000);
  run.output("booting...");
  assert.deepEqual(writes, []);
  // ANSI 제어열 사이에 낀 readiness와 chunk 경계에 걸린 readiness도 찾는다.
  run.output("\u001b[1mRead");
  run.output("y for\u001b[0m input");
  assert.equal(run.outcome(), "delivered");
  assert.equal(writes.length, 1);
  assert.equal(writes[0], "\u001b[200~line one\nline two\u001b[201~\r");
  // 다시 준비 표시가 와도, 기한이 지나도, process가 끝나도 다시 쓰지 않는다.
  run.output("Ready for input");
  timers[0]?.fire();
  run.exited();
  assert.equal(writes.length, 1);
  assert.equal(run.outcome(), "delivered");
  assert.equal(timers[0]?.cancelled, true);
  assert.deepEqual(seen, ["delivered"]);
});

test("shell/terminal#R12: spawn부터 10,000ms 안에 readiness가 없으면 not_delivered이고 뒤늦은 신호로 쓰지 않는다", () => {
  const writes: string[] = [];
  const { timer, timers } = fakeTimer();
  const run = createPromptDelivery({
    delivery: stdin,
    prompt: "do the ticket",
    write: (text) => writes.push(text),
    timer,
  });
  run.start();
  timers[0]?.fire();
  assert.equal(run.outcome(), "not_delivered");
  run.output("Ready for input");
  assert.deepEqual(writes, []);
  assert.equal(run.outcome(), "not_delivered");
});

test("shell/terminal#R12: 준비 전에 process가 끝나면 not_delivered다", () => {
  const writes: string[] = [];
  const { timer } = fakeTimer();
  const run = createPromptDelivery({
    delivery: stdin,
    prompt: "do the ticket",
    write: (text) => writes.push(text),
    timer,
  });
  run.start();
  run.exited();
  run.output("Ready for input");
  assert.equal(run.outcome(), "not_delivered");
  assert.deepEqual(writes, []);
});

test("shell/terminal#R12: 쓰다가 실패해 결과를 모르면 unknown이고 재전송하지 않는다", () => {
  let attempts = 0;
  const { timer } = fakeTimer();
  const run = createPromptDelivery({
    delivery: stdin,
    prompt: "do the ticket",
    write: () => {
      attempts++;
      throw new Error("pipe closed");
    },
    timer,
  });
  run.start();
  run.output("Ready for input");
  assert.equal(run.outcome(), "unknown");
  run.output("Ready for input");
  run.exited();
  assert.equal(attempts, 1);
  assert.equal(run.outcome(), "unknown");
});
