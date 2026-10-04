import { assert, assertEquals } from "@std/assert";
import { parseMarkdown } from "./parse.ts";
import type { Block, Inline } from "./model.ts";
import { safeUrl } from "./url.ts";

function paragraph(source: string): Inline[] {
  const [block] = parseMarkdown(source).blocks;
  assert(block?.kind === "paragraph", JSON.stringify(block));
  return block.children;
}

Deno.test("shell/design-system#R39: Lezer Markdown 제목은 단계와 겹치지 않는 id로 outline을 만든다", () => {
  const { blocks, outline } = parseMarkdown(
    "# Guide\n\nIntro *text*.\n\n## Setup steps\n\n### Setup steps\n\nTitle 2\n---\n\n#### 네 번째 단계\n",
  );
  assertEquals(outline, [
    { id: "guide", title: "Guide", level: 1 },
    { id: "setup-steps", title: "Setup steps", level: 2 },
    { id: "setup-steps-1", title: "Setup steps", level: 3 },
    { id: "title-2", title: "Title 2", level: 2 },
    { id: "네-번째-단계", title: "네 번째 단계", level: 4 },
  ]);
  assertEquals(blocks[1], {
    kind: "paragraph",
    children: [
      { kind: "text", text: "Intro " },
      { kind: "emphasis", children: [{ kind: "text", text: "text" }] },
      { kind: "text", text: "." },
    ],
  });
});

Deno.test("shell/design-system#R39: code·quote·list·task·table·rule을 순수 값으로 읽는다", () => {
  const { blocks } = parseMarkdown([
    "```ts",
    "let a = 1;",
    "```",
    "",
    "    indented",
    "    code",
    "",
    "> quoted",
    "> line",
    "",
    "3. three",
    "4. four",
    "",
    "- [x] done",
    "- [ ] open",
    "",
    "| Name | Size |",
    "|:-----|-----:|",
    "| a | 1 |",
    "",
    "***",
  ].join("\n"));
  const kinds = blocks.map((block) => block.kind);
  assertEquals(kinds, [
    "code",
    "code",
    "quote",
    "list",
    "list",
    "table",
    "rule",
  ]);
  assertEquals(blocks[0], { kind: "code", language: "ts", text: "let a = 1;" });
  assertEquals(blocks[1], {
    kind: "code",
    language: undefined,
    text: "indented\ncode",
  });
  const ordered = blocks[3] as Extract<Block, { kind: "list" }>;
  assertEquals([ordered.ordered, ordered.start, ordered.items.length], [
    true,
    3,
    2,
  ]);
  const tasks = blocks[4] as Extract<Block, { kind: "list" }>;
  assertEquals(tasks.items.map((item) => item.task), [true, false]);
  const table = blocks[5] as Extract<Block, { kind: "table" }>;
  assertEquals(table.align, ["left", "right"]);
  assertEquals(table.header, [[{ kind: "text", text: "Name" }], [{
    kind: "text",
    text: "Size",
  }]]);
  assertEquals(table.rows[0][1], [{ kind: "text", text: "1" }]);
});

Deno.test("shell/design-system#R39: raw HTML은 해석하지 않고 원문 글로 남는다", () => {
  const { blocks } = parseMarkdown(
    '<script>alert(1)</script>\n\nHi <img src=x onerror="alert(1)"> &amp; \\*\n',
  );
  assertEquals(blocks[0], { kind: "html", text: "<script>alert(1)</script>" });
  assertEquals(blocks[1], {
    kind: "paragraph",
    children: [{ kind: "text", text: 'Hi <img src=x onerror="alert(1)"> & *' }],
  });
});

Deno.test("shell/design-system#R39: link·image는 안전한 protocol만 주소로 쓴다", () => {
  const links = paragraph(
    "[a](https://x.io) [b](javascript:alert(1)) [c](JaVa&#115;cript:alert(1)) [d](#setup) [e][ref] [f][none] <mailto:me@x.io> https://y.io\n\n[ref]: </docs/guide.md>\n",
  ).filter((inline) => inline.kind === "link");
  assertEquals(links.map((link) => link.kind === "link" && link.href), [
    "https://x.io",
    undefined,
    undefined,
    "#setup",
    "/docs/guide.md",
    undefined,
    "mailto:me@x.io",
    "https://y.io",
  ]);
  const unresolved = links[5];
  assertEquals(unresolved.kind === "link" && unresolved.children, [
    { kind: "text", text: "[" },
    { kind: "text", text: "f" },
    { kind: "text", text: "][none]" },
  ]);
  const images = paragraph(
    "![ok](https://x.io/a.png) ![js](javascript:x) ![data](data:image/png;base64,AA) ![rel](./a.png)",
  ).filter((inline) => inline.kind === "image");
  assertEquals(images.map((image) => image.kind === "image" && image.src), [
    "https://x.io/a.png",
    undefined,
    undefined,
    undefined,
  ]);
  const resolved = parseMarkdown("![rel](./a.png)", {
    resolveImage: (relative) => `https://files.invalid/${relative.slice(2)}`,
  }).blocks[0] as Extract<Block, { kind: "paragraph" }>;
  assertEquals(resolved.children[0], {
    kind: "image",
    src: "https://files.invalid/a.png",
    alt: "rel",
  });
});

Deno.test("shell/design-system#R39: URL parser가 지우는 공백·제어 문자로 scheme을 숨기지 못한다", () => {
  for (
    const raw of [
      "java\tscript:alert(1)",
      "java\nscript:alert(1)",
      " \u0001javascript:alert(1)",
      "vbscript:x",
      "data:text/html,x",
      "file:///etc/passwd",
      "java\u0000script:x",
    ]
  ) {
    assertEquals(safeUrl(raw, "link"), undefined, JSON.stringify(raw));
  }
  assertEquals(safeUrl("guide.md#a", "link"), "guide.md#a");
  assertEquals(safeUrl("//cdn.example/a.png", "image"), "//cdn.example/a.png");
  assertEquals(
    safeUrl("./a.png", "image", () => "javascript:alert(1)"),
    undefined,
  );
});

Deno.test("shell/design-system#R39: task 항목은 첫 문단 뒤의 문단·하위 목록·인용·code를 원래 순서대로 남긴다", () => {
  const [loose] = parseMarkdown(
    "- [ ] task\n\n  continuation\n\n  - child\n\n  > quote <b>x</b>\n\n  ```\n  code\n  ```\n",
  ).blocks as Extract<Block, { kind: "list" }>[];
  const item = loose.items[0];
  assertEquals(item.task, false);
  assertEquals(item.children.map((block) => block.kind), [
    "paragraph",
    "paragraph",
    "list",
    "quote",
    "code",
  ]);
  assertEquals(item.children[0], {
    kind: "paragraph",
    children: [{ kind: "text", text: "task" }],
  });
  assertEquals(item.children[3], {
    kind: "quote",
    children: [{
      kind: "paragraph",
      children: [{ kind: "text", text: "quote <b>x</b>" }],
    }],
  });
  assertEquals(item.children[4], {
    kind: "code",
    language: undefined,
    text: "code",
  });
  const [tight] = parseMarkdown("- [x] task\n  - [ ] child\n")
    .blocks as Extract<Block, { kind: "list" }>[];
  assertEquals(tight.items[0].task, true);
  const nested = tight.items[0].children[1] as Extract<Block, { kind: "list" }>;
  assertEquals(nested.items[0].task, false);
  assertEquals(nested.items[0].children, [{
    kind: "paragraph",
    children: [{ kind: "text", text: "child" }],
  }]);
});
