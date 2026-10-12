import { assertEquals } from "@std/assert";
import {
  agentWrite,
  doRewind,
  type Env,
  fileText,
  itemsOf,
  openEnv,
  revertRow,
  runApps,
} from "./testing/flow.ts";
import {
  APP,
  failed,
  INV,
  machineCtx,
  MSG,
  must,
  REL,
  RVT,
  SES,
  TCL,
  userCtx,
  writeProjectFile,
} from "./testing/mod.ts";

// 앱 단계가 있는 rewind(agent-RW3c). 가짜 앱 caller(app-steps의 port)와 가짜 ledger Tx, 임시 project 폴더를
// 쓴다. Rewind는 applying을 접수하고, runApps가 CheckpointRevert와 FinishRevert로 끝낸다.

const key = (n: number) => `${RVT(1)}:${INV(n)}`;

function appCall(n: number, app = 1, revertCommand = "ticket.revert") {
  return {
    app_command: {
      app: APP(app),
      release: REL(app),
      command: "ticket.update",
      ...(revertCommand === "" ? {} : { revert_command: revertCommand }),
    },
    result: {
      content: JSON.stringify({
        revert: {
          invocation: INV(n),
          receipt: `receipt-${n}`,
          expected_revision: String(n),
        },
      }),
    },
  };
}

// M1 아래: 앱 write T1, T2(앱 1), 문서 write T3(a.md: a0 → a1). 앱 1의 가장 나중 write T2의 receipt 기준
// revision은 "2"다.
async function scenario(
  options: {
    revisions?: Record<string, string | null>;
    extra?: (env: Env, run: string) => void;
  } = {},
) {
  const env = openEnv({ revisions: options.revisions ?? { [APP(1)]: "2" } });
  const { run, seq } = env.world.addRequest(1);
  env.world.addToolCall(1, run, appCall(1));
  env.world.addToolCall(2, run, appCall(2));
  env.world.addToolCall(3, run);
  options.extra?.(env, run);
  writeProjectFile(env.root, "a.md", "a0");
  must(
    await agentWrite(env, {
      tool_call: TCL(3),
      run,
      path: "a.md",
      content: "a1",
    }),
  );
  return { env, run, seq };
}

Deno.test("lophn-agent/revert#R10 [agent-RW3c]: a rewind with app writes is accepted as applying and finished after the app steps, apps before documents", async () => {
  const { env, seq } = await scenario();
  const header = must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
    }),
  );
  assertEquals(header.outcome, "applying");
  assertEquals(header.result_seq, null);
  assertEquals(header.redo, "none");
  // 접수만 했다. 문서는 아직 그대로이고 단계 계획이 실행 순서로 저장됐다.
  assertEquals(fileText(env, "a.md"), "a1");
  assertEquals(itemsOf(env, RVT(1)), [
    {
      ordinal: 0,
      class: "app",
      target: TCL(2),
      plan: "restore",
      result: "unchanged",
      reason: null,
    },
    {
      ordinal: 1,
      class: "app",
      target: TCL(1),
      plan: "restore",
      result: "unchanged",
      reason: null,
    },
    {
      ordinal: 2,
      class: "file",
      target: "a.md",
      plan: "restore",
      result: "unchanged",
      reason: null,
    },
  ]);
  const [started] = env.world.events("RevertStarted");
  assertEquals(started!.subject, RVT(1));
  assertEquals(started!.payload["steps"], [key(2), key(1)]);
  assertEquals(started!.payload["kind"], "rewind");
  assertEquals(started!.payload["choice"], "restore_all");
  assertEquals(env.world.events("RevertApplied"), []);

  const { calls, finished } = await runApps(env, RVT(1));
  // 원래 호출 역순으로 한 번씩 부른다.
  assertEquals(calls, [TCL(2), TCL(1)]);
  const done = must(finished!);
  assertEquals(done.outcome, "applied");
  assertEquals(done.redo, "none");
  assertEquals(fileText(env, "a.md"), "a0");
  assertEquals(itemsOf(env, RVT(1)).map((item) => item.result), [
    "restored",
    "restored",
    "restored",
  ]);
  const [applied] = env.world.events("RevertApplied");
  assertEquals(applied!.payload, {
    session: SES,
    kind: "rewind",
    choice: "restore_all",
    partial: false,
    results: {
      restored: 3,
      skipped: 0,
      remained: 0,
      failure: 0,
      uncertain: 0,
      unchanged: 0,
    },
    boundary_seq: seq,
    redo: "none",
  });
  assertEquals(revertRow(env, RVT(1))!.result_seq, applied!.seq);
  // 단계 기록에는 앱 revert command 호출이 남긴 invocation이 들어간다.
  const recorded = env.world.query(
    "select app_revert from revert_items where class = 'app' order by ordinal",
  ).map((row) => JSON.parse(String(row["app_revert"])).revert_invocation);
  assertEquals(recorded, [INV(2), INV(1)]);
});

