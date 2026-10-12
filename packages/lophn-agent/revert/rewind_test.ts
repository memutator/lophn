import { assertEquals } from "@std/assert";
import { planRewind } from "./preview.ts";
import {
  agentWrite,
  doRedo,
  doRewind,
  doUndo,
  type Env,
  fileText,
  humanEdit,
  itemsOf,
  openEnv,
  planOf,
  revertRow,
} from "./testing/flow.ts";
import {
  agentCtx,
  failed,
  machineCtx,
  MSG,
  must,
  RUN,
  RVT,
  SES,
  TCL,
  userCtx,
  writeProjectFile,
} from "./testing/mod.ts";

// 문서 파일 rewind·Undo·Redo(agent-RW3b). 가짜 ledger Tx + 임시 project 폴더의 실제 파일 + 임시
// 저장소다. agent의 쓰기는 실제 배선(recordBeforeWrite)으로 pre-image를 남긴다.

// 사람 요청 하나(M1)가 a.md, b.md를 쓴 상태다. a: a0 → a1, b: b0 → b1.
async function scenario(): Promise<{ env: Env; run: string; seq: string }> {
  const env = openEnv();
  const { run, seq } = env.world.addRequest(1);
  env.world.addToolCall(1, run);
  env.world.addToolCall(2, run);
  writeProjectFile(env.root, "a.md", "a0");
  writeProjectFile(env.root, "b.md", "b0");
  must(
    await agentWrite(env, {
      tool_call: TCL(1),
      run,
      path: "a.md",
      content: "a1",
    }),
  );
  must(
    await agentWrite(env, {
      tool_call: TCL(2),
      run,
      path: "b.md",
      content: "b1",
    }),
  );
  return { env, run, seq };
}

function reverted(env: Env): [string, string | null][] {
  return env.world.query(
    "select tool_call, reverted_by from rewind_files order by tool_call",
  ).map((row) => [
    String(row["tool_call"]),
    row["reverted_by"] === null ? null : String(row["reverted_by"]),
  ]);
}

Deno.test("lophn-agent/revert#R4 [agent-RW3b]: a file a person edited is skipped and listed while the other file is restored", async () => {
  const { env, seq } = await scenario();
  humanEdit(env, "b.md", "b by a person");
  const header = must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
    }),
  );
  assertEquals(header.outcome, "applied");
  assertEquals(header.kind, "rewind");
  assertEquals(header.redo, "available");
  assertEquals(header.replayed, false);
  assertEquals(fileText(env, "a.md"), "a0");
  assertEquals(fileText(env, "b.md"), "b by a person");
  assertEquals(itemsOf(env, RVT(1)), [
    {
      ordinal: 0,
      class: "file",
      target: "a.md",
      plan: "restore",
      result: "restored",
      reason: null,
    },
    {
      ordinal: 1,
      class: "file",
      target: "b.md",
      plan: "skip",
      result: "skipped",
      reason: "edited_outside",
    },
  ]);
  // 복원한 기록만 되돌려짐으로 표시한다.
  assertEquals(reverted(env), [[TCL(1), RVT(1)], [TCL(2), null]]);
  const row = revertRow(env, RVT(1))!;
  assertEquals([row.kind, row.choice, row.checkpoint, row.boundary_seq], [
    "rewind",
    "restore_all",
    MSG(1),
    seq,
  ]);
  assertEquals(row.redo, "available");
  const [applied] = env.world.events("RevertApplied");
  assertEquals(applied!.subject, RVT(1));
  assertEquals(applied!.payload, {
    session: SES,
    kind: "rewind",
    choice: "restore_all",
    partial: true,
    results: {
      restored: 1,
      skipped: 1,
      remained: 0,
      failure: 0,
      uncertain: 0,
      unchanged: 0,
    },
    boundary_seq: seq,
    redo: "available",
  });
  assertEquals(row.result_seq, applied!.seq);
});

Deno.test("lophn-agent/revert#R3 [agent-RW3b]: when nothing is skipped or left, the rewind applies without the person accepting a list", async () => {
  const { env } = await scenario();
  const header = must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
      accept: false,
    }),
  );
  assertEquals(header.outcome, "applied");
  assertEquals(fileText(env, "a.md"), "a0");
  assertEquals(fileText(env, "b.md"), "b0");
  assertEquals(env.world.events("RevertApplied")[0]!.payload["partial"], false);
});

