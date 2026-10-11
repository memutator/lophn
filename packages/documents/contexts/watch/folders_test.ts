import { assertEquals } from "@std/assert";
import { loadContract } from "../extract/testing.ts";
import { folderCovers, watchFolders } from "./folders.ts";
import { contractOf } from "./testing.ts";

const flat = (path: string) => ({ path, recursive: false });
const deep = (path: string) => ({ path, recursive: true });

Deno.test("documents/contexts#R23 [ctx-I32b]: the fixture contract watches the four folders its series, docs and index paths sit in", () => {
  // series(eval/experiments, loop/findings), docs(eval/scenarios), section·index(docs).
  // outline from_type and app-data add nothing.
  assertEquals(watchFolders(loadContract("eval-project").contract), [
    flat("docs"),
    flat("eval/experiments"),
    flat("eval/scenarios"),
    flat("loop/findings"),
  ]);
});

Deno.test("documents/contexts#R23 [ctx-I32b]: a glob folder segment makes the literal prefix recursive, a plain file name does not", () => {
  assertEquals(
    watchFolders(contractOf([
      { kind: "docs", paths: ["notes/**/*.md"] },
      { kind: "docs", paths: ["guides/*/intro.md"] },
      { kind: "docs", paths: ["plain/*.md", "plain/exact.md"] },
    ])),
    [deep("guides"), deep("notes"), flat("plain")],
  );
});

Deno.test("documents/contexts#R23 [ctx-I32b]: a root-level file is watched as the root folder, not the whole tree", () => {
  assertEquals(
    watchFolders(contractOf([{ kind: "docs", paths: ["README.md"] }])),
    [flat("")],
  );
  assertEquals(
    watchFolders(contractOf([{ kind: "index", document: "INDEX.md" }])),
    [flat("")],
  );
});

Deno.test("documents/contexts#R23 [ctx-I32b]: a folder source watches its root recursively and section and outline documents add their globs", () => {
  assertEquals(
    watchFolders(contractOf([
      { kind: "folder", root: "projects", child_pattern: "*", depth: 1 },
      { kind: "section", documents: ["specs/a.md"], level: 2 },
      {
        kind: "outline",
        documents: ["handbook/*.md"],
        format: "markdown",
        min_level: 1,
        max_level: 6,
      },
    ])),
    [flat("handbook"), deep("projects"), flat("specs")],
  );
});

Deno.test("documents/contexts#R23 [ctx-I32b]: a recursive folder absorbs the folders below it and wins over the same folder non-recursive", () => {
  assertEquals(
    watchFolders(contractOf([
      { kind: "docs", paths: ["a/x.md", "a/b/y.md", "a/c/**/z.md", "d/e.md"] },
      { kind: "docs", paths: ["a/**/w.md", "d/**/v.md"] },
    ])),
    [deep("a"), deep("d")],
  );
  // a non-recursive parent does not absorb a child folder
  assertEquals(
    watchFolders(contractOf([
      { kind: "docs", paths: ["a/x.md", "a/b/y.md"] },
    ])),
    [flat("a"), flat("a/b")],
  );
});

Deno.test("documents/contexts#R23 [ctx-I32b]: a contract that points at no file watches nothing", () => {
  assertEquals(
    watchFolders(contractOf([{
      kind: "app-data",
      app: "calendar",
      command: "events.list",
      result_path: ["items"],
    }])),
    [],
  );
});

Deno.test("documents/contexts#R23 [ctx-I32b]: a folder covers its direct files, and only a recursive folder covers deeper ones", () => {
  assertEquals(folderCovers(flat("docs"), "docs/a.md"), true);
  assertEquals(folderCovers(flat("docs"), "docs/sub/a.md"), false);
  assertEquals(folderCovers(flat("docs"), "docsx/a.md"), false);
  assertEquals(folderCovers(flat("docs"), "a.md"), false);
  assertEquals(folderCovers(deep("docs"), "docs/sub/deeper/a.md"), true);
  assertEquals(folderCovers(deep("docs"), "docsx/a.md"), false);
  assertEquals(folderCovers(flat(""), "a.md"), true);
  assertEquals(folderCovers(flat(""), "docs/a.md"), false);
  assertEquals(folderCovers(deep(""), "docs/a.md"), true);
});
