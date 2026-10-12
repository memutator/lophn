import { assertEquals } from "@std/assert";
import {
  agentWrite,
  doRewind,
  doUndo,
  type Env,
  fileText,
  humanEdit,
  openEnv,
  revertRow,
} from "./testing/flow.ts";
import {
  MCL,
  MSG,
  must,
  RVT,
  SES,
  TCL,
  writeProjectFile,
} from "./testing/mod.ts";

// rewind가 대화에 미치는 효과(agent-RW3d): 기다리던 질문·approval 취소, 읽은 문서 상태 재설정,
// "Summarize from here". 대화 쪽 효과는 가짜 port(RewindEffects)로 기록만 한다.

// 사람 요청 M1이 a.md를 쓴 상태다. a: a0 → a1. 요청 M2도 있어 M1 뒤가 숨김 구간이 된다.
async function scenario(): Promise<{ env: Env; seq: string }> {
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
  env.world.addRequest(2);
  return { env, seq: first.seq };
}

const names = (env: Env) => env.effects.calls.map((call) => call.name);

Deno.test("lophn-agent/revert#R15 [agent-RW3d]: restore_all and messages_only cancel what waited in the hidden range and reset the read state, once", async () => {
  for (const choice of ["restore_all", "messages_only"] as const) {
    const { env, seq } = await scenario();
    env.effects.waiting = { questions: 1, approvals: 1 };
    must(await doRewind(env, { id: RVT(1), checkpoint: MSG(1), choice }));
    assertEquals(env.effects.calls, [
      { name: "cancelWaiting", input: { session: SES, from_seq: seq } },
      { name: "resetReadState", input: { session: SES, before_seq: seq } },
    ]);
  }
});

Deno.test("lophn-agent/revert#R15 [agent-RW3d]: summarize, undo and a blocked rewind leave the waiting questions and the read state alone", async () => {
  const { env } = await scenario();
  // 사람이 파일을 고쳐 두면 accept 없는 rewind는 blocked다.
  humanEdit(env, "a.md", "a by a person");
  must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
      accept: false,
    }),
  );
  assertEquals(revertRow(env, RVT(1))!.outcome, "blocked");
  assertEquals(names(env), []);

  const other = await scenario();
  must(
    await doRewind(other.env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "summarize",
      summary_call: MCL(1),
    }),
  );
  assertEquals(names(other.env).includes("cancelWaiting"), false);
  assertEquals(names(other.env).includes("resetReadState"), false);

  const undone = await scenario();
  must(await doUndo(undone.env, { id: RVT(1), tool_call: TCL(1) }));
  assertEquals(names(undone.env), []);
});

Deno.test("lophn-agent/revert#R15 [agent-RW3d]: if the waiting questions cannot be cancelled the whole rewind is rolled back", async () => {
  const { env } = await scenario();
  env.effects.cancelFails = true;
  const result = await doRewind(env, {
    id: RVT(1),
    checkpoint: MSG(1),
    choice: "restore_all",
  });
  assertEquals(result.ok, false);
  assertEquals(revertRow(env, RVT(1)), undefined);
  assertEquals(env.world.events("RevertApplied"), []);
  assertEquals(
    Number(
      env.world.query(
        "select count(*) as n from rewind_files where reverted_by is not null",
      )[0]!["n"],
    ),
    0,
  );
  // 되돌려지지 않았으니 파일도 그대로다.
  assertEquals(fileText(env, "a.md"), "a1");
});

Deno.test("lophn-agent/revert#R15 [agent-RW3d]: Summarize from here changes no document, no app and no message, and has no redo", async () => {
  const { env, seq } = await scenario();
  const header = must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "summarize",
      summary_call: MCL(1),
    }),
  );
  assertEquals(header.outcome, "applied");
  assertEquals(header.redo, "none");
  assertEquals(fileText(env, "a.md"), "a1");
  assertEquals(
    env.world.query("select reverted_by from rewind_files")[0]!["reverted_by"],
    null,
  );
  const row = revertRow(env, RVT(1))!;
  assertEquals([row.choice, row.boundary_seq, row.redo], [
    "summarize",
    seq,
    "none",
  ]);
  assertEquals(
    env.world.query("select summary_call from reverts")[0]!["summary_call"],
    MCL(1),
  );
  assertEquals(
    env.world.events("RevertApplied")[0]!.payload["choice"],
    "summarize",
  );
  assertEquals(
    Number(env.world.query("select count(*) as n from messages")[0]!["n"]),
    2,
  );
  assertEquals(env.effects.calls.map((call) => call.name), ["summaryOk"]);
});

Deno.test("lophn-agent/revert#R15 [agent-RW3d]: a summary that did not fully succeed changes nothing", async () => {
  const { env } = await scenario();
  env.effects.summaryOk = false;
  const result = await doRewind(env, {
    id: RVT(1),
    checkpoint: MSG(1),
    choice: "summarize",
    summary_call: MCL(1),
  });
  assertEquals(result.ok, false);
  if (!result.ok) assertEquals(result.error.code, "invalid_input");
  assertEquals(revertRow(env, RVT(1)), undefined);
  assertEquals(env.world.events("RevertApplied"), []);
  assertEquals(env.world.events("RevertBlocked"), []);
  assertEquals(names(env), ["summaryOk"]);
});

Deno.test("lophn-agent/revert#R16 [agent-RW3d]: only restore_all and messages_only that applied offer a redo", async () => {
  for (
    const [choice, redo] of [
      ["restore_all", "available"],
      ["messages_only", "available"],
      ["summarize", "none"],
    ] as const
  ) {
    const { env } = await scenario();
    const header = must(
      await doRewind(env, {
        id: RVT(1),
        checkpoint: MSG(1),
        choice,
        summary_call: choice === "summarize" ? MCL(1) : null,
      }),
    );
    assertEquals([choice, header.redo], [choice, redo]);
  }
});
