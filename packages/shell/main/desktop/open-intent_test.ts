import assert from "node:assert/strict";
import { test } from "node:test";

import { readOpenIntent } from "./open-intent.ts";

test("harness-gui intent는 harness와 절대 cwd가 맞을 때만 읽고 틀리면 기본 창이다", () => {
  const window = { kind: "window" };
  assert.deepEqual(
    readOpenIntent(["--harness-gui=claude", "--cwd=/work/a", "--resume=s1"]),
    { kind: "harness-gui", harness: "claude", cwd: "/work/a", resume: "s1" },
  );
  assert.deepEqual(readOpenIntent(["--harness-gui=codex", "--cwd=/work/a"]), {
    kind: "harness-gui",
    harness: "codex",
    cwd: "/work/a",
  });
  for (const argv of [
    ["--harness-gui=gemini", "--cwd=/work/a"],
    ["--harness-gui=claude", "--cwd=work/a"],
    ["--harness-gui=claude"],
    ["--harness-gui=claude", "--cwd=/a", "--cwd=/b"],
    ["--harness-gui=claude", "--cwd=/a", "--resume=--cwd"],
    // 옛 꼴은 읽지 않는다.
    ["--harness-gui", "claude", "--cwd", "/work/a"],
  ]) {
    assert.deepEqual(readOpenIntent(argv), window, argv.join(" "));
  }
});

// 떠 있는 앱이 받는 second-instance argv. Chromium이 스위치를 앞에 모으고 자기 스위치를 끼운다.
// (`--flag value` 꼴은 값이 뒤로 흩어져 flag 옆에 남지 않아 기본 창으로 읽혔다.)
test("second-instance argv에서 = 꼴 harness-gui flag를 읽는다", () => {
  assert.deepEqual(
    readOpenIntent([
      "/opt/lophn/electron",
      "--no-sandbox",
      "--ozone-platform=headless",
      "--harness-gui=claude",
      "--cwd=/tmp/a b=c",
      "--resume=abc",
      "--allow-file-access-from-files",
      "/repo/packages/shell/main/dist/main.cjs",
    ]),
    {
      kind: "harness-gui",
      harness: "claude",
      cwd: "/tmp/a b=c",
      resume: "abc",
    },
  );
});
