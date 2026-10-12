import { assertEquals } from "@std/assert";
import { folderKind } from "./folder.ts";
import { inlineFiles, kindContext, typeWith } from "./testing.ts";

// 폴더는 파일 경로에서만 알 수 있다(fixture에는 folder type이 없어 작은 project를 직접 둔다).
const project = inlineFiles({
  "other/run-9/result.yaml": "score: 1\n",
  "runs/readme.md": "# Runs\n",
  "runs/run-1/result.yaml": "score: 1\n",
  "runs/run-2/notes/a.md": "# A\n",
  "runs/run-2/result.yaml": "score: 2\n",
  "runs/scratch/x.md": "# X\n",
});

const folder = (name: string) => ({
  anchors: [{
    type: "Run",
    path: `runs/${name}`,
    section: null,
    captures: { folder: name },
    scope: { kind: "folder" as const },
  }],
  violations: [],
});

Deno.test("documents/contexts#R7 [ctx-I6]: each child folder whose name matches child_pattern is one entity, in path order", () => {
  const type = typeWith("Run", {
    kind: "folder",
    root: "runs",
    child_pattern: "run-*",
    depth: 1,
  });
  assertEquals(folderKind(type, kindContext(project)), {
    anchors: [...folder("run-1").anchors, ...folder("run-2").anchors],
    violations: [],
  });
});

Deno.test("documents/contexts#R7 [ctx-I6]: the default child_pattern takes every child folder, and files directly under root are not entities", () => {
  const type = typeWith("Run", {
    kind: "folder",
    root: "runs",
    child_pattern: "*",
    depth: 1,
  });
  assertEquals(
    folderKind(type, kindContext(project)).anchors.map((a) => a.path),
    ["runs/run-1", "runs/run-2", "runs/scratch"],
  );
});

Deno.test("documents/contexts#R7 [ctx-I6]: only depth 1 counts, so a folder below a child is not an entity", () => {
  const type = typeWith("Run", {
    kind: "folder",
    root: "runs/run-2",
    child_pattern: "*",
    depth: 1,
  });
  assertEquals(folderKind(type, kindContext(project)), {
    anchors: [{
      type: "Run",
      path: "runs/run-2/notes",
      section: null,
      captures: { folder: "notes" },
      scope: { kind: "folder" },
    }],
    violations: [],
  });
});
