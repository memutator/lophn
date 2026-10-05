import { assert, assertEquals } from "@std/assert";
import { EditorSelection, EditorState } from "@codemirror/state";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { ensureSyntaxTree } from "@codemirror/language";

import {
  frontmatterFields,
  frontmatterRange,
  linkAt,
  parseTable,
  previewBlocks,
  previewSpans,
  type Span,
} from "./preview.ts";

function stateOf(doc: string, cursor = doc.length): EditorState {
  const state = EditorState.create({
    doc,
    selection: EditorSelection.cursor(cursor),
    extensions: [markdown({ base: markdownLanguage })],
  });
  ensureSyntaxTree(state, state.doc.length, 1000);
  return state;
}

function kinds(spans: Span[], doc: string): string[] {
  return spans.map((span) => {
    switch (span.kind) {
      case "hide":
        return `hide:${doc.slice(span.from, span.to)}`;
      case "mark":
        return `${span.cls}:${doc.slice(span.from, span.to)}`;
      case "line":
        return `line:${span.cls}`;
      default:
        return span.kind;
    }
  });
}

Deno.test("shell/editor#R9: 제목 표지는 커서가 밖이면 숨고 안이면 muted로 보인다", () => {
  const doc = "# Title\n\ntext";
  assertEquals(kinds(previewSpans(stateOf(doc)), doc), [
    "line:cm-lp-h1",
    "hide:# ",
  ]);
  assertEquals(kinds(previewSpans(stateOf(doc, 3)), doc), [
    "line:cm-lp-h1",
    "cm-lp-marker:# ",
  ]);
});

Deno.test("shell/editor#R9: 강조 표지는 커서가 그 요소 안일 때만 보인다", () => {
  const doc = "a **b** c *d*";
  const inside = kinds(previewSpans(stateOf(doc, 5)), doc);
  assert(inside.includes("cm-lp-marker:**"));
  assert(inside.includes("hide:*"));
  const outside = kinds(previewSpans(stateOf(doc, 0)), doc);
  assert(!outside.some((item) => item.startsWith("cm-lp-marker")));
});

Deno.test("shell/editor#R9: focus가 없으면 커서 자리도 원문을 보이지 않는다", () => {
  const doc = "# Title";
  const spans = previewSpans(stateOf(doc, 3), 0, doc.length, false);
  assertEquals(kinds(spans, doc), ["line:cm-lp-h1", "hide:# "]);
});

Deno.test("shell/editor#R9: 링크는 밖에서 글만, 안에서 원문과 표지를 보인다", () => {
  const doc = "see [the doc](lophn/plan) now";
  const outside = previewSpans(stateOf(doc, 0));
  assertEquals(kinds(outside, doc), [
    "hide:[",
    "cm-lp-link:the doc",
    "hide:](lophn/plan)",
  ]);
  const link = outside.find((span) => span.kind === "mark");
  assertEquals(link?.kind === "mark" ? link.href : null, "lophn/plan");
  const inside = kinds(previewSpans(stateOf(doc, 8)), doc);
  assert(inside.includes("cm-lp-link-source:[the doc](lophn/plan)"));
  assert(inside.includes("cm-lp-marker:["));
});

Deno.test("shell/editor#R10: 코드 블록 줄은 고정폭 class만 받고 문법 강조 span이 없다", () => {
  const doc = "```js\nconst a = 1;\n```\n\nafter";
  const spans = previewSpans(stateOf(doc));
  const lines = spans.filter((span) => span.kind === "line");
  assertEquals(lines.length, 3);
  for (const line of lines) {
    assert(line.kind === "line" && line.cls.includes("cm-lp-codeblock"));
  }
  // 코드 안 글자에는 mark를 두지 않는다(문법 강조 없음).
  const inner = spans.filter((span) =>
    span.kind === "mark" && span.from >= 6 && span.to <= 18
  );
  assertEquals(inner, []);
  assert(spans.some((span) => span.kind === "lang" && span.name === "js"));
});

Deno.test("shell/editor#R10: 인용·task·목록·규칙은 각자의 모양으로 바뀐다", () => {
  const doc = "> quote\n\n- [x] done\n- item\n\n---\n\nend";
  const spans = previewSpans(stateOf(doc));
  assert(
    spans.some((span) => span.kind === "line" && span.cls === "cm-lp-quote"),
  );
  const task = spans.find((span) => span.kind === "task");
  assertEquals(task?.kind === "task" ? task.checked : null, true);
  assert(spans.some((span) => span.kind === "bullet"));
  assert(spans.some((span) => span.kind === "rule"));
});

Deno.test("shell/editor#R10: 그림은 밖에서 통째로 바뀌고 안에서는 원문 아래에 보인다", () => {
  const doc = "![a cat](https://example.com/cat.png)\n\nnext";
  const outside = previewSpans(stateOf(doc));
  const image = outside.find((span) => span.kind === "image");
  assert(image?.kind === "image" && image.replace);
  assertEquals(image.alt, "a cat");
  const inside = previewSpans(stateOf(doc, 3)).find((span) =>
    span.kind === "image"
  );
  assert(inside?.kind === "image" && !inside.replace);
});

Deno.test("shell/editor#R10: frontmatter는 key/value 두 열 block이고 커서가 들어가면 원문이다", () => {
  const doc = '---\ntitle: "Plan"\ntags:\n  - a\n  - b\n---\n\n# Body';
  const range = frontmatterRange(stateOf(doc).doc);
  assertEquals(range, { from: 0, to: doc.indexOf("---", 4) + 3 });
  assertEquals(
    frontmatterFields(doc.slice(0, range!.to)),
    [["title", "Plan"], ["tags", "a, b"]],
  );
  const blocks = previewBlocks(stateOf(doc));
  assertEquals(blocks.map((block) => block.kind), ["frontmatter"]);
  assertEquals(previewBlocks(stateOf(doc, 5)), []);
});

Deno.test("shell/editor#R10: 표는 정렬을 읽어 통째로 그린다", () => {
  assertEquals(parseTable("| a | b |\n|:--|--:|\n| 1 | 2 |"), {
    rows: [["a", "b"], ["1", "2"]],
    align: ["left", "right"],
  });
  const doc = "| a | b |\n|---|---|\n| 1 | 2 |\n\nafter";
  const blocks = previewBlocks(stateOf(doc));
  assertEquals(blocks.map((block) => block.kind), ["table"]);
  assertEquals(previewBlocks(stateOf(doc, 3)), []);
});

Deno.test("shell/editor#R9: Mod-click 링크 주소는 원문이 보이는 링크에서도 읽힌다", () => {
  const doc = "[plan](lophn/plan)";
  assertEquals(linkAt(stateOf(doc), 2), "lophn/plan");
  assertEquals(linkAt(stateOf("plain"), 2), null);
});
