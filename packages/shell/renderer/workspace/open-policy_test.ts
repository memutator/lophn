import assert from "node:assert/strict";
import { test } from "node:test";

import {
  emptyDesk,
  FLOATS_MAX,
  floatTab,
  openFloatTab,
  openTab,
} from "../shell/desk-model.ts";
import { openAt } from "./open-policy.ts";

const rect = { x: 0, y: 0, width: 300, height: 200 };
const desk = ["agent", "other"].reduce(
  (item, key) => openTab(item, { key, kind: "agent", title: key }),
  emptyDesk("d", "D"),
);

test("agent가 말하지 않은 relation은 target으로 정해지고, source가 float이나 없으면 끝이다", () => {
  const folded = { kind: "float", minimized: true };
  assert.deepEqual(
    openAt(desk, "agent", "show", { relation: null, target: "browser" }),
    folded,
  );
  for (const target of ["session", "tui", "preview", "artifact"] as const) {
    assert.deepEqual(
      openAt(desk, "agent", "show", { relation: null, target }),
      { kind: "tab", after: "agent", relation: "aside" },
    );
  }
  assert.deepEqual(
    openAt(desk, "agent", "show", { relation: "glance", target: "browser" }),
    { kind: "float" },
  );
  assert.deepEqual(
    openAt(desk, undefined, "show", { relation: "peer", target: "session" }),
    { kind: "tab" },
  );
  const floated = floatTab(desk, "agent", rect);
  assert.deepEqual(
    openAt(floated, "agent", "show", { relation: "stage", target: "session" }),
    { kind: "tab" },
  );
});

test("float이 상한이면 agent의 work·glance 탭은 버려지지 않고 desk 끝 탭이다", () => {
  let full = desk;
  for (let index = 0; index < FLOATS_MAX; index++) {
    full = openFloatTab(
      full,
      { key: `f${index}`, kind: "agent", title: "f" },
      rect,
    );
  }
  for (const relation of [null, "glance"] as const) {
    assert.deepEqual(
      openAt(full, "agent", "show", { relation, target: "browser" }),
      { kind: "tab" },
    );
  }
});