Deno.test("lophn-agent/revert#R7 [agent-RW3b]: skipped or remaining effects not accepted by the person leave everything unchanged", async () => {
  const { env } = await scenario();
  humanEdit(env, "b.md", "b by a person");
  const header = must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
      accept: false,
    }),
  );
  assertEquals(header.outcome, "blocked");
  assertEquals(header.redo, "none");
  assertEquals(fileText(env, "a.md"), "a1");
  assertEquals(fileText(env, "b.md"), "b by a person");
  assertEquals(reverted(env), [[TCL(1), null], [TCL(2), null]]);
  assertEquals(env.world.events("RevertApplied"), []);
  const [blocked] = env.world.events("RevertBlocked");
  assertEquals(blocked!.payload["session"], SES);
  assertEquals(revertRow(env, RVT(1))!.outcome, "blocked");
  // blocked는 항목을 남기지 않는다.
  assertEquals(itemsOf(env, RVT(1)), []);
});

Deno.test("lophn-agent/revert#R3 [agent-RW3b]: a preview that went stale is not applied; the current judgement is stored as blocked", async () => {
  const { env } = await scenario();
  const shown = planOf(env, {
    kind: "rewind",
    checkpoint: MSG(1),
    choice: "restore_all",
  }).preview.preview_hash;
  // 사람이 preview를 본 뒤 a.md를 고친다.
  humanEdit(env, "a.md", "a by a person");
  const header = must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
      preview_hash: shown,
    }),
  );
  assertEquals(header.outcome, "blocked");
  assertEquals(fileText(env, "a.md"), "a by a person");
  assertEquals(fileText(env, "b.md"), "b1");
  assertEquals(env.world.events("RevertBlocked").length, 1);
  assertEquals(itemsOf(env, RVT(1)), []);
});

Deno.test("lophn-agent/revert#R8 [agent-RW3b]: repeating the same request restores once and returns the stored result", async () => {
  const { env } = await scenario();
  const first = must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
    }),
  );
  // 사이에 사람이 다시 고쳤더라도 같은 요청은 저장된 결과를 돌려주고 다시 적용하지 않는다.
  humanEdit(env, "a.md", "a edited after the rewind");
  const again = must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
    }),
  );
  assertEquals(again.replayed, true);
  assertEquals(again.result_seq, first.result_seq);
  assertEquals(again.outcome, "applied");
  assertEquals(fileText(env, "a.md"), "a edited after the rewind");
  assertEquals(env.world.events("RevertApplied").length, 1);
  assertEquals(
    Number(env.world.query("select count(*) as n from reverts")[0]!["n"]),
    1,
  );
});

Deno.test("lophn-agent/revert#R12 [agent-RW3b]: a correction message allows messages_only but never restore_all", async () => {
  const { env } = await scenario();
  env.world.addRequest(2, { mode: "correction" });
  const refused = planRewind(
    env.world.lookup,
    env.deps,
    { kind: "rewind", session: SES, checkpoint: MSG(2), choice: "restore_all" },
  );
  failed(refused, "invalid_input");
  const header = must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(2),
      choice: "messages_only",
    }),
  );
  assertEquals(header.outcome, "applied");
  // 대화만 되돌렸으니 파일은 그대로다.
  assertEquals(fileText(env, "a.md"), "a1");
  assertEquals(reverted(env), [[TCL(1), null], [TCL(2), null]]);
});

Deno.test("lophn-agent/revert#R14 [agent-RW3b]: a checkpoint whose files are not restorable refuses restore_all and still allows messages_only", async () => {
  const { env } = await scenario();
  env.world.db.prepare(
    "update checkpoints set files_restorable = 0, files_reason = 'limit_total' where message = ?",
  ).run(MSG(1));
  failed(
    planRewind(env.world.lookup, env.deps, {
      kind: "rewind",
      session: SES,
      checkpoint: MSG(1),
      choice: "restore_all",
    }),
    "invalid_input",
  );
  const header = must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "messages_only",
    }),
  );
  assertEquals(header.outcome, "applied");
  assertEquals(header.redo, "available");
  assertEquals(fileText(env, "a.md"), "a1");
});

Deno.test("lophn-agent/revert#R2 [agent-RW3b]: an agent cannot rewind, undo or redo", async () => {
  const { env } = await scenario();
  const plan = planOf(env, {
    kind: "rewind",
    checkpoint: MSG(1),
    choice: "messages_only",
  });
  const agent = agentCtx(RUN(1));
  failed(
    env.world.call(env.commands.rewind, agent, {
      id: RVT(1),
      session: SES,
      checkpoint: MSG(1),
      choice: "messages_only",
      accept_remaining: true,
      preview_hash: plan.preview.preview_hash,
      summary_call: null,
      files: [],
    }),
    "forbidden",
  );
  failed(
    env.world.call(env.commands.undo, agent, {
      id: RVT(2),
      session: SES,
      tool_call: TCL(1),
      preview_hash: plan.preview.preview_hash,
      files: [],
    }),
    "forbidden",
  );
  failed(
    env.world.call(env.commands.redo, agent, {
      revert: RVT(1),
      result_seq: "1",
      files: [],
    }),
    "forbidden",
  );
  assertEquals(
    Number(env.world.query("select count(*) as n from reverts")[0]!["n"]),
    0,
  );
});

