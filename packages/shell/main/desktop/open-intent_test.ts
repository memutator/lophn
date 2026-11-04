import assert from "node:assert/strict";
import { test } from "node:test";

import { readOpenIntent } from "./open-intent.ts";

test("harness-gui intent는 harness와 절대 cwd가 맞을 때만 읽고 틀리면 기본 창이다", () => {
  const window = { kind: "window" };
  assert.deepEqual(
    readOpenIntent([
      "--harness-gui",
      "claude",
      "--cwd",
      "/work/a",
      "--resume",
      "s1",
    ]),
    { kind: "harness-gui", harness: "claude", cwd: "/work/a", resume: "s1" },
  );
  assert.deepEqual(
    readOpenIntent(["--harness-gui", "codex", "--cwd", "/work/a"]),
    {
      kind: "harness-gui",
      harness: "codex",
      cwd: "/work/a",
    },
  );
  for (const argv of [
    ["--harness-gui", "gemini", "--cwd", "/work/a"],
    ["--harness-gui", "claude", "--cwd", "work/a"],
    ["--harness-gui", "claude"],
    ["--harness-gui", "claude", "--cwd", "/a", "--cwd", "/b"],
    ["--harness-gui", "claude", "--cwd", "/a", "--resume", "--cwd"],
  ]) {
    assert.deepEqual(readOpenIntent(argv), window, argv.join(" "));
  }
});
