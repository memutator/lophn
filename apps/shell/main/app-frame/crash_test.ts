import assert from "node:assert/strict";
import { test } from "node:test";

import { nextHealth, reopenable, type ViewHealth } from "./crash.ts";

test("shell/app-frame#R21: 화면 process 신호로 view 상태가 바뀌고 crash는 새 view 전까지 남는다", () => {
  const steps: [
    ViewHealth,
    "gone" | "unresponsive" | "responsive",
    ViewHealth,
  ][] = [
    ["ok", "unresponsive", "unresponsive"],
    ["unresponsive", "responsive", "ok"],
    ["ok", "responsive", "ok"],
    ["ok", "gone", "crashed"],
    ["unresponsive", "gone", "crashed"],
    ["crashed", "responsive", "crashed"],
    ["crashed", "unresponsive", "crashed"],
  ];
  for (const [from, signal, to] of steps) {
    assert.equal(nextHealth(from, signal), to, `${from} + ${signal}`);
  }
  assert.equal(reopenable("ok"), false);
  assert.equal(reopenable("unresponsive"), true);
  assert.equal(reopenable("crashed"), true);
});
