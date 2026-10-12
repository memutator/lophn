import { assertEquals } from "@std/assert";
import {
  type FileAction,
  type FileStat,
  type JudgedFile,
  judgeFiles,
  type JudgeRecord,
} from "./judge.ts";
import { sha256, TCL } from "./testing/mod.ts";

// 문서 파일 복원 판정 규칙(agent-RW3b). 기록과 파일의 지금 상태만 받는 순수 함수라 파일·DB가 없다.

type State = string | null;

function rec(
  tool: number,
  path: string,
  before: State,
  after: State,
  extra: Partial<JudgeRecord> = {},
): JudgeRecord {
  return {
    tool_call: TCL(tool),
    path,
    seq: String(tool * 10),
    before: before === null
      ? { exists: false, sha256: null, blob: null }
      : { exists: true, sha256: sha256(before), blob: sha256(before) },
    after: after === null
      ? { exists: false, sha256: null }
      : { exists: true, sha256: sha256(after) },
    moved_from: null,
    reverted_by: null,
    ...extra,
  };
}

function now(files: Record<string, State | "link">): Map<string, FileStat> {
  return new Map(
    Object.entries(files).map(([path, state]) => [
      path,
      state === null
        ? { exists: false, sha256: null, link: false }
        : state === "link"
        ? { exists: true, sha256: sha256("any"), link: true }
        : { exists: true, sha256: sha256(state), link: false },
    ]),
  );
}

function one(
  records: JudgeRecord[],
  files: Record<string, State | "link">,
): JudgedFile {
  const judged = judgeFiles({ records, current: now(files) });
  assertEquals(judged.length, 1);
  return judged[0]!;
}

const restoreWrite = (path: string, content: string): FileAction[] => [{
  kind: "write",
  path,
  sha256: sha256(content),
  blob: sha256(content),
}];

Deno.test("lophn-agent/revert#R17 [agent-RW3b]: a file whose hash still equals what the agent last wrote is restored to the first pre-image", () => {
  const judged = one([rec(1, "a.md", "old", "new")], { "a.md": "new" });
  assertEquals(judged, {
    path: "a.md",
    source: [TCL(1)],
    plan: "restore",
    reason: null,
    actions: restoreWrite("a.md", "old"),
    restored_sha256: sha256("old"),
  });
});

Deno.test("lophn-agent/revert#R17 [agent-RW3b]: a chain of writes restores to the first before and lists every call in order", () => {
  const judged = one(
    [rec(1, "a.md", "v0", "v1"), rec(2, "a.md", "v1", "v2")],
    { "a.md": "v2" },
  );
  assertEquals(judged.plan, "restore");
  assertEquals(judged.source, [TCL(1), TCL(2)]);
  assertEquals(judged.actions, restoreWrite("a.md", "v0"));
});

Deno.test("lophn-agent/revert#R17 [agent-RW3b]: a person's edit after the agent's last write skips the file as edited_outside", () => {
  const judged = one([rec(1, "a.md", "old", "new")], { "a.md": "person" });
  assertEquals(judged.plan, "skip");
  assertEquals(judged.reason, "edited_outside");
  assertEquals(judged.actions, []);
});

Deno.test("lophn-agent/revert#R17 [agent-RW3b]: a person's edit between two writes breaks the chain even when the end still matches", () => {
  const judged = one(
    [rec(1, "a.md", "v0", "v1"), rec(2, "a.md", "person edit", "v2")],
    { "a.md": "v2" },
  );
  assertEquals(judged.plan, "skip");
  assertEquals(judged.reason, "chain_broken");
});

Deno.test("lophn-agent/revert#R17 [agent-RW3b]: a file the agent created is deleted when untouched and kept when a person edited it", () => {
  const untouched = one([rec(1, "n.md", null, "text")], { "n.md": "text" });
  assertEquals(untouched.plan, "restore");
  assertEquals(untouched.actions, [{ kind: "delete", path: "n.md" }]);
  assertEquals(untouched.restored_sha256, null);

  const edited = one([rec(1, "n.md", null, "text")], { "n.md": "person" });
  assertEquals(edited.plan, "skip");
  assertEquals(edited.reason, "created_edited");
  assertEquals(edited.actions, []);

  // 사람이 이미 지웠으면 지울 것이 없어도 복원 쪽이다.
  const gone = one([rec(1, "n.md", null, "text")], { "n.md": null });
  assertEquals(gone.plan, "restore");
});

