import assert from "node:assert/strict";
import { test } from "node:test";

import { emptyDesk, openTab } from "../shell/desk-model.ts";
import { openAt } from "./open-policy.ts";

const desk = ["agent", "other"].reduce(
  (item, key) => openTab(item, { key, kind: "agent", title: key }),
  emptyDesk("d", "D"),
);

test("agent가 연 탭의 힌트는 source의 자리로 풀리고, source가 없으면 끝이다", () => {
  assert.deepEqual(openAt(desk, "agent", "show", "beside"), {
    kind: "tab",
    after: "agent",
    beside: true,
  });
  assert.deepEqual(openAt(desk, "agent", "show", "group"), {
    kind: "tab",
    after: "agent",
    beside: true,
    grow: true,
  });
  assert.deepEqual(openAt(desk, "agent", "show", null), {
    kind: "tab",
    after: "agent",
  });
  assert.deepEqual(openAt(desk, undefined, "show", "beside"), { kind: "tab" });
  assert.deepEqual(openAt(desk, undefined, "show", "float"), { kind: "float" });
});
