import assert from "node:assert/strict";
import { test } from "node:test";
import {
  editDiffOf,
  loadEditDiff,
  type ReadToolBody,
} from "../../../../shell/renderer/conversation/activity/edit-diff.ts";

test("editDiffOf parses edit tool inputs across Antigravity, Claude, OpenCode, OMP, and Lophn", () => {
  // Antigravity edit_file (Target / Replacement)
  assert.deepEqual(
    editDiffOf(
      JSON.stringify({
        Path: "/work/notes.txt",
        Target: "hi\n",
        Replacement: "hello\n",
      }),
    ),
    [
      { kind: "delete", oldNumber: 1, text: "hi" },
      { kind: "add", newNumber: 1, text: "hello" },
    ],
  );

  // Antigravity write_file (capital Content)
  assert.deepEqual(
    editDiffOf(JSON.stringify({ Path: "/work/notes.txt", Content: "hi\n" })),
    [{ kind: "add", newNumber: 1, text: "hi" }],
  );

  // Antigravity multi_replace_file_content (ReplacementChunks)
  assert.deepEqual(
    editDiffOf(
      JSON.stringify({
        TargetFile: "/work/a.ts",
        ReplacementChunks: [
          { TargetContent: "a", ReplacementContent: "b" },
          { TargetContent: "c", ReplacementContent: "d" },
        ],
      }),
    ),
    [
      { kind: "delete", oldNumber: 1, text: "a" },
      { kind: "add", newNumber: 1, text: "b" },
      { kind: "delete", oldNumber: 1, text: "c" },
      { kind: "add", newNumber: 1, text: "d" },
    ],
  );

  // OpenCode edit (camelCase oldString / newString) & patch (patchText)
  assert.deepEqual(
    editDiffOf(JSON.stringify({ filePath: "a.ts", oldString: "x", newString: "y" })),
    [
      { kind: "delete", oldNumber: 1, text: "x" },
      { kind: "add", newNumber: 1, text: "y" },
    ],
  );
  assert.deepEqual(
    editDiffOf(
      JSON.stringify({
        patchText: "*** Begin Patch\n*** Update File: a.ts\n@@\n-old\n+new\n*** End Patch",
      }),
    ),
    [
      { kind: "delete", oldNumber: 1, text: "old" },
      { kind: "add", newNumber: 1, text: "new" },
    ],
  );

  // Claude MultiEdit & NotebookEdit
  assert.deepEqual(
    editDiffOf(
      JSON.stringify({
        file_path: "a.ts",
        edits: [{ old_string: "one", new_string: "two" }],
      }),
    ),
    [
      { kind: "delete", oldNumber: 1, text: "one" },
      { kind: "add", newNumber: 1, text: "two" },
    ],
  );
  assert.deepEqual(
    editDiffOf(JSON.stringify({ notebook_path: "a.ipynb", new_source: "print(1)" })),
    [{ kind: "add", newNumber: 1, text: "print(1)" }],
  );

  // Lophn file.edit (already-parsed object from turnBodyView)
  assert.deepEqual(editDiffOf({ path: "a.ts", old_string: "a", new_string: "b" }), [
    { kind: "delete", oldNumber: 1, text: "a" },
    { kind: "add", newNumber: 1, text: "b" },
  ]);
});

test("loadEditDiff falls back to unified diff output for Codex apply_patch and truncated Antigravity inputs", async () => {
  const parts: string[] = [];
  const codexRead: ReadToolBody = async (_call, part) => {
    parts.push(part);
    if (part === "input") return { ok: true, value: { value: "src/app.ts" } };
    return {
      ok: true,
      value: {
        value: "/work/src/app.ts\n@@ -10,3 +10,3 @@\n keep\n-old\n+new\n end\n",
      },
    };
  };
  assert.deepEqual(await loadEditDiff(codexRead, "tcl_1"), [
    { kind: "same", oldNumber: 10, newNumber: 10, text: "keep" },
    { kind: "delete", oldNumber: 11, text: "old" },
    { kind: "add", newNumber: 11, text: "new" },
    { kind: "same", oldNumber: 12, newNumber: 12, text: "end" },
  ]);
  assert.deepEqual(parts, ["input", "output"]);

  // Truncated JSON input (exceeded 64 KiB body limit) falls back to compact unified patch in output.
  const truncatedRead: ReadToolBody = async (_call, part) => {
    if (part === "input") {
      return { ok: true, value: { value: '{"Path":"big.ts","Content":"truncated...' } };
    }
    return {
      ok: true,
      value: { value: "@@ -249,3 +249,4 @@\n ctx\n-before\n+after1\n+after2\n" },
    };
  };
  assert.deepEqual(await loadEditDiff(truncatedRead, "tcl_2"), [
    { kind: "same", oldNumber: 249, newNumber: 249, text: "ctx" },
    { kind: "delete", oldNumber: 250, text: "before" },
    { kind: "add", newNumber: 250, text: "after1" },
    { kind: "add", newNumber: 251, text: "after2" },
  ]);

  // Plain non-diff output is never mistaken for a diff.
  const plainErrorRead: ReadToolBody = async (_call, part) =>
    part === "input"
      ? { ok: false }
      : { ok: true, value: { value: "- permission denied\n+ try again" } };
  assert.equal(await loadEditDiff(plainErrorRead, "tcl_3"), null);
});