Deno.test("lophn-agent/revert#R11 [agent-RW3c]: a failure after the first app step is partial, keeping what was restored and leaving the documents", async () => {
  const { env } = await scenario();
  must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
    }),
  );
  const { calls, finished } = await runApps(env, RVT(1), {
    [TCL(1)]: "failure",
  });
  assertEquals(calls, [TCL(2), TCL(1)]);
  const done = must(finished!);
  assertEquals(done.outcome, "partial");
  assertEquals(done.redo, "none");
  // 결과가 restored가 아니면 이유가 있다: 실패한 단계, 시작하지 않은 문서 파일.
  assertEquals(
    itemsOf(env, RVT(1)).map((item) => [item.target, item.result, item.reason]),
    [
      [TCL(2), "restored", null],
      [TCL(1), "failure", "app_failed"],
      ["a.md", "unchanged", "app_not_settled"],
    ],
  );
  assertEquals(fileText(env, "a.md"), "a1");
  assertEquals(
    env.world.query("select reverted_by from rewind_files")[0]!["reverted_by"],
    null,
  );
  assertEquals(env.world.events("RevertApplied"), []);
  const [finishedEvent] = env.world.events("RevertFinished");
  assertEquals(finishedEvent!.payload, {
    session: SES,
    outcome: "partial",
    results: {
      restored: 1,
      skipped: 0,
      remained: 0,
      failure: 1,
      uncertain: 0,
      unchanged: 1,
    },
  });
});

Deno.test("lophn-agent/revert#R11 [agent-RW3c]: a lost response is uncertain, the later steps and the documents stay unchanged", async () => {
  const { env } = await scenario();
  must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
    }),
  );
  const { calls, finished } = await runApps(env, RVT(1), {
    [TCL(2)]: "uncertain",
  });
  assertEquals(calls, [TCL(2)]);
  assertEquals(must(finished!).outcome, "uncertain");
  assertEquals(
    itemsOf(env, RVT(1)).map((item) => [item.target, item.result, item.reason]),
    [
      [TCL(2), "uncertain", "app_uncertain"],
      [TCL(1), "unchanged", "app_not_started"],
      ["a.md", "unchanged", "app_not_settled"],
    ],
  );
  assertEquals(fileText(env, "a.md"), "a1");
  assertEquals(
    env.world.events("RevertFinished")[0]!.payload["outcome"],
    "uncertain",
  );
});

