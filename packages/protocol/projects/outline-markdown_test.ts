import { assert, assertEquals } from "@std/assert";
import {
  type OutlineNode,
  type OutlineReady,
  type OutlineResult,
  parseOutline,
} from "./mod.ts";

const MD = "text/markdown";

function ready(text: string, mediaType = MD): OutlineReady {
  const result: OutlineResult = parseOutline(mediaType, text);
  assertEquals(result.status, "ready");
  if (result.status !== "ready") throw new Error("not ready");
  return result;
}

function keys(outline: OutlineReady): string[] {
  return outline.sections.map((item) => item.key);
}

function node(outline: OutlineReady, key: string): OutlineNode {
  const found = outline.sections.find((item) => item.key === key);
  assert(found !== undefined, `section ${key} in [${keys(outline)}]`);
  return found!;
}

function titles(outline: OutlineReady): string[] {
  return outline.sections.filter((item) => item.level > 0).map((item) =>
    item.title
  );
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)].map((byte) =>
    byte.toString(16).padStart(2, "0")
  ).join("");
}

async function fixture(path: string): Promise<string> {
  const url = new URL(`../../../fixtures/projects/${path}`, import.meta.url);
  return await Deno.readTextFile(url);
}

// 줄 범위의 본문을 같은 규칙(LF로 잇는다)으로 다시 만든다.
function bodyOf(text: string, node: OutlineNode): string {
  if (node.own_range === null) return "";
  return text.split("\n").slice(
    node.own_range.start_line - 1,
    node.own_range.end_line,
  ).join("\n");
}

const SMALL = [
  "intro", // 1
  "", // 2
  "## A", // 3
  "a1", // 4
  "### A1", // 5
  "a11", // 6
  "a12", // 7
  "## B", // 8
  "b1", // 9
].join("\n");

Deno.test("documents/outline-and-search#R3 [ctx-I60]: markdown media types are parsed and every other media type is unsupported, not empty", () => {
  for (const media of ["text/markdown", "text/x-markdown"]) {
    const outline = ready(SMALL, media);
    assertEquals(keys(outline), ["a", "a/a1", "b"]);
  }
  for (const media of ["text/plain", "application/pdf", "text/html", ""]) {
    assertEquals(parseOutline(media, SMALL), {
      status: "unsupported",
      media_type: media,
    });
  }
});

