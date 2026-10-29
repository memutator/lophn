import assert from "node:assert/strict";
import { test } from "node:test";
import { terminalEnv } from "./env.ts";

// 두 번 renderer만 고쳤는데 다시 생긴 bug다. 띄운 곳의 env와 상관없이 truecolor를 알린다.
test("터미널 shell은 띄운 process에 COLORTERM이 없거나 달라도 truecolor를 받는다", () => {
  assert.equal(terminalEnv({ TERM: "xterm-256color" }).COLORTERM, "truecolor");
  assert.equal(terminalEnv({ COLORTERM: "" }).COLORTERM, "truecolor");
  assert.equal(terminalEnv({ COLORTERM: "8bit" }).COLORTERM, "truecolor");
});
