import assert from "node:assert/strict";
import { test } from "node:test";

import { en } from "../../../../packages/design/wording/en.ts";
import {
  createQuitFlow,
  quitChosen,
  quitDialogOptions,
  type QuitPrompt,
  quitPrompt,
  requestQuit,
} from "./quit.ts";

function flow(work: { terminals?: number; saves?: number }, answer = true) {
  const order: string[] = [];
  const prompts: QuitPrompt[] = [];
  const quit = createQuitFlow({
    work: {
      runningTerminals: () => work.terminals ?? 0,
      pendingSaves: () => work.saves ?? 0,
    },
    confirm: (prompt) => {
      prompts.push(prompt);
      return Promise.resolve(answer);
    },
    stop: () => void order.push("stop"),
    quitApp: () => void order.push("app"),
    log: () => {},
  });
  return { quit, order, prompts };
}

test("shell/desktop#R21: 진행 중인 일이 없으면 Quit은 묻지 않고 터미널·core를 멈춘 뒤 끝낸다", async () => {
  const { quit, order, prompts } = flow({});
  assert.equal(await quit.request(), "quit");
  assert.deepEqual(prompts, []);
  assert.deepEqual(order, ["stop", "app"]);
  assert.equal(quit.quitting, true);
});

test("shell/desktop#R21: 실행 중 터미널이 있으면 확인한 뒤에만 멈춘다", async () => {
  const yes = flow({ terminals: 2 });
  assert.equal(await yes.quit.request(), "quit");
  assert.equal(yes.prompts.length, 1);
  assert.equal(yes.prompts[0]!.detail, en["common.quit.terminals"]);
  assert.deepEqual(yes.order, ["stop", "app"]);

  const no = flow({ terminals: 1 }, false);
  assert.equal(await no.quit.request(), "cancelled");
  assert.deepEqual(no.order, []);
  assert.equal(no.quit.quitting, false);
});

test("shell/desktop#R21: 저장 중인 변경이 있으면 그 사실을 묻는다", () => {
  assert.equal(
    quitPrompt({ runningTerminals: () => 0, pendingSaves: () => 1 })?.detail,
    en["common.quit.saves"],
  );
  assert.equal(
    quitPrompt({ runningTerminals: () => 1, pendingSaves: () => 3 })?.detail,
    en["common.quit.terminals-and-saves"],
  );
  const prompt = quitPrompt({
    runningTerminals: () => 1,
    pendingSaves: () => 0,
  })!;
  assert.equal(prompt.title, en["common.title.quit"]);
  assert.equal(prompt.quit, en["common.button.quit"]);
  assert.equal(prompt.cancel, en["common.button.cancel"]);
});

test("shell/desktop#R21: 끄기 확인의 기본·Esc는 취소이고 Quit을 고른 때만 끈다", () => {
  const prompt = quitPrompt({
    runningTerminals: () => 1,
    pendingSaves: () => 0,
  })!;
  const options = quitDialogOptions(prompt);
  assert.deepEqual(options.buttons, ["Quit", "Cancel"]);
  assert.equal(options.defaultId, 1);
  assert.equal(options.cancelId, 1);
  assert.equal(quitChosen(0), true);
  assert.equal(quitChosen(1), false);
  assert.equal(quitChosen(-1), false);
});

test("shell/desktop#R21: 확인 창이 떠 있는 동안 다시 누른 Quit은 두 번째 창을 띄우지 않는다", async () => {
  let release: (answer: boolean) => void = () => {};
  const order: string[] = [];
  let asked = 0;
  const quit = createQuitFlow({
    work: { runningTerminals: () => 1, pendingSaves: () => 0 },
    confirm: () => {
      asked += 1;
      return new Promise((resolve) => (release = resolve));
    },
    stop: () => void order.push("stop"),
    quitApp: () => void order.push("app"),
  });
  const first = quit.request();
  assert.equal(await quit.request(), "busy");
  release(true);
  assert.equal(await first, "quit");
  assert.equal(asked, 1);
  assert.deepEqual(order, ["stop", "app"]);
  // 이미 끄는 중이면 다시 멈추지 않는다.
  assert.equal(await quit.request(), "quit");
  quit.stopNow();
  assert.deepEqual(order, ["stop", "app"]);
});

test("shell/desktop#R21: 확인 창을 띄우지 못하면 끄지 않는다", async () => {
  const order: string[] = [];
  const logs: string[] = [];
  const quit = createQuitFlow({
    work: { runningTerminals: () => 1, pendingSaves: () => 0 },
    confirm: () => Promise.reject(new Error("no display")),
    stop: () => void order.push("stop"),
    quitApp: () => void order.push("app"),
    log: (message) => logs.push(message),
  });
  assert.equal(await quit.request(), "cancelled");
  assert.deepEqual(order, []);
  assert.equal(logs.length, 1);
});

test("shell/desktop#R21: 창이 없으면 log를 남기고 core 종료 순서를 밟는다", () => {
  const logs: string[] = [];
  let stopped = false;
  let quit = false;
  requestQuit({
    windows: { hasWindows: () => false },
    shutdownCore: () => {
      stopped = true;
    },
    quitApp: () => {
      quit = true;
    },
    log: (message) => logs.push(message),
  });
  assert.equal(stopped, true);
  assert.equal(quit, true);
  assert.equal(logs.length, 1);
  assert.ok(logs[0]!.includes("창이 없"));
});

test("shell/desktop#R21: 창이 있으면 끄기 확인 경로로 보내고 core를 멈추지 않는다", () => {
  const logs: string[] = [];
  let stopped = false;
  let quit = false;
  let confirmed = false;
  requestQuit({
    windows: { hasWindows: () => true },
    shutdownCore: () => {
      stopped = true;
    },
    quitApp: () => {
      quit = true;
    },
    confirmWithWindows: () => {
      confirmed = true;
    },
    log: (message) => logs.push(message),
  });
  assert.equal(confirmed, true);
  assert.equal(stopped, false);
  assert.equal(quit, false);
  assert.deepEqual(logs, []);
});

test("shell/desktop#R21: --quit은 자동 종료가 아니라 명시 종료다", () => {
  // 명시 종료 순서는 core 정상 종료(shutdown→quit)를 밟는다. 순서를 본다.
  const order: string[] = [];
  requestQuit({
    windows: { hasWindows: () => false },
    shutdownCore: () => order.push("core"),
    quitApp: () => order.push("app"),
  });
  assert.deepEqual(order, ["core", "app"]);
});