Deno.test("lophn-agent/revert#R16 [agent-RW3b]: redo puts back the agent's files, except those a person edited after the rewind", async () => {
  const { env } = await scenario();
  must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
    }),
  );
  assertEquals(fileText(env, "a.md"), "a0");
  assertEquals(fileText(env, "b.md"), "b0");
  humanEdit(env, "b.md", "b by a person after the rewind");
  const header = must(await doRedo(env, RVT(1)));
  assertEquals(header.redo, "done");
  assertEquals(header.outcome, "applied");
  assertEquals(fileText(env, "a.md"), "a1");
  assertEquals(fileText(env, "b.md"), "b by a person after the rewind");
  const [redone] = env.world.events("RevertRedone");
  assertEquals(redone!.subject, RVT(1));
  assertEquals(redone!.payload["session"], SES);
  assertEquals(redone!.payload["files"], 1);
  assertEquals(revertRow(env, RVT(1))!.redo, "done");
  // redo는 한 번이다.
  failed(await doRedo(env, RVT(1)), "conflict");
  // 다시 쓴 파일은 되돌려짐 표시가 풀려 같은 checkpoint로 다시 rewind할 수 있다.
  const again = planOf(env, {
    kind: "rewind",
    checkpoint: MSG(1),
    choice: "restore_all",
  }).preview;
  assertEquals(again.restore.map((item) => item.target), ["a.md"]);
});

Deno.test("lophn-agent/revert#R15 [agent-RW3b]: a rewind starts only when no run is active in the session", async () => {
  const { env } = await scenario();
  env.world.db.prepare("update runs set state = 'running' where id = ?").run(
    RUN(1),
  );
  const refused = await doRewind(env, {
    id: RVT(1),
    checkpoint: MSG(1),
    choice: "restore_all",
  });
  failed(refused, "conflict");
  assertEquals(revertRow(env, RVT(1)), undefined);
  assertEquals(fileText(env, "a.md"), "a1");
  // 멈춘 뒤에는 된다.
  env.world.db.prepare("update runs set state = 'finished' where id = ?").run(
    RUN(1),
  );
  assertEquals(
    must(
      await doRewind(env, {
        id: RVT(1),
        checkpoint: MSG(1),
        choice: "restore_all",
      }),
    ).outcome,
    "applied",
  );
});

Deno.test("lophn-agent/revert#R19 [agent-RW3b]: Undo restores one edit, hides nothing and leaves a fact for the agent", async () => {
  const { env } = await scenario();
  const header = must(await doUndo(env, { id: RVT(1), tool_call: TCL(2) }));
  assertEquals(header.kind, "undo");
  assertEquals(header.outcome, "applied");
  assertEquals(header.redo, "none");
  assertEquals(fileText(env, "b.md"), "b0");
  assertEquals(fileText(env, "a.md"), "a1");
  assertEquals(env.facts, ["Undid edit to b.md"]);
  assertEquals(reverted(env), [[TCL(1), null], [TCL(2), RVT(1)]]);
  const row = revertRow(env, RVT(1))!;
  assertEquals([
    row.kind,
    row.choice,
    row.checkpoint,
    row.tool_call,
    row.boundary_seq,
  ], [
    "undo",
    null,
    null,
    TCL(2),
    null,
  ]);
  const [applied] = env.world.events("RevertApplied");
  assertEquals(applied!.payload["kind"], "undo");
  assertEquals(applied!.payload["boundary_seq"], null);
  assertEquals(applied!.payload["redo"], "none");
});

Deno.test("lophn-agent/revert#R19 [agent-RW3b]: Undo is disabled with a reason when a person or a later edit changed the file", async () => {
  const { env, run } = await scenario();
  // 사람이 b.md를 고쳤다.
  humanEdit(env, "b.md", "b by a person");
  const human = planOf(env, { kind: "undo", tool_call: TCL(2) }).preview;
  assertEquals(human.restore, []);
  assertEquals(human.skip.map((item) => [item.target, item.reason]), [
    ["b.md", "edited_outside"],
  ]);
  // 같은 파일의 더 최근 편집이 있다.
  env.world.addToolCall(3, run);
  must(
    await agentWrite(env, {
      tool_call: TCL(3),
      run,
      path: "a.md",
      content: "a2",
    }),
  );
  const later = planOf(env, { kind: "undo", tool_call: TCL(1) }).preview;
  assertEquals(later.restore, []);
  // 더 최근 agent 편집은 사람이 고친 것(edited_outside)과 이유가 다르다.
  assertEquals(later.skip.map((item) => [item.target, item.reason]), [
    ["a.md", "later_edit"],
  ]);
  // 오래된 preview로 보낸 Undo는 적용하지 않고 blocked다.
  const stale =
    planOf(env, { kind: "undo", tool_call: TCL(3) }).preview.preview_hash;
  humanEdit(env, "a.md", "a by a person");
  const header = must(
    await doUndo(env, { id: RVT(1), tool_call: TCL(3), preview_hash: stale }),
  );
  assertEquals(header.outcome, "blocked");
  assertEquals(fileText(env, "a.md"), "a by a person");
  assertEquals(env.facts, []);
});

