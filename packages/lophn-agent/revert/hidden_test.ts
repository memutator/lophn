import { assert, assertEquals } from "@std/assert";
import {
  assertCheckpointVisible,
  foldedRanges,
  hiddenFromSeq,
} from "./hidden.ts";
import { createRevertReads } from "./reads.ts";
import { observeFiles } from "./prepare.ts";
import { createRevertCommands } from "./commands.ts";
import {
  failed,
  makeDeps,
  MCL,
  MSG,
  must,
  openWorld,
  OTHER_SES,
  RVT,
  SES,
  sha256,
  tempDir,
  userCtx,
  type World,
} from "./testing/mod.ts";

// 숨김 구간과 접힘 구간(agent-RW3d). reverts 행을 직접 심은 가짜 ledger를 읽는다.

// 사람 요청 다섯 개가 있는 session이다.
function conversation(): World {
  const world = openWorld();
  world.addSession();
  for (let n = 1; n <= 5; n++) world.addRequest(n);
  return world;
}

const seqOf = (world: World, message: string) =>
  String(
    world.query("select created_seq from messages where id = ?", [
      message,
    ])[0]!["created_seq"],
  );

Deno.test("lophn-agent/revert#R16 [agent-RW3d]: nothing is hidden before a rewind, and a rewind hides from its checkpoint message on", () => {
  const world = conversation();
  assertEquals(hiddenFromSeq(world.lookup, SES), null);
  world.seedRevert({
    id: RVT(1),
    checkpoint: MSG(3),
    boundary_message: MSG(3),
    redo: "available",
  });
  assertEquals(hiddenFromSeq(world.lookup, SES), seqOf(world, MSG(3)));
});

Deno.test("lophn-agent/revert#R16 [agent-RW3d]: the earliest boundary among overlapping rewinds starts the hidden range", () => {
  const world = conversation();
  world.seedRevert({
    id: RVT(1),
    checkpoint: MSG(4),
    boundary_message: MSG(4),
  });
  world.seedRevert({
    id: RVT(2),
    checkpoint: MSG(2),
    boundary_message: MSG(2),
  });
  world.seedRevert({
    id: RVT(3),
    checkpoint: MSG(3),
    boundary_message: MSG(3),
  });
  assertEquals(hiddenFromSeq(world.lookup, SES), seqOf(world, MSG(2)));
});

Deno.test("lophn-agent/revert#R16 [agent-RW3d]: partial and uncertain results hide too, while blocked, summarize and a used redo do not", () => {
  const hides = (
    over: Partial<Parameters<World["seedRevert"]>[0]>,
  ): string | null => {
    const world = conversation();
    world.seedRevert({
      id: RVT(1),
      checkpoint: MSG(3),
      boundary_message: MSG(3),
      ...over,
    });
    return hiddenFromSeq(world.lookup, SES);
  };
  const at = seqOf(conversation(), MSG(3));
  assertEquals(hides({ outcome: "partial" }), at);
  assertEquals(hides({ outcome: "uncertain" }), at);
  assertEquals(hides({ choice: "messages_only", redo: "closed" }), at);
  assertEquals(hides({ outcome: "blocked" }), null);
  assertEquals(hides({ choice: "summarize", summary_call: MCL(1) }), null);
  // redo를 쓰면 숨긴 메시지가 다시 보인다.
  assertEquals(hides({ redo: "done" }), null);
});

Deno.test("lophn-agent/revert#R16 [agent-RW3d]: another session's rewind hides nothing here", () => {
  const world = conversation();
  world.addSession(OTHER_SES);
  const { message } = world.addRequest(9, { session: OTHER_SES });
  world.seedRevert({
    id: RVT(1),
    session: OTHER_SES,
    checkpoint: message,
    boundary_message: message,
  });
  assertEquals(hiddenFromSeq(world.lookup, SES), null);
});

Deno.test("lophn-agent/revert#R15 [agent-RW3d]: a summarize rewind folds the range from its boundary to its result, and hides nothing", () => {
  const world = conversation();
  const { result_seq } = world.seedRevert({
    id: RVT(1),
    checkpoint: MSG(2),
    boundary_message: MSG(2),
    choice: "summarize",
    summary_call: MCL(7),
  });
  assertEquals(foldedRanges(world.lookup, SES), [{
    revert: RVT(1),
    from_seq: seqOf(world, MSG(2)),
    through_seq: result_seq,
    summary_call: MCL(7),
  }]);
  assertEquals(hiddenFromSeq(world.lookup, SES), null);
  // restore_all·messages_only는 접힘 구간이 아니다.
  const other = conversation();
  other.seedRevert({
    id: RVT(1),
    checkpoint: MSG(2),
    boundary_message: MSG(2),
  });
  assertEquals(foldedRanges(other.lookup, SES), []);
});

Deno.test("lophn-agent/revert#R16 [agent-RW3d]: a checkpoint inside the hidden range cannot be chosen again", () => {
  const world = conversation();
  world.seedRevert({
    id: RVT(1),
    checkpoint: MSG(3),
    boundary_message: MSG(3),
  });
  must(assertCheckpointVisible(world.lookup, SES, MSG(2)));
  failed(assertCheckpointVisible(world.lookup, SES, MSG(3)), "invalid_input");
  failed(assertCheckpointVisible(world.lookup, SES, MSG(5)), "invalid_input");
});

Deno.test("lophn-agent/revert#R16 [agent-RW3d]: Rewind and the preview refuse a hidden checkpoint, and rewind/checkpoints marks it", () => {
  const world = conversation();
  world.seedRevert({
    id: RVT(1),
    checkpoint: MSG(3),
    boundary_message: MSG(3),
  });
  const { deps } = makeDeps(tempDir("project"), observeFiles);
  const reads = createRevertReads(deps);
  const commands = createRevertCommands(deps);
  failed(
    world.read(reads.preview, userCtx, {
      kind: "rewind",
      session: SES,
      checkpoint: MSG(4),
      choice: "messages_only",
    }),
    "invalid_input",
  );
  failed(
    world.call(commands.rewind, userCtx, {
      id: RVT(2),
      session: SES,
      checkpoint: MSG(4),
      choice: "messages_only",
      accept_remaining: true,
      preview_hash: sha256("any"),
      summary_call: null,
      files: [],
    }),
    "invalid_input",
  );
  const listed = must(world.read(reads.checkpoints, userCtx, { session: SES }));
  assertEquals(
    listed.checkpoints.map((entry) => [entry.message, entry.hidden]),
    [
      [MSG(1), false],
      [MSG(2), false],
      [MSG(3), true],
      [MSG(4), true],
      [MSG(5), true],
    ],
  );
  const reverts = must(world.read(reads.list, userCtx, { session: SES }));
  assertEquals(reverts.hidden_from_seq, seqOf(world, MSG(3)));
  assert(reverts.reverts.length === 1);
});
