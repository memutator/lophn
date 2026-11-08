import assert from "node:assert/strict";
import { test } from "node:test";

import { nextEntry, previousEntry } from "./history.ts";

test("↑는 글이 비었거나 넘기는 중일 때만 가고, ↓는 가장 새 글을 지나면 넘기기 전 글로 돌아간다", () => {
  const history = ["third", "second", "first"];
  const up = previousEntry(history, "", null);
  assert.equal(up?.text, "third");
  // 사람이 친 글이 있으면 ↑는 캐럿을 움직이게 둔다.
  assert.equal(previousEntry(history, "typed", null), null);
  const older = previousEntry(history, "third", up?.browse ?? null);
  assert.equal(older?.text, "second");
  assert.equal(
    previousEntry(history, "first", { index: 2, unsent: "" })?.text,
    "first",
  );
  const newer = nextEntry(history, older?.browse ?? null);
  assert.equal(newer?.text, "third");
  const back = nextEntry(history, newer?.browse ?? null);
  assert.deepEqual(back, { text: "", browse: null });
  assert.deepEqual(nextEntry(history, { index: 0, unsent: "draft" }), {
    text: "draft",
    browse: null,
  });
  assert.equal(nextEntry(history, null), null);
  assert.equal(previousEntry([], "", null), null);
});
