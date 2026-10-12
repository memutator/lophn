import { assertEquals } from "@std/assert";
import { indexKind } from "./index.ts";
import {
  documentAnchor,
  inlineFiles,
  kindContext,
  loadContract,
  loadFixture,
  typeOf,
  typeWith,
} from "./testing.ts";

Deno.test("documents/contexts#R8 [ctx-I9]: the fixture README yields its linked guides in link order and counts the missing one as broken_link", () => {
  const result = indexKind(
    typeOf(loadContract("eval-project"), "Guide", "index"),
    kindContext(loadFixture("eval-project")),
  );
  assertEquals(result, {
    // `./guide-b.md`는 정리된다
    anchors: [
      documentAnchor("Guide", "docs/guide-a.md"),
      documentAnchor("Guide", "docs/guide-b.md"),
    ],
    violations: [{
      kind: "broken_link",
      rule: null,
      type: "Guide",
      path: "docs/README.md",
      section: null,
      target: "docs/gone.md",
    }],
  });
});

const guide = (within?: string) =>
  typeWith("Guide", { kind: "index", document: "docs/README.md", within });
const project = (readme: string) =>
  inlineFiles({
    "docs/README.md": readme,
    "docs/a.md": "# A\n",
    "docs/b.md": "# B\n",
    "docs/c.md": "# C\n",
    "docs/d.md": "# D\n",
  });

Deno.test("documents/contexts#R8 [ctx-I9]: links keep their order in the README, not the path order", () => {
  const files = project("[D](d.md)\n[A](a.md)\n[C](c.md)\n");
  const result = indexKind(guide(), kindContext(files));
  assertEquals(result.anchors.map((a) => a.path), [
    "docs/d.md",
    "docs/a.md",
    "docs/c.md",
  ]);
  assertEquals(result.violations, []);
});

Deno.test("documents/contexts#R8 [ctx-I9]: a link outside the project is a broken_link with the resolved path as target", () => {
  const files = project("[A](a.md)\n[Out](../../outside.md)\n");
  assertEquals(indexKind(guide(), kindContext(files)), {
    anchors: [documentAnchor("Guide", "docs/a.md")],
    violations: [{
      kind: "broken_link",
      rule: null,
      type: "Guide",
      path: "docs/README.md",
      section: null,
      target: "../outside.md",
    }],
  });
});

Deno.test("documents/contexts#R8 [ctx-I9]: address links and bare anchors are ignored, not broken", () => {
  const files = project(
    "[A](a.md#x)\n[web](https://example.com/z.md)\n[t](#top)\n",
  );
  assertEquals(indexKind(guide(), kindContext(files)), {
    anchors: [documentAnchor("Guide", "docs/a.md")],
    violations: [],
  });
});

Deno.test("documents/contexts#R8 [ctx-I9]: within takes only the links under that heading", () => {
  const files = project(
    "# G\n[A](a.md)\n## Extra\n[B](b.md)\n[Gone](gone.md)\n## Other\n[D](d.md)\n",
  );
  const result = indexKind(guide("Extra"), kindContext(files));
  assertEquals(result.anchors.map((a) => a.path), ["docs/b.md"]);
  // 범위 밖 링크는 위반도 아니다. 범위 안의 깨진 링크만 센다
  assertEquals(result.violations.map((v) => v.target), ["docs/gone.md"]);
});

Deno.test("documents/contexts#R24 [ctx-I9]: an unreadable index document yields no entities and one unreadable violation", () => {
  const files = project("---\nbad: [x\n---\n[A](a.md)\n");
  assertEquals(indexKind(guide(), kindContext(files)), {
    anchors: [],
    violations: [{
      kind: "unreadable",
      rule: null,
      type: "Guide",
      path: "docs/README.md",
      section: null,
      target: null,
    }],
  });
});
