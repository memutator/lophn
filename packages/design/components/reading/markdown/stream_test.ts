import assert from "node:assert/strict";
import { test } from "node:test";

import { parseCached } from "./cache.ts";
import { parseMarkdown } from "./parse.ts";
import { presentStreamingTail } from "./stream.ts";

test("presentStreamingTail hides a table until its delimiter row is complete", () => {
  assert.equal(presentStreamingTail("Intro\n\n| a | b |"), "Intro\n");
  assert.equal(presentStreamingTail("Intro\n\n| a | b |\n|--"), "Intro\n");
  const open = "| a | b |\n|---|---|\n| 1 | 2";
  assert.equal(presentStreamingTail(open), open);
  // unterminated delimiter row is still being written
  assert.equal(presentStreamingTail("| a | b |\n|---|---|"), "");
  // prose with a pipe is not a table
  assert.equal(presentStreamingTail("a | b\nnext line"), "a | b\nnext line");
});

test("presentStreamingTail drops a lone marker line, a half link and a half closer", () => {
  assert.equal(presentStreamingTail("Done.\n\n#"), "Done.\n");
  assert.equal(presentStreamingTail("- one\n2."), "- one");
  assert.equal(presentStreamingTail("see [docs](https://exa"), "see docs");
  assert.equal(presentStreamingTail("a **bold*"), "a **bold");
  assert.equal(presentStreamingTail("a **bold**"), "a **bold**");
  assert.equal(presentStreamingTail("an *it*"), "an *it*");
  const fenced = "```ts\n-";
  assert.equal(presentStreamingTail(fenced), fenced);
});

test("unclosed emphasis, backtick, dollar and display math stay literal text", () => {
  for (const source of ["**bold", "`code", "cost $5 and", "$$\nx = 1"]) {
    const [first] = parseMarkdown(source).blocks;
    assert.equal(first?.kind, "paragraph", source);
  }
});

test("parseCached returns the same document for the same source", () => {
  assert.equal(parseCached("# one"), parseCached("# one"));
});
