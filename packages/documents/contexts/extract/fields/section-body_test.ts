import { assertEquals } from "@std/assert";
import {
  documentAnchor,
  fieldContext,
  inlineFiles,
  loadFixture,
} from "../testing.ts";
import type { EntityAnchor } from "../types.ts";
import { outlineField, sectionField, titleField } from "./section-body.ts";

const project = loadFixture("eval-project");
const section = (heading: string, include_children = false) => ({
  kind: "section" as const,
  heading,
  include_children,
});
const experiment = (name: string) =>
  fieldContext(
    project,
    documentAnchor("Experiment", `eval/experiments/${name}.md`),
  );

Deno.test("documents/contexts#R9 [ctx-I13]: a section field is the body under the first heading of that name, without the heading line", () => {
  const plan = experiment("exp-001-plan");
  assertEquals(
    sectionField(section("질문"), plan),
    "Does planning first beat the baseline?",
  );
  assertEquals(sectionField(section("결과"), plan), "Yes.");
});

Deno.test("documents/contexts#R9 [ctx-I13]: a section that is not in the document is null", () => {
  assertEquals(
    sectionField(section("질문"), experiment("exp-003-paused")),
    null,
  );
  assertEquals(
    sectionField(section("없는 제목"), experiment("exp-001-plan")),
    null,
  );
  assertEquals(
    sectionField(section("질문"), experiment("exp-002-sight")),
    "Does seeing the calendar help?",
  );
});

const decisionAnchor = (title: string, line: number): EntityAnchor => ({
  ...documentAnchor("Decision", "docs/decisions.md"),
  section: title,
  scope: { kind: "section", heading: { level: 2, title, line } },
});

Deno.test("documents/contexts#R9 [ctx-I13]: for a section entity the search stays inside that section", () => {
  const useSqlite = fieldContext(project, decisionAnchor("Use SQLite", 2));
  const dropBackup = fieldContext(project, decisionAnchor("Drop backup", 10));
  assertEquals(
    sectionField(section("Why"), useSqlite),
    "It is easy to back up.",
  );
  assertEquals(sectionField(section("Why"), dropBackup), "Too heavy.");
});

Deno.test("documents/contexts#R9 [ctx-I13]: include_children decides whether lower headings and their bodies belong to the section", () => {
  const decisions = fieldContext(
    project,
    documentAnchor("Doc", "docs/decisions.md"),
  );
  assertEquals(
    sectionField(section("Use SQLite", false), decisions),
    "We keep one file.",
  );
  assertEquals(
    sectionField(section("Use SQLite", true), decisions),
    "We keep one file.\n\n### Why\n\nIt is easy to back up.",
  );
});

Deno.test("documents/contexts#R9 [ctx-I13]: with the same heading twice the first one wins, and blank lines around the body are trimmed", () => {
  const files = inlineFiles({
    "a.md": "# A\n\n## Notes\n\n\nfirst\n\n\n## Notes\n\nsecond\n",
  });
  const context = fieldContext(files, documentAnchor("T", "a.md"));
  assertEquals(sectionField(section("Notes"), context), "first");
});

Deno.test("documents/contexts#R6 [ctx-I13]: the title of a document entity is its first H1", () => {
  assertEquals(
    titleField({ kind: "title" }, experiment("exp-001-plan")),
    "Plan arm against baseline",
  );
  const files = inlineFiles({
    "a.md": "## Second level first\n\n# The H1\n\n# Another H1\n",
    "b.md": "## only second level\n",
  });
  const first = fieldContext(files, documentAnchor("T", "a.md"));
  const none = fieldContext(files, documentAnchor("T", "b.md"));
  assertEquals(titleField({ kind: "title" }, first), "The H1");
  assertEquals(titleField({ kind: "title" }, none), null);
});

Deno.test("documents/contexts#R6 [ctx-I13]: the title of a section or outline entity is its heading text", () => {
  const useSqlite = fieldContext(project, decisionAnchor("Use SQLite", 2));
  assertEquals(titleField({ kind: "title" }, useSqlite), "Use SQLite");
  const setup = fieldContext(project, {
    ...documentAnchor("GuideHeading", "docs/guide-a.md"),
    section: "Setup",
    scope: { kind: "section", heading: { level: 2, title: "Setup", line: 2 } },
  });
  assertEquals(titleField({ kind: "title" }, setup), "Setup");
});

Deno.test("documents/contexts#R10 [ctx-I13]: an outline field lists the document's headings down to max_level, in document order", () => {
  const guideA = fieldContext(
    project,
    documentAnchor("Guide", "docs/guide-a.md"),
  );
  assertEquals(outlineField({ kind: "outline", max_level: 2 }, guideA), [
    { level: 1, title: "Guide A" },
    { level: 2, title: "Setup" },
    { level: 2, title: "Use" },
  ]);
  assertEquals(outlineField({ kind: "outline", max_level: 3 }, guideA), [
    { level: 1, title: "Guide A" },
    { level: 2, title: "Setup" },
    { level: 3, title: "Install" },
    { level: 2, title: "Use" },
  ]);
});
