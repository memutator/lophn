import assert from "node:assert/strict";
import { test } from "node:test";

import type { GroupNode } from "./desk-model.ts";
import { FULL, neighborLeaf, placeGroup } from "./group-geometry.ts";

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

  // leaf 하나짜리 bundle은 FULL 한 칸이고 나눔 선과 이웃 칸이 없다.
  const bundle: GroupNode = { tab: "a", stack: ["a", "b"] };
  const placed = placeGroup(bundle, "8px");
  assert.deepEqual([...placed.leaves.entries()], [["a", FULL]]);
  assert.deepEqual(placed.splits, []);
  assert.equal(neighborLeaf(bundle, "a", "right"), null);
});
