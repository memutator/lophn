import assert from "node:assert/strict";
import { test } from "node:test";
import { mayReadOtherProject } from "./instruction-rules.ts";

test("다른 project 지침은 lophn만 읽는다", () => {
  assert.deepStrictEqual(mayReadOtherProject("lophn"), true);
  for (const role of ["project_manager", "operator"] as const) {
    assert.deepStrictEqual(mayReadOtherProject(role), false);
  }
});
