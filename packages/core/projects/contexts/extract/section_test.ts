import { assertEquals } from "@std/assert";
import { sectionKind } from "./section.ts";
import {
  documentAnchor,
  kindContext,
  loadContract,
  loadFixture,
  typeOf,
  typeWith,
} from "./testing.ts";
import type { EntityAnchor } from "./types.ts";

const project = loadFixture("eval-project");

const sectionAnchor = (
  type: string,
  path: string,
  heading: { level: number; title: string; line: number },
): EntityAnchor => ({
  ...documentAnchor(type, path),
  section: heading.title,
  scope: { kind: "section", heading },
});

Deno.test("documents/contexts#R9 [ctx-I10]: every level-2 heading of decisions.md is one Decision, in document order", () => {
  const result = sectionKind(
    typeOf(loadContract("eval-project"), "Decision", "section"),
    kindContext(project),
  );
  assertEquals(result, {
    anchors: [
      sectionAnchor("Decision", "docs/decisions.md", {
        level: 2,
        title: "Use SQLite",
        line: 2,
      }),
      sectionAnchor("Decision", "docs/decisions.md", {
        level: 2,
        title: "Drop backup",
        line: 10,
      }),
    ],
    violations: [],
  });
});

const sections = (
  source: Partial<{
    documents: string[];
    from_type: string;
    level: number;
    title_pattern: string;
  }>,
  anchors: Record<string, readonly EntityAnchor[]> = {},
) =>
  sectionKind(
    typeWith("Part", { kind: "section", level: 2, ...source }),
    kindContext(project, { anchors }),
  );

Deno.test("documents/contexts#R9 [ctx-I10]: title_pattern keeps only headings whose text matches the glob", () => {
  const result = sections({
    documents: ["docs/decisions.md"],
    title_pattern: "Use*",
  });
  assertEquals(result.anchors.map((a) => a.section), ["Use SQLite"]);
});

Deno.test("documents/contexts#R9 [ctx-I10]: level picks only that heading level", () => {
  assertEquals(
    sections({ documents: ["docs/decisions.md"], level: 3 }).anchors.map((
      a,
    ) => [a.section, a.scope]),
    [
      ["Why", {
        kind: "section",
        heading: { level: 3, title: "Why", line: 6 },
      }],
      ["Why", {
        kind: "section",
        heading: { level: 3, title: "Why", line: 12 },
      }],
    ],
  );
});

Deno.test("documents/contexts#R9 [ctx-I10]: documents are taken in path order and then heading order inside each", () => {
  const result = sections({ documents: ["docs/guide-*.md"] });
  assertEquals(result.anchors.map((a) => [a.path, a.section]), [
    ["docs/guide-a.md", "Setup"],
    ["docs/guide-a.md", "Use"],
    ["docs/guide-b.md", "Tips"],
  ]);
});

Deno.test("documents/contexts#R9 [ctx-I10]: from_type reads the documents of that type's entities in their order", () => {
  const guides = [
    documentAnchor("Guide", "docs/guide-b.md"),
    documentAnchor("Guide", "docs/guide-a.md"),
  ];
  const result = sections({ from_type: "Guide" }, { Guide: guides });
  assertEquals(result.anchors.map((a) => [a.path, a.section]), [
    ["docs/guide-b.md", "Tips"],
    ["docs/guide-a.md", "Setup"],
    ["docs/guide-a.md", "Use"],
  ]);
});

Deno.test("documents/contexts#R24 [ctx-I10]: a listed document that cannot be read is an unreadable violation and gives no entities", () => {
  const result = sections({
    documents: ["docs/decisions.md", "eval/experiments/exp-005-badyaml.md"],
  });
  assertEquals(result.anchors.map((a) => a.section), [
    "Use SQLite",
    "Drop backup",
  ]);
  assertEquals(result.violations, [{
    kind: "unreadable",
    rule: null,
    type: "Part",
    path: "eval/experiments/exp-005-badyaml.md",
    section: null,
    target: null,
  }]);
});