Deno.test("documents/outline-and-search#R3 [ctx-I60]: media type parameters and case do not change the format", () => {
  const plain = ready(SMALL);
  assert(plain.sections.length > 0);
  assertEquals(ready(SMALL, "text/markdown; charset=utf-8"), plain);
  assertEquals(ready(SMALL, "Text/Markdown"), plain);
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: each section carries title, level, parent, 1-based line ranges, characters, tokens, hash and direct child count", async () => {
  const outline = ready(SMALL);
  assertEquals(outline.title, null);
  assertEquals(outline.line_count, 9);
  assertEquals(outline.characters, [...SMALL].length);
  assertEquals(
    outline.sections.map((item) => [
      item.key,
      item.title,
      item.level,
      item.parent,
      item.position,
    ]),
    [
      ["a", "A", 2, null, 0],
      ["a/a1", "A1", 3, "a", 1],
      ["b", "B", 2, null, 2],
    ],
  );
  assertEquals(outline.sections.map((item) => item.anchor), [
    null,
    null,
    null,
  ]);
  assertEquals(
    outline.sections.map((item) => [item.own_range, item.subtree_range]),
    [
      [{ start_line: 4, end_line: 4 }, { start_line: 3, end_line: 7 }],
      [{ start_line: 6, end_line: 7 }, { start_line: 5, end_line: 7 }],
      [{ start_line: 9, end_line: 9 }, { start_line: 8, end_line: 9 }],
    ],
  );
  assertEquals(outline.sections.map((item) => item.children_count), [
    1,
    0,
    0,
  ]);
  assertEquals(outline.sections.map((item) => item.characters), [2, 7, 2]);
  assertEquals(outline.sections.map((item) => item.estimated_tokens), [
    1,
    3,
    1,
  ]);
  for (const item of outline.sections) {
    assertEquals(item.body_hash, await sha256(bodyOf(SMALL, item)));
  }
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: a heading with no body line has a null own range and a heading directly followed by a child counts it", () => {
  const text = "## A\n### B\n## C\n";
  const outline = ready(text);
  assertEquals(keys(outline), ["a", "a/b", "c"]);
  assertEquals(node(outline, "a").own_range, null);
  assertEquals(node(outline, "a").characters, 0);
  assertEquals(node(outline, "a").estimated_tokens, 0);
  assertEquals(node(outline, "a").children_count, 1);
  assertEquals(node(outline, "a").subtree_range, {
    start_line: 1,
    end_line: 2,
  });
  assertEquals(node(outline, "a/b").subtree_range, {
    start_line: 2,
    end_line: 2,
  });
  assertEquals(node(outline, "c").subtree_range, {
    start_line: 3,
    end_line: 4,
  });
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: the last section ends at the last split piece, so a trailing newline adds an empty final line", () => {
  const outline = ready("## A\nbody\n");
  assertEquals(outline.line_count, 3);
  assertEquals(node(outline, "a").subtree_range, {
    start_line: 1,
    end_line: 3,
  });
  assertEquals(node(outline, "a").own_range, { start_line: 2, end_line: 3 });
  assertEquals(node(outline, "a").characters, 5);
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: ATX headings from level 1 to 6 follow the Markdown rules for closing marks, indent and spacing", () => {
  const text = [
    "## Closed ##", // 1
    "## Trailing   ", // 2
    "   ## Indented three", // 3
    "    ## four spaces is code", // 4
    "##NoSpace", // 5
    "####### seven marks", // 6
    "## Tagged {#custom-id}", // 7
    "###### Six", // 8
  ].join("\n");
  const outline = ready(text);
  assertEquals(titles(outline), [
    "Closed",
    "Trailing",
    "Indented three",
    "Tagged",
    "Six",
  ]);
  assertEquals(keys(outline), [
    "closed",
    "trailing",
    "indented-three",
    "custom-id",
    "custom-id/six",
  ]);
  assertEquals(
    outline.sections.map((item) => item.subtree_range.start_line),
    [1, 2, 3, 7, 8],
  );
  assertEquals(node(outline, "custom-id").anchor, "custom-id");
  assertEquals(node(outline, "custom-id/six").level, 6);
  assertEquals(node(outline, "closed").anchor, null);
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: setext headings give levels 1 and 2 and a rule after a blank line is body", () => {
  const text = [
    "Doc title", // 1
    "=========", // 2
    "lead", // 3
    "", // 4
    "Part one", // 5
    "--------", // 6
    "body one", // 7
    "", // 8
    "---", // 9
    "body after rule", // 10
  ].join("\n");
  const outline = ready(text);
  assertEquals(outline.title, "Doc title");
  assertEquals(keys(outline), ["doc-title", "doc-title/part-one"]);
  assertEquals(node(outline, "doc-title").level, 1);
  assertEquals(node(outline, "doc-title").subtree_range, {
    start_line: 1,
    end_line: 10,
  });
  assertEquals(node(outline, "doc-title").own_range, {
    start_line: 3,
    end_line: 4,
  });
  assertEquals(node(outline, "doc-title/part-one").level, 2);
  assertEquals(node(outline, "doc-title/part-one").parent, "doc-title");
  assertEquals(node(outline, "doc-title/part-one").subtree_range, {
    start_line: 5,
    end_line: 10,
  });
  assertEquals(node(outline, "doc-title/part-one").own_range, {
    start_line: 7,
    end_line: 10,
  });
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: setext fixture gives the same titles and levels as the document module", async () => {
  const outline = ready(await fixture("notes-basic/setext.md"));
  assertEquals(outline.title, "setext 제목 하나");
  assertEquals(titles(outline), [
    "setext 제목 하나",
    "setext 첫 제목",
    "다른 제목",
  ]);
  assertEquals(outline.sections.map((item) => item.level), [1, 2, 2]);
  assertEquals(
    outline.sections.map((item) => item.subtree_range),
    [
      { start_line: 1, end_line: 15 },
      { start_line: 6, end_line: 10 },
      { start_line: 11, end_line: 15 },
    ],
  );
  assertEquals(outline.sections.map((item) => item.parent), [
    null,
    "setext-제목-하나",
    "setext-제목-하나",
  ]);
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: front matter, backtick and tilde fences and HTML pre hide heading-like lines", async () => {
  const outline = ready(await fixture("notes-basic/fenced.md"));
  assertEquals(outline.title, "실제 제목");
  assertEquals(titles(outline), [
    "실제 제목",
    "코드 블록",
    "HTML pre",
    "마지막",
  ]);
  assertEquals(
    outline.sections.map((item) => item.subtree_range),
    [
      { start_line: 7, end_line: 38 },
      { start_line: 11, end_line: 27 },
      { start_line: 28, end_line: 36 },
      { start_line: 37, end_line: 38 },
    ],
  );
  assert(!titles(outline).some((title) => title.includes("가짜")));
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: a fence closes only with the same mark and at least the same length", () => {
  const text = [
    "## A", // 1
    "````", // 2
    "```", // 3
    "## fake1", // 4
    "````", // 5
    "## B", // 6
    "~~~", // 7
    "```", // 8
    "## fake2", // 9
    "~~~", // 10
    "## C", // 11
  ].join("\n");
  const outline = ready(text);
  assertEquals(titles(outline), ["A", "B", "C"]);
  assertEquals(
    outline.sections.map((item) => item.subtree_range),
    [
      { start_line: 1, end_line: 5 },
      { start_line: 6, end_line: 10 },
      { start_line: 11, end_line: 11 },
    ],
  );
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: HTML pre hides headings until the closing tag", () => {
  const text = "## A\n<pre>\n## in pre\n</pre>\n## After";
  const outline = ready(text);
  assertEquals(titles(outline), ["A", "After"]);
  assertEquals(node(outline, "a").subtree_range, {
    start_line: 1,
    end_line: 4,
  });
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: front matter lines are not part of any section body", () => {
  const text = "---\ntitle: x\n# not a heading\n---\n## Real\nbody";
  const outline = ready(text);
  assertEquals(keys(outline), ["real"]);
  assertEquals(node(outline, "real").subtree_range, {
    start_line: 5,
    end_line: 6,
  });
  assertEquals(node(outline, "real").own_range, {
    start_line: 6,
    end_line: 6,
  });
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: the heading tree of the shared fixture matches the document module section for section", async () => {
  const text = await fixture("notes-basic/index.md");
  const outline = ready(text);
  assertEquals(outline.title, "프로젝트 노트");
  assertEquals(
    outline.sections.map((item) => [
      item.key,
      item.parent,
      item.level,
      item.subtree_range.start_line,
      item.subtree_range.end_line,
    ]),
    [
      ["프로젝트-노트", null, 1, 1, 54],
      ["프로젝트-노트/아웃라인", "프로젝트-노트", 2, 5, 22],
      ["프로젝트-노트/아웃라인/첫-항목", "프로젝트-노트/아웃라인", 3, 7, 22],
      [
        "프로젝트-노트/아웃라인/첫-항목/첫-항목의-하위",
        "프로젝트-노트/아웃라인/첫-항목",
        4,
        11,
        22,
      ],
      [
        "프로젝트-노트/아웃라인/첫-항목/첫-항목의-하위/더-깊은-항목",
        "프로젝트-노트/아웃라인/첫-항목/첫-항목의-하위",
        5,
        15,
        22,
      ],
      [
        "프로젝트-노트/아웃라인/첫-항목/첫-항목의-하위/더-깊은-항목/가장-깊은-항목",
        "프로젝트-노트/아웃라인/첫-항목/첫-항목의-하위/더-깊은-항목",
        6,
        19,
        22,
      ],
      ["프로젝트-노트/건너뛴-level", "프로젝트-노트", 2, 23, 30],
      [
        "프로젝트-노트/건너뛴-level/건너뛴-level의-하위",
        "프로젝트-노트/건너뛴-level",
        4,
        27,
        28,
      ],
      [
        "프로젝트-노트/건너뛴-level/건너뛴-level의-하위-2",
        "프로젝트-노트/건너뛴-level",
        4,
        29,
        30,
      ],
      ["프로젝트-노트/회의", "프로젝트-노트", 2, 31, 34],
      ["프로젝트-노트/a--b", "프로젝트-노트", 2, 35, 38],
      ["프로젝트-노트/section", "프로젝트-노트", 2, 39, 42],
      ["프로젝트-노트/intro", "프로젝트-노트", 2, 43, 46],
      ["프로젝트-노트/회의-2", "프로젝트-노트", 2, 47, 50],
      ["프로젝트-노트/한글-제목", "프로젝트-노트", 2, 51, 54],
    ],
  );
  assertEquals(node(outline, "프로젝트-노트").children_count, 8);
  assertEquals(node(outline, "프로젝트-노트").own_range, {
    start_line: 2,
    end_line: 4,
  });
  assertEquals(node(outline, "프로젝트-노트/아웃라인").children_count, 1);
  assertEquals(node(outline, "프로젝트-노트/건너뛴-level").children_count, 2);
  assertEquals(node(outline, "프로젝트-노트/아웃라인").own_range, {
    start_line: 6,
    end_line: 6,
  });
  assertEquals(node(outline, "프로젝트-노트/아웃라인").characters, 0);
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: explicit anchors win, symbols drop out of slugs, empty slugs become section and equal siblings get a numeric suffix", async () => {
  const outline = ready(await fixture("notes-basic/index.md"));
  assertEquals(node(outline, "프로젝트-노트/a--b").title, "A & B");
  assertEquals(node(outline, "프로젝트-노트/section").title, "!!!");
  assertEquals(node(outline, "프로젝트-노트/intro").title, "Intro");
  assertEquals(node(outline, "프로젝트-노트/intro").anchor, "intro");
  assertEquals(node(outline, "프로젝트-노트/한글-제목").anchor, null);
  assertEquals(node(outline, "프로젝트-노트/회의").title, "회의");
  assertEquals(node(outline, "프로젝트-노트/회의-2").title, "회의");
  assertEquals(new Set(keys(outline)).size, outline.sections.length);
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: the same heading under different parents is not suffixed and keeps its parent path", () => {
  const outline = ready("## P\n### X\n## Q\n### X\n");
  assertEquals(keys(outline), ["p", "p/x", "q", "q/x"]);
  assertEquals(node(outline, "q/x").parent, "q");
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: a skipped level nests under the nearest lower heading and a deeper first heading has no invented parent", () => {
  const outline = ready("### X\nx\n## Y\ny\n#### Z\nz");
  assertEquals(
    outline.sections.map((item) => [item.key, item.parent, item.level]),
    [["x", null, 3], ["y", null, 2], ["y/z", "y", 4]],
  );
  assertEquals(node(outline, "x").subtree_range, {
    start_line: 1,
    end_line: 2,
  });
  assertEquals(node(outline, "y").subtree_range, {
    start_line: 3,
    end_line: 6,
  });
  assertEquals(node(outline, "y").children_count, 1);
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: a sole h1 is a level 1 node with its children under it and is also reported as the title, several h1 stay as sibling nodes with a null title", async () => {
  const single = ready("# Only\n\n## Child\nbody");
  assertEquals(single.title, "Only");
  assertEquals(keys(single), ["only", "only/child"]);
  assertEquals(node(single, "only").level, 1);
  assertEquals(node(single, "only").parent, null);
  assertEquals(node(single, "only").children_count, 1);
  assertEquals(node(single, "only").subtree_range, {
    start_line: 1,
    end_line: 4,
  });
  assertEquals(node(single, "only").own_range, { start_line: 2, end_line: 2 });
  assertEquals(node(single, "only/child").parent, "only");
  assertEquals(node(single, "only/child").level, 2);

  const many = ready(await fixture("notes-basic/multi-h1.md"));
  assertEquals(many.title, null);
  assertEquals(
    many.sections.filter((item) => item.level === 1).map((item) => item.title),
    ["첫 번째 h1", "두 번째 h1"],
  );
  assertEquals(node(many, "두-번째-h1").children_count, 2);
  assertEquals(node(many, "두-번째-h1/첫-h1-아래").parent, "두-번째-h1");
  assertEquals(
    node(many, "두-번째-h1/두-번째-h1-아래").parent,
    "두-번째-h1",
  );
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: the outline holds heading nodes only, so text before the first heading makes no node", async () => {
  const index = ready(await fixture("notes-basic/index.md"));
  assertEquals(index.title, "프로젝트 노트");
  assertEquals(index.sections[0]?.key, "프로젝트-노트");
  assertEquals(index.sections[0]?.position, 0);
  assertEquals(index.sections[0]?.subtree_range.start_line, 1);
  assertEquals(index.line_count, 54);

  const fenced = ready(await fixture("notes-basic/fenced.md"));
  assertEquals(fenced.sections[0]?.key, "실제-제목");
  assertEquals(fenced.sections[0]?.subtree_range.start_line, 7);

  const small = ready(SMALL);
  assertEquals(small.sections[0]?.subtree_range.start_line, 3);
  for (const outline of [index, fenced, small]) {
    assert(outline.sections.length > 0);
    assert(outline.sections.every((item) => item.level >= 1));
    assertEquals(keys(outline).includes("_preamble"), false);
  }
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: the guide fixture used by the context entity answer is one level 1 node with its sections under it", async () => {
  const text = await Deno.readTextFile(
    new URL(
      "../../core/projects/contexts/testdata/eval-project/docs/guide-a.md",
      import.meta.url,
    ),
  );
  const outline = ready(text);
  assertEquals(outline.title, "Guide A");
  assertEquals(
    outline.sections.map((item) => [
      item.key,
      item.title,
      item.level,
      item.parent,
      item.children_count,
      item.subtree_range.start_line,
      item.subtree_range.end_line,
    ]),
    [
      ["guide-a", "Guide A", 1, null, 2, 1, 8],
      ["guide-a/setup", "Setup", 2, "guide-a", 1, 3, 6],
      ["guide-a/setup/install", "Install", 3, "guide-a/setup", 0, 5, 6],
      ["guide-a/use", "Use", 2, "guide-a", 0, 7, 8],
    ],
  );
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: a document without headings is ready with an empty node list and still reports its size", () => {
  const withHeading = ready("## A\nbody");
  assertEquals(keys(withHeading), ["a"]);
  for (const text of ["note without any heading", "\n\n"]) {
    const outline = ready(text);
    assertEquals(outline.sections, []);
    assertEquals(outline.title, null);
    assertEquals(outline.line_count, text.split("\n").length);
    assertEquals(outline.characters, [...text].length);
  }
  assertEquals(keys(ready("\n\n## A\nbody")), ["a"]);
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: the first heading on line 1 is node 0", async () => {
  const outline = ready(await fixture("notes-basic/multi-h1.md"));
  assertEquals(outline.sections[0]?.key, "첫-번째-h1");
  assertEquals(outline.sections[0]?.position, 0);
});

