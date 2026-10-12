import { assertEquals } from "@std/assert";
import { parseDocument } from "./document.ts";
import { markdownLinks } from "./links.ts";
import { inlineFiles, loadFixture } from "./testing.ts";

const links = (path: string, text: string, within?: string) => {
  const document = parseDocument(inlineFiles({ [path]: text }), path)!;
  return markdownLinks(path, document, within);
};

Deno.test("documents/contexts#R8 [ctx-I9]: links of the fixture README resolve against the document folder, in order", () => {
  const project = loadFixture("eval-project");
  const document = parseDocument(project, "docs/README.md")!;
  assertEquals(markdownLinks("docs/README.md", document), [
    { text: "Guide A", target: "docs/guide-a.md", inside: true },
    // `./`은 정리된다
    { text: "Guide B", target: "docs/guide-b.md", inside: true },
    // 대상이 있는지는 보지 않는다
    { text: "Gone", target: "docs/gone.md", inside: true },
  ]);
});

Deno.test("documents/contexts#R8 [ctx-I9]: `..` climbs out of the folder and a link above the project root is not inside", () => {
  const text = "[up](../x.md) [deep](../../../out.md) [sub](a/./b/../c.md)\n";
  assertEquals(links("docs/guides/README.md", text), [
    { text: "up", target: "docs/x.md", inside: true },
    { text: "deep", target: "../out.md", inside: false },
    { text: "sub", target: "docs/guides/a/c.md", inside: true },
  ]);
});

Deno.test("documents/contexts#R8 [ctx-I9]: fragments and queries are dropped; address links and bare anchors are not document links", () => {
  const text = [
    "[a](a.md#setup) [b](b.md?x=1) [web](https://example.com/c.md)",
    "[mail](mailto:me@example.com) [top](#top) [d](d.md)",
    "",
  ].join("\n");
  assertEquals(links("docs/README.md", text), [
    { text: "a", target: "docs/a.md", inside: true },
    { text: "b", target: "docs/b.md", inside: true },
    { text: "d", target: "docs/d.md", inside: true },
  ]);
});

Deno.test("documents/contexts#R8 [ctx-I9]: within keeps only links under that heading, children included", () => {
  const text = [
    "# Guides",
    "- [A](a.md)",
    "## Extra",
    "- [B](b.md)",
    "### Deeper",
    "- [C](c.md)",
    "## Other",
    "- [D](d.md)",
    "",
  ].join("\n");
  assertEquals(
    links("docs/README.md", text, "Extra").map((link) => link.target),
    ["docs/b.md", "docs/c.md"],
  );
  assertEquals(
    links("docs/README.md", text).map((link) => link.target),
    ["docs/a.md", "docs/b.md", "docs/c.md", "docs/d.md"],
  );
  assertEquals(links("docs/README.md", text, "Nowhere"), []);
});
