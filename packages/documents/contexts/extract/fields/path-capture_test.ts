import { assertEquals } from "@std/assert";
import {
  documentAnchor,
  fieldContext,
  inlineFiles,
  loadFixture,
} from "../testing.ts";
import type { EntityAnchor } from "../types.ts";
import { itemField, linksField, pathField } from "./path-capture.ts";

const project = loadFixture("eval-project");
const capture = (name: string) => ({ kind: "path" as const, capture: name });

Deno.test("documents/contexts#R7 [ctx-I14]: a path field gives the series number as written, with leading zeros", () => {
  const context = fieldContext(
    project,
    documentAnchor("Experiment", "eval/experiments/exp-001-plan.md", {
      n: "001",
    }),
  );
  assertEquals(pathField(capture("n"), context), "001");
  assertEquals(pathField(capture("file"), context), "exp-001-plan");
  assertEquals(
    pathField(capture("path"), context),
    "eval/experiments/exp-001-plan.md",
  );
  assertEquals(pathField(capture("major"), context), null);
});

Deno.test("documents/contexts#R7 [ctx-I14]: a folder entity's path field is its folder name", () => {
  const context = fieldContext(project, {
    type: "Run",
    path: "runs/run-1",
    section: null,
    captures: { folder: "run-1" },
    scope: { kind: "folder" },
  });
  assertEquals(pathField(capture("folder"), context), "run-1");
  assertEquals(pathField(capture("file"), context), null);
});

const eventAnchor = (item: unknown): EntityAnchor => ({
  type: "Event",
  path: "app:calendar/events.list",
  section: null,
  captures: {},
  scope: { kind: "item", item },
});
const item = (...key_path: string[]) => ({ kind: "item" as const, key_path });

Deno.test("documents/contexts#R12 [ctx-I14]: an item field follows the key path into the result item", () => {
  const context = fieldContext(
    project,
    eventAnchor({
      id: "ev-1",
      when: { start: "09:00" },
      tags: ["a"],
      gone: null,
    }),
  );
  assertEquals(itemField(item("id"), context), "ev-1");
  assertEquals(itemField(item("when", "start"), context), "09:00");
  assertEquals(itemField(item("tags"), context), ["a"]);
  assertEquals(itemField(item("gone"), context), null);
  assertEquals(itemField(item("when", "end"), context), null);
  assertEquals(itemField(item("id", "deeper"), context), null);
});

const readme = () =>
  fieldContext(project, documentAnchor("Guide", "docs/README.md"));

Deno.test("documents/contexts#R8 [ctx-I14]: a links field lists the resolved paths of the document's links in order, without checking they exist", () => {
  assertEquals(linksField({ kind: "links" }, readme()), [
    "docs/guide-a.md",
    "docs/guide-b.md",
    "docs/gone.md",
  ]);
});

Deno.test("documents/contexts#R8 [ctx-I14]: a document without links has an empty list", () => {
  const context = fieldContext(
    project,
    documentAnchor("Guide", "docs/guide-a.md"),
  );
  assertEquals(linksField({ kind: "links" }, context), []);
});

Deno.test("documents/contexts#R8 [ctx-I14]: to_type keeps only links that lead to an entity of that type", () => {
  const context = fieldContext(
    project,
    documentAnchor("Guide", "docs/README.md"),
    {
      anchors: {
        Guide: [
          documentAnchor("Guide", "docs/guide-a.md"),
          documentAnchor("Guide", "docs/guide-b.md"),
        ],
      },
    },
  );
  assertEquals(linksField({ kind: "links", to_type: "Guide" }, context), [
    "docs/guide-a.md",
    "docs/guide-b.md",
  ]);
});

Deno.test("documents/contexts#R8 [ctx-I14]: within keeps only links under that heading", () => {
  const files = inlineFiles({
    "docs/a.md": "# A\n",
    "docs/b.md": "# B\n",
    "docs/index.md": "# I\n[a](a.md)\n## Extra\n[b](b.md)\n",
  });
  const context = fieldContext(
    files,
    documentAnchor("Doc", "docs/index.md"),
  );
  assertEquals(linksField({ kind: "links", within: "Extra" }, context), [
    "docs/b.md",
  ]);
  assertEquals(linksField({ kind: "links" }, context), [
    "docs/a.md",
    "docs/b.md",
  ]);
});
