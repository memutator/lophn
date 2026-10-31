import assert from "node:assert/strict";
import { test } from "node:test";

import type { GroupNode } from "./desk-model.ts";
import { neighborLeaf } from "./group-geometry.ts";

const leaf = (tab: string): GroupNode => ({ tab });

test("방향 키는 맞닿은 칸 중 겹침이 큰 칸으로 가고 가장자리에서는 멈춘다", () => {
  // 왼쪽에 a, 오른쪽에 위 b(0.25)와 아래 c(0.75).
  const root: GroupNode = {
    dir: "row",
    ratio: 0.5,
    a: leaf("a"),
    b: { dir: "column", ratio: 0.25, a: leaf("b"), b: leaf("c") },
  };
  assert.equal(neighborLeaf(root, "a", "right"), "c");
  assert.equal(neighborLeaf(root, "b", "left"), "a");
  assert.equal(neighborLeaf(root, "b", "down"), "c");
  assert.equal(neighborLeaf(root, "c", "up"), "b");
  assert.equal(neighborLeaf(root, "a", "left"), null);
  assert.equal(neighborLeaf(root, "c", "down"), null);
  assert.equal(neighborLeaf(root, "a", "up"), null);
});
