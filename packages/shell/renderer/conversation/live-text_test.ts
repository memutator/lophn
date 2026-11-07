import assert from "node:assert/strict";
import { test } from "node:test";

import { splitLive } from "./live-text.ts";

test("splitLive cuts at a new block outside fences and joins back to the text", () => {
  const text = [
    "## Title",
    "",
    "Intro paragraph.",
    "",
    "- one",
    "",
    "- two",
    "",
    "```ts",
    "const a = 1;",
    "",
    "const b = 2;",
    "```",
    "",
    "Last paragraph, still growing",
  ].join("\n");
  const { done, tail } = splitLive(text);
  // list items stay with the paragraph before them; a fence with a blank line inside is one block.
  assert.deepEqual(done, [
    "## Title\n\n",
    "Intro paragraph.\n\n- one\n\n- two\n\n",
    "```ts\nconst a = 1;\n\nconst b = 2;\n```\n\n",
  ]);
  assert.equal(tail, "Last paragraph, still growing");
  assert.equal(done.join("") + tail, text);
});
