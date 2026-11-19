import assert from "node:assert/strict";
import { test } from "node:test";

import { copyTerminalText, pasteTerminalText } from "./terminal-clipboard.ts";

// 여러 번 고칠 수 있는 Electron API 변경 회귀: clipboard.readText·writeText가 Promise를 돌려줘도
// IPC 응답이 plain cloneable 값이어야 Ctrl+Shift+V가 DataCloneError로 깨지지 않는다.
test("copy and paste await async clipboard methods, catch failures, and return cloneable IPC replies", async () => {
  let written = "";
  let committed = false;
  const asyncClipboard = {
    writeText: (text: string) =>
      new Promise<void>((resolve) => {
        setTimeout(() => {
          written = text;
          committed = true;
          resolve();
        }, 5);
      }),
    readText: () =>
      new Promise<string>((resolve) => {
        setTimeout(() => resolve("pasted text"), 5);
      }),
  };

  const copyReply = await copyTerminalText(asyncClipboard, "hello", false);
  assert.equal(committed, true);
  assert.equal(written, "hello");
  assert.deepEqual(structuredClone(copyReply), { ok: true, value: null });

  const pasteReply = await pasteTerminalText(asyncClipboard, false);
  assert.deepEqual(structuredClone(pasteReply), {
    ok: true,
    value: "pasted text",
  });

  // headless 모드에서는 OS clipboard를 건드리지 않는다.
  let touched = false;
  const guarded = {
    writeText: async () => {
      touched = true;
    },
    readText: async () => {
      touched = true;
      return "secret";
    },
  };
  assert.deepEqual(await copyTerminalText(guarded, "x", true), {
    ok: true,
    value: null,
  });
  assert.deepEqual(await pasteTerminalText(guarded, true), {
    ok: true,
    value: "",
  });
  assert.equal(touched, false);

  // clipboard 오류가 reject돼도 IPC 응답은 안전하게 빈 값으로 끝난다.
  const failing = {
    writeText: () => Promise.reject(new Error("clipboard busy")),
    readText: () => Promise.reject(new Error("clipboard denied")),
  };
  assert.deepEqual(await copyTerminalText(failing, "x", false), {
    ok: true,
    value: null,
  });
  assert.deepEqual(await pasteTerminalText(failing, false), {
    ok: true,
    value: "",
  });
});
