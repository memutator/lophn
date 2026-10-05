import assert from "node:assert/strict";
import { test } from "node:test";

import {
  notifyAlreadyRunning,
  resolveLaunchMode,
  TRAY_INTENT,
} from "./launch-mode.ts";

test("shell/desktop#R21: argv --tray는 창 없는 시작이다", () => {
  assert.deepEqual(resolveLaunchMode(["lophn", "--tray"]), { tray: true });
  assert.deepEqual(resolveLaunchMode({ argv: ["lophn", "--tray"] }), {
    tray: true,
  });
});

test("shell/desktop#R21: --tray가 없는 시작은 창을 연다", () => {
  assert.deepEqual(resolveLaunchMode(["lophn"]), { tray: false });
  assert.deepEqual(resolveLaunchMode({ argv: ["lophn", "--home", "/tmp"] }), {
    tray: false,
  });
  assert.deepEqual(resolveLaunchMode({}), { tray: false });
});

test("shell/desktop#R21: --tray intent 상수는 launcher가 쓰는 값이다", () => {
  assert.equal(TRAY_INTENT, "--tray");
});

test("shell/desktop#R21: 같은 데이터 root에 main이 있으면 실행 중이라고 알린다", () => {
  const shown: [string, string][] = [];
  notifyAlreadyRunning({
    show: (title, body) => shown.push([title, body]),
  });
  assert.deepEqual(shown, [["lophn", "이미 실행 중입니다"]]);
});

test("shell/desktop#R21: notification이 없으면 실행 중 안내를 log로 남긴다", () => {
  const logs: string[] = [];
  notifyAlreadyRunning({ log: (message) => logs.push(message) });
  assert.equal(logs.length, 1);
  assert.ok(logs[0]!.includes("실행 중"));
});

test("shell/desktop#R21: macOS login item으로 열린 시작은 argv 없이도 창 없는 시작이다", () => {
  assert.deepEqual(
    resolveLaunchMode({ argv: ["lophn"], openedAtLogin: true }),
    { tray: true },
  );
  assert.deepEqual(
    resolveLaunchMode({ argv: ["lophn"], openedAtLogin: false }),
    { tray: false },
  );
});
