// shell/terminal#R3, R8: preload의 터미널 통로는 고정 채널 일곱 개만 열고
// Electron 오류는 unavailable로 바꾼다. renderer는 채널 이름을 모른다.
import assert from "node:assert/strict";
import { test } from "node:test";

import { createTerminalApi } from "../../preload/terminal-api.ts";

test("shell/terminal#R3: preload 터미널 통로는 고정 동작만 열고 frozen이다", async () => {
  const calls: [string, unknown][] = [];
  const api = createTerminalApi({
    invoke(channel, input) {
      calls.push([channel, input]);
      return Promise.resolve({ ok: true, value: null });
    },
  });
  assert.deepEqual(Object.keys(api), [
    "open",
    "input",
    "resize",
    "close",
    "restart",
    "snapshot",
    "focus",
  ]);
  assert(Object.isFrozen(api));
  const ref = { terminal_ref: "term_1", generation: 1 };
  await api.open({ project: "prj_1" });
  await api.input({ ...ref, text: "ls\n" });
  await api.resize({ ...ref, columns: 100, rows: 30 });
  await api.close(ref);
  await api.restart(ref);
  await api.snapshot({ terminal_ref: "term_1", after_seq: 3 });
  await api.focus({ ...ref, focused: true });
  assert.deepEqual(calls.map(([channel]) => channel), [
    "shell:terminal-open",
    "shell:terminal-input",
    "shell:terminal-resize",
    "shell:terminal-close",
    "shell:terminal-restart",
    "shell:terminal-snapshot",
    "shell:terminal-focus",
  ]);
});

test("shell/terminal#R8: 통로가 던지면 renderer에는 unavailable만 간다", async () => {
  const api = createTerminalApi({
    invoke() {
      return Promise.reject(new Error("secret detail"));
    },
  });
  const reply = await api.snapshot({ terminal_ref: "term_1" });
  assert.equal(reply.ok, false);
  if (reply.ok) return;
  assert.equal(reply.error.code, "unavailable");
  assert.equal(JSON.stringify(reply).includes("secret detail"), false);
});