Deno.test("documents/outline-and-search#R2 [ctx-I60]: a BOM and CRLF line ends give the same outline as the clean LF text", async () => {
  const clean =
    "# BOM과 CRLF\n\n서문\n\n## 하나\n본문\n\n### 둘 {#crlf}\n\n끝\n";
  const dirty = "﻿" + clean.replaceAll("\n", "\r\n");
  const expected = ready(clean);
  assert(expected.sections.length > 0);
  assertEquals(ready(dirty), expected);
  assertEquals(ready(clean.replaceAll("\n", "\r")), expected);
  assertEquals(expected.title, "BOM과 CRLF");
  assertEquals(node(expected, "bom과-crlf/하나/crlf").subtree_range, {
    start_line: 8,
    end_line: 11,
  });

  const raw = await fixture("notes-basic/encoding/bom-crlf.md");
  const outline = ready(raw);
  assertEquals(outline.title, "BOM과 CRLF");
  assertEquals(
    keys(outline),
    ["bom과-crlf", "bom과-crlf/두-번째-제목", "bom과-crlf/두-번째-제목/crlf"],
  );
  assertEquals(
    ready(raw.replace(/^﻿/, "").replaceAll("\r\n", "\n")),
    outline,
  );
});

Deno.test("documents/outline-and-search#R2 [ctx-I60]: titles, keys and character counts use Unicode NFC even when the file is decomposed", async () => {
  const composed = "## 한글 제목\n한글 본문\n".normalize("NFC");
  const decomposed = composed.normalize("NFD");
  assert(decomposed !== composed);
  const expected = ready(composed);
  assertEquals(keys(expected), ["한글-제목"]);
  const outline = ready(decomposed);
  assertEquals(outline, expected);
  assertEquals(node(outline, "한글-제목").title, "한글 제목");
  assertEquals(
    node(outline, "한글-제목").characters,
    [..."한글 본문\n"].length,
  );

  const file = ready(await fixture("notes-basic/encoding/nfd-hangul.md"));
  for (const item of file.sections) {
    assertEquals(item.key, item.key.normalize("NFC"));
    assertEquals(item.title, item.title.normalize("NFC"));
  }
  assertEquals(file.title, file.title?.normalize("NFC"));
  assertEquals(file.title, "분해형 한글".normalize("NFC"));
  assert(
    file.sections.some((item) =>
      item.key === "분해형-한글/제목도-분해형".normalize("NFC")
    ),
  );
});

