import { assertEquals } from "@std/assert";
import { outlineKind } from "./outline.ts";
import {
  documentAnchor,
  kindContext,
  loadContract,
  loadFixture,
  typeOf,
  typeWith,
} from "./testing.ts";

const project = loadFixture("eval-project");
const guides = [
  documentAnchor("Guide", "docs/guide-a.md"),
  documentAnchor("Guide", "docs/guide-b.md"),
];
// guide-a body 줄: 0 "# Guide A", 2 "## Setup", 4 "### Install", 6 "## Use"
// guide-b body 줄: 0 "# Guide B", 2 "## Tips"
const heading = (
  path: string,
  level: number,
  title: string,
  line: number,
) => ({
  ...documentAnchor("GuideHeading", path),
  section: title,
  scope: { kind: "section" as const, heading: { level, title, line } },
});

Deno.test("documents/contexts#R10 [ctx-I60]: the fixture GuideHeading entities are the headings of each Guide, guides in Guide order then document order", () => {
  const result = outlineKind(
    typeOf(loadContract("eval-project"), "GuideHeading", "outline"),
    kindContext(project, { anchors: { Guide: guides } }),
  );
  assertEquals(result, {
    anchors: [
      heading("docs/guide-a.md", 1, "Guide A", 0),
      heading("docs/guide-a.md", 2, "Setup", 2),
      heading("docs/guide-a.md", 3, "Install", 4),
      heading("docs/guide-a.md", 2, "Use", 6),
      heading("docs/guide-b.md", 1, "Guide B", 0),
      heading("docs/guide-b.md", 2, "Tips", 2),
    ],
    violations: [],
  });
});

const outline = (
  source: { min_level: number; max_level: number },
  anchors = guides,
) =>
  outlineKind(
    typeWith("GuideHeading", {
      kind: "outline",
      from_type: "Guide",
      format: "markdown",
      ...source,
    }),
    kindContext(project, { anchors: { Guide: anchors } }),
  );

Deno.test("documents/contexts#R10 [ctx-I60]: min_level and max_level cut the heading levels", () => {
  assertEquals(
    outline({ min_level: 2, max_level: 2 }).anchors.map((a) => a.section),
    ["Setup", "Use", "Tips"],
  );
  assertEquals(
    outline({ min_level: 1, max_level: 1 }).anchors.map((a) => a.section),
    ["Guide A", "Guide B"],
  );
  assertEquals(
    outline({ min_level: 3, max_level: 6 }).anchors.map((a) => a.section),
    ["Install"],
  );
});

Deno.test("documents/contexts#R10 [ctx-I60]: the order follows the from_type entities, not the path order", () => {
  const reversed = [guides[1], guides[0]];
  assertEquals(
    outline({ min_level: 1, max_level: 1 }, reversed).anchors.map((a) =>
      a.path
    ),
    ["docs/guide-b.md", "docs/guide-a.md"],
  );
});

Deno.test("documents/contexts#R10 [ctx-I60]: documents lists paths instead of from_type", () => {
  const result = outlineKind(
    typeWith("GuideHeading", {
      kind: "outline",
      documents: ["docs/guide-b.md"],
      format: "markdown",
      min_level: 1,
      max_level: 6,
    }),
    kindContext(project),
  );
  assertEquals(result.anchors, [
    heading("docs/guide-b.md", 1, "Guide B", 0),
    heading("docs/guide-b.md", 2, "Tips", 2),
  ]);
});
