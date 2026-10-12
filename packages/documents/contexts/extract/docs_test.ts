import { assertEquals } from "@std/assert";
import { docsKind } from "./docs.ts";
import {
  documentAnchor,
  kindContext,
  loadContract,
  loadFixture,
  typeOf,
  typeWith,
} from "./testing.ts";

const project = loadFixture("eval-project");
const context = kindContext(project);
const docs = (...paths: string[]) =>
  docsKind(typeWith("Doc", { kind: "docs", paths }), context);

Deno.test("documents/contexts#R7 [ctx-I7]: the fixture Scenario documents are entities with file and path captures", () => {
  const type = typeOf(loadContract("eval-project"), "Scenario", "docs");
  assertEquals(docsKind(type, context), {
    anchors: [
      documentAnchor("Scenario", "eval/scenarios/schedule-basic.md"),
      documentAnchor("Scenario", "eval/scenarios/travel.md"),
    ],
    violations: [],
  });
  assertEquals(
    docsKind(type, context).anchors[1].captures,
    { file: "travel", path: "eval/scenarios/travel.md" },
  );
});

Deno.test("documents/contexts#R7 [ctx-I7]: entities come in path code unit order, so README sorts before lowercase names", () => {
  assertEquals(
    docs("docs/*.md").anchors.map((anchor) => anchor.path),
    [
      "docs/README.md",
      "docs/decisions.md",
      "docs/guide-a.md",
      "docs/guide-b.md",
    ],
  );
});

Deno.test("documents/contexts#R7 [ctx-I7]: a document matched by several paths is one entity", () => {
  assertEquals(
    docs("docs/guide-*.md", "docs/guide-a.md").anchors.map((a) => a.path),
    ["docs/guide-a.md", "docs/guide-b.md"],
  );
});

Deno.test("documents/contexts#R7 [ctx-I7]: `*` stays inside one folder, `**` crosses folders and `?` is one character", () => {
  assertEquals(docs("eval/*.md").anchors, []);
  assertEquals(
    docs("eval/**/travel.md", "eval/scenarios/?chedule-basic.md").anchors.map((
      a,
    ) => a.path),
    ["eval/scenarios/schedule-basic.md", "eval/scenarios/travel.md"],
  );
});

Deno.test("documents/contexts#R7 [ctx-I7]: an exact path is one entity when the file exists and none when it does not", () => {
  assertEquals(
    docs("docs/README.md", "docs/missing.md").anchors.map((a) => a.path),
    ["docs/README.md"],
  );
});