Deno.test("documents/outline-and-search#R6 [ctx-I60]: estimated tokens are ceil(codepoints / 3) and an astral character counts as one codepoint", () => {
  const cases: [string, number, number][] = [
    ["", 0, 0],
    ["가", 1, 1],
    ["가나다", 3, 1],
    ["가나다라", 4, 2],
    ["abcdef", 6, 2],
    ["abcdefg", 7, 3],
    ["😀😀😀😀", 4, 2],
  ];
  for (const [body, characters, tokens] of cases) {
    const text = `## T\n${body}`;
    const section = node(ready(text), "t");
    assertEquals(section.characters, characters, JSON.stringify(body));
    assertEquals(section.estimated_tokens, tokens, JSON.stringify(body));
  }
  assertEquals(node(ready("## T\n가나다라"), "t").estimated_tokens, 2);
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: the body hash follows the section's own body only", async () => {
  const base = "# Doc\n\n## Kept\n\nbody line\n\n### Child\nchild body\n";
  const renamed = base.replace("## Kept", "## Renamed");
  const bodyEdited = base.replace("body line", "changed");
  const childEdited = base.replace("child body", "child changed");
  const original = ready(base);
  assert(original.sections.length > 0);
  const kept = node(original, "doc/kept");
  assertEquals(node(ready(renamed), "doc/renamed").body_hash, kept.body_hash);
  assert(node(ready(bodyEdited), "doc/kept").body_hash !== kept.body_hash);
  assertEquals(node(ready(childEdited), "doc/kept").body_hash, kept.body_hash);
  assert(
    node(ready(childEdited), "doc/kept/child").body_hash !==
      node(original, "doc/kept/child").body_hash,
  );
  assertEquals(kept.body_hash, await sha256(bodyOf(base, kept)));
  assertEquals(kept.body_hash, await sha256("\nbody line\n"));
  assertEquals(kept.body_hash.length, 64);
  assert(/^[0-9a-f]{64}$/.test(kept.body_hash));

  const empty = node(ready("## A\n### B"), "a");
  assertEquals(empty.body_hash, await sha256(""));
});

Deno.test("documents/outline-and-search#R5 [ctx-I60]: the same body in two sections hashes the same and a different body does not", () => {
  const outline = ready("## A\nsame\n## B\nsame\n## C\nother");
  assertEquals(node(outline, "a").body_hash, node(outline, "b").body_hash);
  assertEquals(node(outline, "a").own_range?.end_line, 2);
  assert(node(outline, "a").body_hash !== node(outline, "c").body_hash);
});

Deno.test("documents/outline-and-search#R2 [ctx-I60]: the same text always gives the same outline, independent of earlier calls", async () => {
  const text = await fixture("notes-basic/index.md");
  const first = ready(text);
  assert(first.sections.length > 5);
  ready("## unrelated\nother text");
  ready(await fixture("notes-basic/fenced.md"));
  const second = ready(text);
  assertEquals(second, first);
  assertEquals(JSON.stringify(second), JSON.stringify(first));
});

Deno.test("documents/outline-and-search#R4 [ctx-I60]: the editor list and the context outline kind both call parseOutline and see the same sections", () => {
  const forEditor = ready(SMALL);
  const forContext = ready(SMALL, "text/x-markdown");
  assertEquals(forEditor.sections.length, 3);
  assertEquals(forContext.sections, forEditor.sections);
});
