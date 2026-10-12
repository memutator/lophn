import { assert, assertEquals } from "@std/assert";
import type {
  rewindCheckpoints,
  rewindList,
  rewindPreview,
} from "../../contracts/lophn-agent/mod.ts";
import type { Input, Output } from "../../contracts/platform/mod.ts";
import { createRevertReads } from "./reads.ts";
import { agentWrite, doRewind, humanEdit, openEnv } from "./testing/flow.ts";
import {
  failed,
  machineCtx,
  MSG,
  must,
  OTHER_SES,
  RVT,
  SES,
  TCL,
  userCtx,
  writeProjectFile,
} from "./testing/mod.ts";

// 되돌리기 읽기(agent-RW3b): rewind/preview, rewind/checkpoints, rewind/list. 가짜 ledger snapshot과
// 임시 project 폴더의 실제 파일을 쓴다. agent·앱 자격은 route 선언에서 이미 빠져 있다(contract 시험).

async function scenario() {
  const env = openEnv();
  const first = env.world.addRequest(1);
  env.world.addToolCall(1, first.run);
  writeProjectFile(env.root, "a.md", "a0");
  must(
    await agentWrite(env, {
      tool_call: TCL(1),
      run: first.run,
      path: "a.md",
      content: "a1",
    }),
  );
  const second = env.world.addRequest(2);
  env.world.addToolCall(2, second.run);
  writeProjectFile(env.root, "b.md", "b0");
  must(
    await agentWrite(env, {
      tool_call: TCL(2),
      run: second.run,
      path: "b.md",
      content: "b1",
    }),
  );
  return { env, reads: createRevertReads(env.deps) };
}

Deno.test("lophn-agent/revert#R3 [agent-RW3b]: a rewind preview reads the current judgement and its hash is what Rewind compares", async () => {
  const { env, reads } = await scenario();
  humanEdit(env, "b.md", "b by a person");
  const input: Input<typeof rewindPreview> = {
    kind: "rewind",
    session: SES,
    checkpoint: MSG(1),
    choice: "restore_all",
  };
  const preview = must(env.world.read(reads.preview, userCtx, input));
  assertEquals(preview.kind, "rewind");
  assertEquals(preview.choice, "restore_all");
  assertEquals(preview.checkpoint, MSG(1));
  assertEquals(
    preview.restore.map((item) => [item.target, item.plan]),
    [["a.md", "restore"]],
  );
  assertEquals(
    preview.skip.map((item) => [item.target, item.reason]),
    [["b.md", "edited_outside"]],
  );
  assertEquals(preview.redo, true);
  // 읽는 것은 event나 기록을 만들지 않는다.
  assertEquals(env.world.events("RevertApplied"), []);
  assertEquals(
    Number(env.world.query("select count(*) as n from reverts")[0]!["n"]),
    0,
  );
  // 같은 입력은 같은 hash다. 그 hash로 Rewind를 보내면 적용된다.
  const again = must(env.world.read(reads.preview, machineCtx, input));
  assertEquals(again.preview_hash, preview.preview_hash);
  const header = must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
      preview_hash: preview.preview_hash,
    }),
  );
  assertEquals(header.outcome, "applied");
});

Deno.test("lophn-agent/revert#R19 [agent-RW3b]: an undo preview names the one file and why it can or cannot be undone", async () => {
  const { env, reads } = await scenario();
  const live = must(
    env.world.read(reads.preview, userCtx, {
      kind: "undo",
      session: SES,
      tool_call: TCL(2),
    }),
  );
  assertEquals(live.kind, "undo");
  assertEquals(live.tool_call, TCL(2));
  assertEquals(live.checkpoint, null);
  assertEquals(live.restore.map((item) => item.target), ["b.md"]);
  humanEdit(env, "b.md", "changed");
  const blocked = must(
    env.world.read(reads.preview, userCtx, {
      kind: "undo",
      session: SES,
      tool_call: TCL(2),
    }),
  );
  assertEquals(blocked.restore, []);
  assertEquals(blocked.skip.map((item) => item.reason), ["edited_outside"]);
});

Deno.test("lophn-agent/revert#R12 [agent-RW3b]: the preview refuses a choice the checkpoint does not allow and unknown targets", async () => {
  const { env, reads } = await scenario();
  env.world.addRequest(3, { mode: "correction" });
  failed(
    env.world.read(reads.preview, userCtx, {
      kind: "rewind",
      session: SES,
      checkpoint: MSG(3),
      choice: "restore_all",
    }),
    "invalid_input",
  );
  failed(
    env.world.read(reads.preview, userCtx, {
      kind: "rewind",
      session: SES,
      checkpoint: MSG(77),
      choice: "restore_all",
    }),
    "not_found",
  );
  failed(
    env.world.read(reads.preview, userCtx, {
      kind: "undo",
      session: SES,
      tool_call: TCL(77),
    }),
    "not_found",
  );
});

Deno.test("lophn-agent/revert#R12 [agent-RW3b]: rewind/checkpoints lists the session's checkpoints with their file state, oldest first", async () => {
  const { env, reads } = await scenario();
  env.world.db.prepare(
    "update checkpoints set files_restorable = 0, files_reason = 'limit_count' where message = ?",
  ).run(MSG(1));
  const listed: Output<typeof rewindCheckpoints> = must(
    env.world.read(reads.checkpoints, userCtx, { session: SES }),
  );
  assertEquals(
    listed.checkpoints.map((entry) => [
      entry.message,
      entry.files_restorable,
      entry.files_reason,
      entry.hidden,
    ]),
    [
      [MSG(1), false, "limit_count", false],
      [MSG(2), true, null, false],
    ],
  );
  assert(
    BigInt(listed.checkpoints[0]!.created_seq) <
      BigInt(listed.checkpoints[1]!.created_seq),
  );
});

Deno.test("lophn-agent/revert#R3 [agent-RW3b]: rewind/list returns each revert with its items and the result event", async () => {
  const { env, reads } = await scenario();
  humanEdit(env, "a.md", "a by a person");
  must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
    }),
  );
  const listed: Output<typeof rewindList> = must(
    env.world.read(reads.list, userCtx, { session: SES }),
  );
  assertEquals(listed.reverts.length, 1);
  const revert = listed.reverts[0]!;
  assertEquals([revert.id, revert.kind, revert.choice, revert.outcome], [
    RVT(1),
    "rewind",
    "restore_all",
    "applied",
  ]);
  assertEquals(revert.checkpoint, MSG(1));
  assertEquals(revert.redo, "available");
  assertEquals(
    revert.items.map((
      item,
    ) => [item.target, item.plan, item.result, item.reason]),
    [
      // 판정 순서(첫 기록 순서)가 ordinal이다: M1이 쓴 a.md, M2가 쓴 b.md.
      ["a.md", "skip", "skipped", "edited_outside"],
      ["b.md", "restore", "restored", null],
    ],
  );
  assertEquals(revert.result_seq, env.world.events("RevertApplied")[0]!.seq);
  // 없는 session은 없는 것과 같다.
  failed(
    env.world.read(reads.list, userCtx, { session: OTHER_SES }),
    "not_found",
  );
});
