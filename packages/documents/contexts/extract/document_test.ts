import { assertEquals } from "@std/assert";
import { headingsIn, parseDocument, sectionRange } from "./document.ts";
import { inlineFiles, loadFixture } from "./testing.ts";

const project = loadFixture("eval-project");
const parse = (path: string) => parseDocument(project, path);
const inline = (path: string, text: string) =>
  parseDocument(inlineFiles({ [path]: text }), path);

Deno.test("documents/contexts#R6 [ctx-I5]: frontmatter, body and headings are split from a markdown file", () => {
  assertEquals(parse("eval/experiments/exp-001-plan.md"), {
    frontmatter: {
      status: "done",
      scenarios: ["schedule-basic"],
      rubric: "schedule-quality",
    },
    data: null,
    // body는 닫는 `---` 줄 다음부터다. headings의 line은 이 body의 줄 번호다.
    body:
      "# Plan arm against baseline\n\n## 질문\n\nDoes planning first beat the baseline?\n\n## 결과\n\nYes.\n",
    headings: [
      { level: 1, title: "Plan arm against baseline", line: 0 },
      { level: 2, title: "질문", line: 2 },
      { level: 2, title: "결과", line: 6 },
    ],
  });
});

Deno.test("documents/contexts#R6 [ctx-I5]: a file without frontmatter has an empty frontmatter and keeps its whole text as body", () => {
  assertEquals(parse("eval/scenarios/travel.md"), {
    frontmatter: {},
    data: null,
    body: "# Travel planning\n\nPlan a trip.\n",
    headings: [{ level: 1, title: "Travel planning", line: 0 }],
  });
});

Deno.test("documents/contexts#R6 [ctx-I5]: an empty frontmatter block is an empty object", () => {
  assertEquals(inline("a.md", "---\n---\n# A\n")?.frontmatter, {});
  assertEquals(inline("a.md", "---\n---\n# A\n")?.body, "# A\n");
});

Deno.test("documents/contexts#R6 [ctx-I5]: YAML scalars keep their written text (core schema, no timestamp)", () => {
  const document = inline(
    "a.md",
    '---\ndue: 2025-03-01\ncount: 3\nflag: true\nquoted: "007"\nnone: null\n---\n',
  );
  assertEquals(document?.frontmatter, {
    due: "2025-03-01",
    count: 3,
    flag: true,
    quoted: "007",
    none: null,
  });
});

Deno.test("documents/contexts#R24 [ctx-I5]: unreadable frontmatter makes the file unreadable", () => {
  assertEquals(parse("eval/experiments/exp-005-badyaml.md"), null);
  // 객체가 아닌 frontmatter도 개체로 읽을 수 없다
  assertEquals(inline("a.md", "---\n- a\n- b\n---\n# A\n"), null);
  assertEquals(inline("a.md", "---\njust text\n---\n# A\n"), null);
  // 같은 project의 읽을 수 있는 파일은 읽힌다
  assertEquals(parse("eval/scenarios/travel.md")?.headings.length, 1);
});

Deno.test("documents/contexts#R24 [ctx-I5]: a missing file is null", () => {
  assertEquals(parse("eval/scenarios/missing.md"), null);
  assertEquals(parse("eval/scenarios/travel.md")?.frontmatter, {});
});

Deno.test("documents/contexts#R6 [ctx-I5]: a yaml file is read whole into data", () => {
  assertEquals(inline("conf/run.yaml", "a:\n  b: x\nlist: [1, 2]\n"), {
    frontmatter: {},
    data: { a: { b: "x" }, list: [1, 2] },
    body: "",
    headings: [],
  });
  assertEquals(inline("conf/run.yml", "- 1\n- 2\n")?.data, [1, 2]);
  assertEquals(inline("conf/bad.yaml", "a: [b\n"), null);
});

const decisions = () => parse("docs/decisions.md")!;
// decisions.md body 줄: 2 "## Use SQLite", 6 "### Why", 10 "## Drop backup",
// 12 "### Why", 끝(줄 수) 16
const USE_SQLITE = { level: 2, title: "Use SQLite", line: 2 };
const WHY_FIRST = { level: 3, title: "Why", line: 6 };
const WHY_LAST = { level: 3, title: "Why", line: 12 };

Deno.test("documents/contexts#R9 [ctx-I5]: a section range stops at the next heading, or at the next same-or-higher heading with children", () => {
  const document = decisions();
  assertEquals(sectionRange(document, USE_SQLITE, false), { start: 3, end: 6 });
  assertEquals(sectionRange(document, USE_SQLITE, true), { start: 3, end: 10 });
  assertEquals(sectionRange(document, WHY_FIRST, false), { start: 7, end: 10 });
  assertEquals(sectionRange(document, WHY_FIRST, true), { start: 7, end: 10 });
});

Deno.test("documents/contexts#R9 [ctx-I5]: the last section runs to the end of the body", () => {
  // body "…Too heavy.\n"를 `\n`으로 나누면 16줄(마지막은 빈 줄)이다
  assertEquals(sectionRange(decisions(), WHY_LAST, false), {
    start: 13,
    end: 16,
  });
});

Deno.test("documents/contexts#R9 [ctx-I5]: headings within a line range come in document order", () => {
  const document = decisions();
  assertEquals(headingsIn(document, { start: 3, end: 10 }), [WHY_FIRST]);
  assertEquals(headingsIn(document, { start: 3, end: 16 }), [
    WHY_FIRST,
    { level: 2, title: "Drop backup", line: 10 },
    WHY_LAST,
  ]);
  assertEquals(headingsIn(document, { start: 13, end: 16 }), []);
});
