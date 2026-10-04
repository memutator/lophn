import assert from "node:assert/strict";
import { test } from "node:test";

import { requestQuit } from "./quit.ts";

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