Deno.test("lophn-agent/revert#R17 [agent-RW3b]: a file the agent deleted comes back, and one a person re-created is left alone", () => {
  const deleted = one([rec(1, "d.md", "body", null)], { "d.md": null });
  assertEquals(deleted.plan, "restore");
  assertEquals(deleted.actions, restoreWrite("d.md", "body"));

  const recreated = one([rec(1, "d.md", "body", null)], { "d.md": "person" });
  assertEquals(recreated.plan, "skip");
  assertEquals(recreated.reason, "edited_outside");
});

Deno.test("lophn-agent/revert#R17 [agent-RW3b]: a file a person deleted after the agent wrote it is restored from the pre-image", () => {
  const judged = one([rec(1, "a.md", "old", "new")], { "a.md": null });
  assertEquals(judged.plan, "restore");
  assertEquals(judged.actions, restoreWrite("a.md", "old"));
});

Deno.test("lophn-agent/revert#R17 [agent-RW3b]: symlink and hard link paths are skipped as link_path before any other check", () => {
  const judged = one([rec(1, "l.md", "old", "new")], { "l.md": "link" });
  assertEquals(judged.plan, "skip");
  assertEquals(judged.reason, "link_path");
});

Deno.test("lophn-agent/revert#R14 [agent-RW3b]: an unrecorded pre-image anywhere in the chain skips the path as no_pre_image", () => {
  const unrecorded = (tool: number, before: string, after: string) =>
    rec(tool, "big.bin", before, after, {
      before: { exists: true, sha256: sha256(before), blob: null },
    });
  const first = one([unrecorded(1, "v0", "v1")], { "big.bin": "v1" });
  assertEquals(first.plan, "skip");
  assertEquals(first.reason, "no_pre_image");
  const middle = one(
    [rec(1, "big.bin", "v0", "v1"), unrecorded(2, "v1", "v2")],
    { "big.bin": "v2" },
  );
  assertEquals(middle.reason, "no_pre_image");
});

Deno.test("lophn-agent/revert#R17 [agent-RW3b]: a rename writes the old path back and deletes the new one, unless the old path is taken", () => {
  const moved = rec(1, "b.md", "body", "body", { moved_from: "a.md" });
  const judged = one([moved], { "b.md": "body", "a.md": null });
  assertEquals(judged.path, "b.md");
  assertEquals(judged.plan, "restore");
  assertEquals(judged.actions, [
    ...restoreWrite("a.md", "body"),
    { kind: "delete", path: "b.md" },
  ]);

  const blocked = one([moved], { "b.md": "body", "a.md": "someone else" });
  assertEquals(blocked.plan, "skip");
  assertEquals(blocked.reason, "rename_blocked");
});

Deno.test("lophn-agent/revert#R19 [agent-RW3b]: records already reverted drop out of the chain; all reverted is already_reverted", () => {
  const undone = rec(1, "a.md", "v0", "v1", { reverted_by: "rvt_x" });
  // 앞 기록이 되돌려졌으면 뒤 기록만이 사슬이다.
  const rest = one(
    [undone, rec(2, "a.md", "v1", "v2")],
    { "a.md": "v2" },
  );
  assertEquals(rest.plan, "restore");
  assertEquals(rest.source, [TCL(2)]);
  assertEquals(rest.actions, restoreWrite("a.md", "v1"));
  // 모두 되돌려졌으면 할 일이 없다.
  const all = one([undone], { "a.md": "v0" });
  assertEquals(all.plan, "skip");
  assertEquals(all.reason, "already_reverted");
  assertEquals(all.actions, []);
});

Deno.test("lophn-agent/revert#R4 [agent-RW3b]: each path is judged on its own and results follow the first record's order", () => {
  const judged = judgeFiles({
    records: [
      rec(3, "late.md", "x", "y"),
      rec(1, "first.md", "a", "b"),
      rec(2, "mid.md", "c", "d"),
    ],
    current: now({ "first.md": "b", "mid.md": "person", "late.md": "y" }),
  });
  assertEquals(
    judged.map((file) => [file.path, file.plan, file.reason]),
    [
      ["first.md", "restore", null],
      ["mid.md", "skip", "edited_outside"],
      ["late.md", "restore", null],
    ],
  );
});
