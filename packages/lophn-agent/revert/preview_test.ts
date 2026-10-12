import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { rewindPreviewOutputSchema } from "../../protocol/lophn-agent/mod.ts";
import type { PreviewItem } from "../../protocol/lophn-agent/mod.ts";
import type { FileStat, JudgedFile } from "./judge.ts";
import { assemblePreview, type PreviewInput } from "./preview.ts";
import { APP, INV, MSG, REL, sha256, TCL } from "./testing/mod.ts";

// preview 목록과 preview_hash(agent-RW3b). 순수 함수라 파일·DB가 없다.

const restoreFile: JudgedFile = {
  path: "a.md",
  source: [TCL(1)],
  plan: "restore",
  reason: null,
  actions: [{ kind: "delete", path: "a.md" }],
  restored_sha256: null,
};
const skipFile: JudgedFile = {
  path: "b.md",
  source: [TCL(2)],
  plan: "skip",
  reason: "edited_outside",
  actions: [],
  restored_sha256: null,
};

function appItem(
  plan: "restore" | "remain",
  tool: number,
  reason: PreviewItem["reason"] = null,
  stepKey = `rvt_x:${INV(tool)}`,
): PreviewItem {
  return {
    ordinal: 99,
    class: "app",
    target: TCL(tool),
    source: [TCL(tool)],
    plan,
    reason,
    app_revert: plan === "restore"
      ? {
        app: APP(1),
        release: REL(1),
        command: "ticket.update",
        tool_call: TCL(tool),
        invocation: INV(tool),
        receipt: "opaque",
        expected_revision: "5",
        revert_command: "ticket.revert",
        step_key: stepKey,
        revert_invocation: null,
      }
      : null,
  };
}

const stats = (hashes: Record<string, string>): Map<string, FileStat> =>
  new Map(
    Object.entries(hashes).map(([path, text]) => [
      path,
      { exists: true, sha256: sha256(text), link: false },
    ]),
  );

function input(over: Partial<PreviewInput> = {}): PreviewInput {
  return {
    kind: "rewind",
    choice: "restore_all",
    checkpoint: MSG(1),
    tool_call: null,
    judged: [restoreFile, skipFile],
    apps: [],
    facts: [{
      target: "answered_question",
      reason: "answered_fact",
      source: [],
    }],
    current: stats({ "a.md": "x", "b.md": "y" }),
    ...over,
  };
}

Deno.test("lophn-agent/revert#R3 [agent-RW3b]: restore_all lists what is restored, skipped and left, each with its reason", () => {
  const preview = assemblePreview(input());
  assertEquals(
    preview.restore.map((item) => [item.ordinal, item.class, item.target]),
    [
      [0, "file", "a.md"],
    ],
  );
  assertEquals(
    preview.skip.map((item) => [item.ordinal, item.target, item.reason]),
    [[1, "b.md", "edited_outside"]],
  );
  assertEquals(
    preview.remain.map((item) => [item.ordinal, item.class, item.reason]),
    [[2, "fact", "answered_fact"]],
  );
  assertEquals(preview.redo, true);
  assertEquals(preview.preview_hash.length, 64);
  // 읽기 contract가 받는 모양이다.
  assert(
    rewindPreviewOutputSchema.safeParse({
      as_of_seq: "9",
      next_cursor: null,
      kind: "rewind",
      choice: "restore_all",
      checkpoint: MSG(1),
      tool_call: null,
      restore: preview.restore,
      skip: preview.skip,
      remain: preview.remain,
      redo: preview.redo,
      preview_hash: preview.preview_hash,
    }).success,
  );
});