Deno.test("lophn-agent/revert#R19 [agent-RW3b]: a call that was undone is already_reverted in a later rewind", async () => {
  const env = openEnv();
  const { run } = env.world.addRequest(1);
  env.world.addToolCall(1, run);
  writeProjectFile(env.root, "a.md", "a0");
  must(
    await agentWrite(env, {
      tool_call: TCL(1),
      run,
      path: "a.md",
      content: "a1",
    }),
  );
  must(await doUndo(env, { id: RVT(1), tool_call: TCL(1) }));
  assertEquals(fileText(env, "a.md"), "a0");
  const header = must(
    await doRewind(env, {
      id: RVT(2),
      checkpoint: MSG(1),
      choice: "restore_all",
    }),
  );
  assertEquals(header.outcome, "applied");
  assertEquals(itemsOf(env, RVT(2)), [{
    ordinal: 0,
    class: "file",
    target: "a.md",
    plan: "skip",
    result: "unchanged",
    reason: "already_reverted",
  }]);
  assertEquals(fileText(env, "a.md"), "a0");
});

Deno.test("lophn-agent/revert#R17 [agent-RW3b]: a file changed after the command but before the install is not overwritten, and its item is amended to skipped", async () => {
  const { env } = await scenario();
  const header = must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
      // command가 확정된 뒤 설치 전에 사람이 a.md를 고친다.
      beforeInstall: () => humanEdit(env, "a.md", "a by a person just now"),
    }),
  );
  assertEquals(header.outcome, "applied");
  assertEquals(fileText(env, "a.md"), "a by a person just now");
  assertEquals(fileText(env, "b.md"), "b0");
  assertEquals(itemsOf(env, RVT(1)), [
    {
      ordinal: 0,
      class: "file",
      target: "a.md",
      plan: "restore",
      result: "skipped",
      reason: "edited_outside",
    },
    {
      ordinal: 1,
      class: "file",
      target: "b.md",
      plan: "restore",
      result: "restored",
      reason: null,
    },
  ]);
  assertEquals(revertRow(env, RVT(1))!.outcome, "applied");
  // 되돌리지 못한 기록은 되돌려짐 표시를 풀어 이후 rewind의 사슬에 다시 든다.
  assertEquals(reverted(env), [[TCL(1), null], [TCL(2), RVT(1)]]);
  const [amended] = env.world.events("RevertAmended");
  assertEquals(amended!.subject, RVT(1));
  assertEquals(amended!.payload, {
    session: SES,
    amended: 1,
    results: {
      restored: 1,
      skipped: 1,
      remained: 0,
      failure: 0,
      uncertain: 0,
      unchanged: 0,
    },
  });
  // 정정은 한 번이고 machine만 하며 복원된 파일 항목에만 한다.
  const again = { revert: RVT(1), paths: ["a.md"] };
  failed(env.world.call(env.commands.amend, machineCtx, again), "conflict");
  failed(
    env.world.call(env.commands.amend, machineCtx, {
      revert: RVT(1),
      paths: ["nope.md"],
    }),
    "conflict",
  );
  failed(env.world.call(env.commands.amend, userCtx, again), "forbidden");
  failed(
    env.world.call(env.commands.amend, machineCtx, {
      revert: RVT(9),
      paths: ["a.md"],
    }),
    "not_found",
  );
  assertEquals(env.world.events("RevertAmended").length, 1);
  // 건너뛴 파일은 redo 근거에서 빠진다: redo는 b.md만 다시 쓴다.
  must(await doRedo(env, RVT(1)));
  assertEquals(env.world.events("RevertRedone")[0]!.payload["files"], 1);
  assertEquals(fileText(env, "a.md"), "a by a person just now");
  assertEquals(fileText(env, "b.md"), "b1");
});

Deno.test("lophn-agent/revert#R8 [agent-RW3b]: repeating an Undo request returns the stored result", async () => {
  const { env } = await scenario();
  const first = must(await doUndo(env, { id: RVT(1), tool_call: TCL(2) }));
  const again = must(await doUndo(env, { id: RVT(1), tool_call: TCL(2) }));
  assertEquals(again.replayed, true);
  assertEquals(again.result_seq, first.result_seq);
  assertEquals(env.facts.length, 1);
  assertEquals(env.world.events("RevertApplied").length, 1);
});
