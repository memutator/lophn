import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type MarkdownOutlineNode,
  parseMarkdownOutline,
} from "./outline-markdown.ts";

function flat(nodes: MarkdownOutlineNode[]): string[] {
  return nodes.flatMap((node) => [
    `${node.level} ${node.title} ${node.subtree_range.start_line}-${node.subtree_range.end_line}`,
    ...flat(node.children),
  ]);
}

test("front matter와 fenced code 안의 제목은 목차에 없고 setext 제목은 있다", () => {
  const text = [
    "---",
    "# in front matter",
    "---",
    "# A",
    "```",
    "# in code",
    "```",
    "B",
    "---",
    "text",
    "#### D",
    "## C",
  ].join("\n");
  assert.deepStrictEqual(flat(parseMarkdownOutline(text)), [
    "1 A 4-12",
    "2 B 8-11",
    "4 D 11-11",
    "2 C 12-12",
  ]);
});