Deno.test("lophn-agent/revert#R10 [agent-RW3b]: app steps come first in execution order, then files, then facts, and the ordinals follow", () => {
  const preview = assemblePreview(
    input({
      apps: [
        appItem("restore", 5),
        appItem("restore", 4),
        appItem("remain", 3, "no_receipt"),
      ],
    }),
  );
  assertEquals(preview.restore.map((item) => [item.ordinal, item.target]), [
    [0, TCL(5)],
    [1, TCL(4)],
    [3, "a.md"],
  ]);
  assertEquals(preview.remain.map((item) => [item.ordinal, item.target]), [
    [2, TCL(3)],
    [5, "answered_question"],
  ]);
  assertEquals(preview.skip.map((item) => item.ordinal), [4]);
});

Deno.test("lophn-agent/revert#R16 [agent-RW3b]: redo is announced unless an app write is restored, and summarize and undo have none", () => {
  assertEquals(assemblePreview(input()).redo, true);
  assertEquals(
    assemblePreview(input({ apps: [appItem("restore", 5)] })).redo,
    false,
  );
  // 되돌리지 못하는 앱 write만 있으면 redo를 막지 않는다.
  assertEquals(
    assemblePreview(
      input({ apps: [appItem("remain", 5, "no_revert_command")] }),
    )
      .redo,
    true,
  );
  assertEquals(
    assemblePreview(
      input({
        kind: "undo",
        choice: null,
        checkpoint: null,
        tool_call: TCL(1),
        judged: [restoreFile],
        facts: [],
      }),
    )
      .redo,
    false,
  );
});

Deno.test("lophn-agent/revert#R15 [agent-RW3b]: messages_only changes no file and summarize changes nothing", () => {
  const messagesOnly = assemblePreview(input({ choice: "messages_only" }));
  assertEquals(messagesOnly.restore, []);
  assertEquals(messagesOnly.skip, []);
  assertEquals(messagesOnly.redo, true);
  assertEquals(messagesOnly.remain.map((item) => item.class), ["fact"]);
  const summarize = assemblePreview(input({ choice: "summarize" }));
  assertEquals([summarize.restore, summarize.skip, summarize.remain], [
    [],
    [],
    [],
  ]);
  assertEquals(summarize.redo, false);
});

Deno.test("lophn-agent/revert#R19 [agent-RW3b]: an undo previews only its file", () => {
  const preview = assemblePreview(
    input({
      kind: "undo",
      choice: null,
      checkpoint: null,
      tool_call: TCL(1),
      judged: [skipFile],
      facts: [],
    }),
  );
  assertEquals(preview.restore, []);
  assertEquals(preview.skip.map((item) => [item.target, item.reason]), [
    ["b.md", "edited_outside"],
  ]);
  assertEquals(preview.remain, []);
});

Deno.test("lophn-agent/revert#R3 [agent-RW3b]: the same input gives the same hash and any change in what was shown changes it", () => {
  const base = assemblePreview(input()).preview_hash;
  assertEquals(assemblePreview(input()).preview_hash, base);
  // 파일의 지금 hash가 바뀌면 사람이 본 판이 아니다.
  assertNotEquals(
    assemblePreview(
      input({ current: stats({ "a.md": "changed", "b.md": "y" }) }),
    )
      .preview_hash,
    base,
  );
  assertNotEquals(
    assemblePreview(input({ choice: "messages_only" })).preview_hash,
    base,
  );
  assertNotEquals(
    assemblePreview(input({ checkpoint: MSG(2) })).preview_hash,
    base,
  );
  assertNotEquals(
    assemblePreview(input({ judged: [restoreFile] })).preview_hash,
    base,
  );
  assertNotEquals(
    assemblePreview(input({ apps: [appItem("restore", 5)] })).preview_hash,
    base,
  );
});

Deno.test("lophn-agent/revert#R8 [agent-RW3b]: the hash ignores the step key, which carries the revert id the preview does not have yet", () => {
  const preview = assemblePreview(
    input({ apps: [appItem("restore", 5, null, "preview:" + INV(5))] }),
  );
  const applied = assemblePreview(
    input({ apps: [appItem("restore", 5, null, "rvt_real:" + INV(5))] }),
  );
  assertEquals(preview.preview_hash, applied.preview_hash);
});
