import { assertEquals } from "@std/assert";
import {
  assertCheckpointVisible,
  foldedRanges,
  foldsOf,
  hiddenFromSeq,
  hiddenRanges,
  hiddenRangesOf,
  type RevertRow,
} from "./hidden.ts";
import { doRewind, openEnv } from "./testing/flow.ts";
import { failed, MCL, MSG, must, openWorld, RVT, SES } from "./testing/mod.ts";

// 숨김 구간의 끝(agent-RW3d). 숨김은 rewind가 적용된 순간 있던 메시지(boundary_seq부터 result_seq까지)이고
// 그 뒤에 접수한 메시지는 숨기지 않는다. 그렇지 않으면 rewind 뒤의 대화가 모두 사라진다.

const seqOf = (world: ReturnType<typeof openWorld>, message: string) =>
  String(
    world.query("select created_seq from messages where id = ?", [
      message,
    ])[0]!["created_seq"],
  );

Deno.test("lophn-agent/revert#R16 [agent-RW3d]: a message received after a rewind is not hidden, and can be chosen as a checkpoint", () => {
  const world = openWorld();
  world.addSession();
  for (let n = 1; n <= 3; n++) world.addRequest(n);
  const { result_seq } = world.seedRevert({
    id: RVT(1),
    checkpoint: MSG(2),
    boundary_message: MSG(2),
  });
  world.addRequest(4);
  assertEquals(hiddenRanges(world.lookup, SES), [
    { from_seq: seqOf(world, MSG(2)), through_seq: result_seq },
  ]);
  failed(assertCheckpointVisible(world.lookup, SES, MSG(3)), "invalid_input");
  must(assertCheckpointVisible(world.lookup, SES, MSG(4)));
});

Deno.test("lophn-agent/revert#R16 [agent-RW3d]: rewinds that do not overlap hide two ranges, and the hidden start is the earliest boundary", () => {
  const world = openWorld();
  world.addSession();
  for (let n = 1; n <= 2; n++) world.addRequest(n);
  const first = world.seedRevert({
    id: RVT(1),
    checkpoint: MSG(2),
    boundary_message: MSG(2),
  });
  world.addRequest(3);
  world.addRequest(4);
  const second = world.seedRevert({
    id: RVT(2),
    checkpoint: MSG(4),
    boundary_message: MSG(4),
  });
  assertEquals(hiddenRanges(world.lookup, SES), [
    { from_seq: seqOf(world, MSG(2)), through_seq: first.result_seq },
    { from_seq: seqOf(world, MSG(4)), through_seq: second.result_seq },
  ]);
  assertEquals(hiddenFromSeq(world.lookup, SES), seqOf(world, MSG(2)));
});

Deno.test("lophn-agent/revert#R16 [agent-RW3d]: overlapping rewinds make one range", () => {
  const rows: RevertRow[] = [
    ["rvt_1", "5", "20"],
    ["rvt_2", "3", "30"],
  ].map(([id, boundary, result]) => ({
    id: id!,
    kind: "rewind" as const,
    choice: "restore_all" as const,
    outcome: "applied" as const,
    redo: "available" as const,
    boundary_seq: boundary!,
    result_seq: result!,
    summary_call: null,
  }));
  assertEquals(hiddenRangesOf(rows), [{ from_seq: "3", through_seq: "30" }]);
});

Deno.test("lophn-agent/revert#R15 [agent-RW3d]: a fold is not used when a later rewind hid messages inside it, and is used again after that redo", () => {
  const fold = (over: Partial<RevertRow> = {}): RevertRow => ({
    id: "rvt_fold",
    kind: "rewind",
    choice: "summarize",
    outcome: "applied",
    redo: "none",
    boundary_seq: "3",
    result_seq: "20",
    summary_call: "mcl_1",
    ...over,
  });
  const hidden = (over: Partial<RevertRow> = {}): RevertRow => ({
    id: "rvt_hidden",
    kind: "rewind",
    choice: "messages_only",
    outcome: "applied",
    redo: "available",
    boundary_seq: "8",
    result_seq: "30",
    summary_call: null,
    ...over,
  });
  assertEquals(foldsOf([fold()]).length, 1);
  // 접힌 구간 안(8)에서 나중에 숨겼다: 요약이 숨긴 내용을 품고 있다.
  assertEquals(foldsOf([fold(), hidden()]), []);
  // 숨김을 풀면 접힘이 다시 선다.
  assertEquals(foldsOf([fold(), hidden({ redo: "done" })]).length, 1);
  // 접힌 구간 밖에서 숨기면 접힘은 그대로다.
  assertEquals(
    foldsOf([fold(), hidden({ boundary_seq: "25", result_seq: "40" })]).length,
    1,
  );
  // 접힌 구간 앞에서 숨긴 것(접힘 앞 구간)도 그대로다.
  assertEquals(
    foldsOf([hidden({ boundary_seq: "1", result_seq: "2" }), fold()]).length,
    1,
  );
});

Deno.test("lophn-agent/revert#R15 [agent-RW3d]: a summarize rewind is refused while the range to fold holds hidden messages", async () => {
  const env = openEnv();
  for (let n = 1; n <= 3; n++) env.world.addRequest(n);
  must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(3),
      choice: "messages_only",
    }),
  );
  // 숨김 뒤에 새 대화가 이어지고, 그 뒤 메시지부터는 접을 수 있다.
  env.world.addRequest(4);
  env.world.addRequest(5);
  const refused = await doRewind(env, {
    id: RVT(2),
    checkpoint: MSG(2),
    choice: "summarize",
    summary_call: MCL(1),
  });
  failed(refused, "invalid_input");
  must(
    await doRewind(env, {
      id: RVT(3),
      checkpoint: MSG(4),
      choice: "summarize",
      summary_call: MCL(2),
    }),
  );
  assertEquals(foldedRanges(env.world.lookup, SES).map((fold) => fold.revert), [
    RVT(3),
  ]);
});
