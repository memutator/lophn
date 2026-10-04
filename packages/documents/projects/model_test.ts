import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../base/mod.ts";
import {
  deepestRegisteredRoot,
  overlappingEnabledRoots,
  rootRelation,
  rootsOverlap,
  validateFolderRoots,
} from "./model.ts";

const roots = [
  { project: "a", path: "/work/notes" },
  { project: "b", path: "/work/notes/deep" },
  { project: "c", path: "/work/other" },
];

function value<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

Deno.test("documents/projects#R7: containment uses path boundaries, not a string prefix", () => {
  assertEquals(value(rootRelation("/work/notes", "/work/notes")), "equal");
  assertEquals(
    value(rootRelation("/work/notes", "/work/notes/deep")),
    "ancestor",
  );
  assertEquals(
    value(rootRelation("/work/notes/deep", "/work/notes")),
    "descendant",
  );
  assertEquals(
    value(rootRelation("/work/notes", "/work/notes-extra")),
    "disjoint",
  );
  assertEquals(value(rootRelation("/work/notes", "/work/notes2")), "disjoint");
  assertEquals(value(rootsOverlap("/work/a", "/work/a/b")), true);
  assertEquals(
    value(rootsOverlap("C:\\Work\\Notes", "c:\\work\\notes\\deep")),
    true,
  );
  assertEquals(
    value(rootsOverlap("C:\\Work\\Notes", "C:\\Work\\Notes-extra")),
    false,
  );
  assertEquals(
    value(rootsOverlap("\\\\server\\share", "\\\\server\\share\\child")),
    true,
  );
  assertEquals(value(rootsOverlap("/work/notes", "C:\\work\\notes")), false);
  assert(!rootsOverlap("/work/notes/../secret", "/work").ok);
});

Deno.test("documents/projects#R7: every enabled root pair is disjoint, including one project", () => {
  const found = overlappingEnabledRoots([
    { project: "a", path: "/work", enabled: false },
    { project: "b", path: "/work/child", enabled: true },
    { project: "a", path: "/elsewhere", enabled: true },
  ]);
  assertEquals(value(found), null);
  const same = overlappingEnabledRoots([
    { project: "a", path: "/work/child", enabled: true },
    { project: "a", path: "/work/child", enabled: true },
  ]);
  assert(same.ok && same.value !== null);
  const conflict = overlappingEnabledRoots([
    { project: "a", path: "/work", enabled: true },
    { project: "b", path: "/work/child", enabled: true },
  ]);
  assert(conflict.ok && conflict.value !== null);
  assert(
    !overlappingEnabledRoots([
      { project: "a", path: "/work//notes", enabled: true },
    ]).ok,
  );
});

Deno.test("documents/projects#R10: deepest root includes disabled nesting and rejects ties", () => {
  const deep = deepestRegisteredRoot("/work/notes/deep/file.md", roots);
  assertEquals(value(deep), { project: "b", path: "/work/notes/deep" });
  const exact = deepestRegisteredRoot("/work/other", roots);
  assertEquals(value(exact)?.project, "c");
  assertEquals(value(deepestRegisteredRoot("/elsewhere", roots)), null);
  assert(!deepestRegisteredRoot("relative", roots).ok);
  const tie = deepestRegisteredRoot("/work/notes", [
    ...roots,
    { project: "d", path: "/work/notes" },
  ]);
  assert(!tie.ok && tie.error.code === "conflict");
});

Deno.test("documents/projects#R10: path shape is not an OS realpath claim", () => {
  assertEquals(value(rootRelation("/tmp/link", "/tmp/link/child")), "ancestor");
  for (
    const path of [
      "/tmp/link/",
      "/tmp//link",
      "//tmp/link",
      "C:\\work\\",
      "C:\\work\\\\notes",
      "C://work",
      "\\\\server\\share\\",
      "\\\\server\\share/notes",
    ]
  ) {
    assert(!rootRelation(path, path).ok, path);
    assert(!rootRelation(path, "/work").ok, path);
  }
  assertEquals(value(rootRelation("/", "/tmp")), "ancestor");
  assertEquals(value(rootRelation("C:\\", "C:/work")), "ancestor");
  assertEquals(value(rootRelation("C:\\", "D:\\work")), "disjoint");
  assertEquals(
    value(rootRelation("\\\\SERVER\\share", "\\\\server\\SHARE\\notes")),
    "ancestor",
  );
});

Deno.test("documents/projects#R2: equivalent normalized folder roots are unique", () => {
  const folders = (paths: string[]) =>
    paths.map((path) => ({ path, description: "" }));
  assert(validateFolderRoots([]).ok);
  assert(validateFolderRoots(folders(["/work", "/work/notes"])).ok);
  assert(!validateFolderRoots(folders(["/work", "/work"])).ok);
  assert(!validateFolderRoots(folders(["C:\\Work", "c:/work"])).ok);
  assert(
    !validateFolderRoots(folders(["\\\\SERVER\\share", "\\\\server\\SHARE"]))
      .ok,
  );
  assert(!validateFolderRoots(folders(["/work//notes"])).ok);
});