Deno.test("lophn-agent/revert#R18 [agent-RW3c]: an app write without a revert command is listed as remaining and needs the person's acceptance", async () => {
  const build = (env: Env, run: string) => {
    env.world.addToolCall(4, run, appCall(4, 1, ""));
  };
  const blockedWorld = await scenario({ extra: build });
  const blocked = must(
    await doRewind(blockedWorld.env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
      accept: false,
    }),
  );
  assertEquals(blocked.outcome, "blocked");
  assertEquals(fileText(blockedWorld.env, "a.md"), "a1");
  assertEquals(blockedWorld.env.world.events("RevertBlocked").length, 1);
  assertEquals(blockedWorld.env.world.events("RevertStarted"), []);
  assertEquals(itemsOf(blockedWorld.env, RVT(1)), []);

  const accepted = await scenario({ extra: build });
  const header = must(
    await doRewind(accepted.env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
      accept: true,
    }),
  );
  assertEquals(header.outcome, "applying");
  const remained = itemsOf(accepted.env, RVT(1)).filter((item) =>
    item.plan === "remain"
  );
  assertEquals(remained, [{
    ordinal: remained[0]!.ordinal,
    class: "app",
    target: TCL(4),
    plan: "remain",
    result: "remained",
    reason: "no_revert_command",
  }]);
  const { calls } = await runApps(accepted.env, RVT(1));
  assertEquals(calls, [TCL(2), TCL(1)]);
});

Deno.test("lophn-agent/revert#R4 [agent-RW3c]: a changed app revision skips that app's steps while another app and the documents are restored", async () => {
  const { env } = await scenario({
    revisions: { [APP(1)]: "9", [APP(2)]: "4" },
    extra: (world, run) => world.world.addToolCall(4, run, appCall(4, 2)),
  });
  const header = must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
    }),
  );
  assertEquals(header.outcome, "applying");
  assertEquals(
    itemsOf(env, RVT(1)).map((item) => [item.target, item.plan, item.reason]),
    [
      [TCL(4), "restore", null],
      [TCL(2), "skip", "app_revision_changed"],
      [TCL(1), "skip", "app_revision_changed"],
      ["a.md", "restore", null],
    ],
  );
  const { calls, finished } = await runApps(env, RVT(1));
  assertEquals(calls, [TCL(4)]);
  assertEquals(must(finished!).outcome, "applied");
  assertEquals(itemsOf(env, RVT(1)).map((item) => item.result), [
    "restored",
    "skipped",
    "skipped",
    "restored",
  ]);
  assertEquals(fileText(env, "a.md"), "a0");
});

Deno.test("lophn-agent/revert#R8 [agent-RW3c]: a step is recorded once, a different result for it is refused, and only the machine records", async () => {
  const { env } = await scenario();
  must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
    }),
  );
  const step = {
    revert: RVT(1),
    step_key: key(2),
    invocation: INV(20),
    result: "restored" as const,
  };
  assertEquals(
    must(env.world.call(env.commands.checkpoint, machineCtx, step)).recorded,
    true,
  );
  assertEquals(
    must(env.world.call(env.commands.checkpoint, machineCtx, step)).recorded,
    false,
  );
  failed(
    env.world.call(env.commands.checkpoint, machineCtx, {
      ...step,
      result: "failure",
    }),
    "conflict",
  );
  failed(
    env.world.call(env.commands.checkpoint, machineCtx, {
      ...step,
      step_key: key(99),
    }),
    "conflict",
  );
  failed(env.world.call(env.commands.checkpoint, userCtx, step), "forbidden");
});

Deno.test("lophn-agent/revert#R11 [agent-RW3c]: a revert cannot be finished before every step is recorded, nor twice", async () => {
  const { env } = await scenario();
  must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
    }),
  );
  const early = {
    revert: RVT(1),
    step_keys: [key(1), key(2)],
    files: [],
  };
  failed(env.world.call(env.commands.finish, machineCtx, early), "conflict");
  failed(env.world.call(env.commands.finish, userCtx, early), "forbidden");
  const { finished } = await runApps(env, RVT(1));
  assertEquals(must(finished!).outcome, "applied");
  // 끝난 revert는 다시 끝낼 수 없다.
  failed(env.world.call(env.commands.finish, machineCtx, early), "conflict");
});
