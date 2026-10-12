import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import type {
  CommandEnvelope,
  CommandSuccess,
  Writer,
} from "../../packages/platform/ledger/mod.ts";
import type { AppStepResult } from "../../packages/lophn-agent/revert/mod.ts";
import {
  agentWrite,
  doRewind,
  type Env,
  fileText,
  itemsOf,
  openEnv,
  planOf,
} from "../../packages/lophn-agent/revert/testing/flow.ts";
import {
  APP,
  INV,
  MSG,
  must,
  REL,
  RVT,
  SES,
  TCL,
  userCtx,
  writeProjectFile,
} from "../../packages/lophn-agent/revert/testing/mod.ts";
import { withRewindFiles } from "./rewind-files.ts";
import {
  APP_REVERT_CONTEXT,
  APP_REVERT_PRINCIPAL,
  createAppRevert,
} from "./app-revert.ts";

// 앱 단계가 있는 rewind의 이어 실행(RunAppRevert, lophn-agent/revert R10·R11). 가짜 writer가 command를
// 가짜 ledger Tx에 실행하고, 앱 호출자는 가짜다. 사람 자격은 호출자에게 그대로 전해지고 단계 기록과
// 끝내기는 core 내부 machine 자격으로 나간다.

const TOKEN = "u".repeat(43);

function callOf(n: number, app = 1) {
  return {
    app_command: {
      app: APP(app),
      release: REL(app),
      command: "ticket.update",
      revert_command: "ticket.revert",
    },
    result: {
      content: {
        revert: {
          invocation: INV(n),
          receipt: `receipt-${n}`,
          expected_revision: String(n),
        },
      },
    },
  };
}

async function written(): Promise<Env> {
  const env = openEnv({ revisions: { [APP(1)]: "2" } });
  const { run } = env.world.addRequest(1);
  env.world.addToolCall(1, run, callOf(1));
  env.world.addToolCall(2, run, callOf(2));
  env.world.addToolCall(3, run);
  writeProjectFile(env.root, "a.md", "a0");
  must(
    await agentWrite(env, {
      tool_call: TCL(3),
      run,
      path: "a.md",
      content: "a1",
    }),
  );
  return env;
}

// 앱 write 둘과 문서 write 하나 뒤에 사람이 rewind를 접수한 자리(applying)다.
async function scenario(): Promise<Env> {
  const env = await written();
  must(
    await doRewind(env, {
      id: RVT(1),
      checkpoint: MSG(1),
      choice: "restore_all",
    }),
  );
  return env;
}

type Seen = {
  command: string;
  principal: string;
  actor: string;
  input: unknown;
};

function fakeWriter(env: Env): { writer: Writer; seen: Seen[] } {
  const seen: Seen[] = [];
  const stored = new Map<string, { input: string; value: CommandSuccess }>();
  const routes = {
    Rewind: env.commands.rewind,
    CheckpointRevert: env.commands.checkpoint,
    FinishRevert: env.commands.finish,
    AmendRevertInstall: env.commands.amend,
  } as const;
  const writer = {
    command(
      ctx: AuthenticatedContext,
      envelope: CommandEnvelope,
    ): Promise<Result<CommandSuccess>> {
      seen.push({
        command: envelope.command,
        principal: ctx.principal,
        actor: ctx.actor,
        input: envelope.input,
      });
      const key = `${ctx.principal}\n${envelope.idempotency_key}`;
      const json = JSON.stringify(envelope.input);
      const before = stored.get(key);
      if (before !== undefined) {
        return Promise.resolve(
          before.input === json
            ? ok({ ...before.value, replayed: true })
            : err({ code: "conflict", message: "same key, other request" }),
        );
      }
      const route = routes[envelope.command as keyof typeof routes];
      const done = env.world.call(
        route as never,
        ctx as never,
        envelope.input as never,
        envelope.compare,
      ) as Result<unknown>;
      if (!done.ok) return Promise.resolve(done);
      const value: CommandSuccess = {
        result: done.value,
        replayed: false,
        first_seq: null,
        last_seq: null,
        wake: true,
      };
      stored.set(key, { input: json, value });
      return Promise.resolve(ok(value));
    },
  } as unknown as Writer;
  return { writer, seen };
}

function handlerOf(
  env: Env,
  writer: Writer | undefined,
  answers: Record<string, AppStepResult | "throw"> = {},
  log: { tokens: (string | undefined)[]; calls: string[] } = {
    tokens: [],
    calls: [],
  },
) {
  const handler = createAppRevert({
    snapshot: (read) => ok(read(env.world.lookup)),
    rootOf: () => env.root,
    store: env.store,
    caller: (_ctx, credential) => (binding) => {
      log.tokens.push(credential);
      log.calls.push(binding.tool_call);
      const answer = answers[binding.tool_call];
      if (answer === "throw") return Promise.reject(new Error("lost"));
      return Promise.resolve(
        answer ?? { result: "restored", invocation: binding.invocation },
      );
    },
    writer: () => writer,
  });
  return async (
    ctx: AuthenticatedContext,
    value: unknown,
    credential: string,
  ) =>
    await handler(ctx, value, credential) as Result<{
      revert: string;
      outcome: string;
      called: string[];
    }>;
}

const asUser = userCtx as AuthenticatedContext;
const input = { revert: RVT(1), files: [] };

Deno.test("lophn-agent/revert#R10: RunAppRevert calls the person's steps in reverse, records them as the machine and restores the documents last", async () => {
  const env = await scenario();
  const { writer, seen } = fakeWriter(env);
  const log = { tokens: [] as (string | undefined)[], calls: [] as string[] };
  const done = await handlerOf(env, writer, {}, log)(asUser, input, TOKEN);
  assert(done.ok, done.ok ? undefined : JSON.stringify(done.error));
  assertEquals(done.value, {
    revert: RVT(1),
    outcome: "applied",
    called: [`${RVT(1)}:${INV(2)}`, `${RVT(1)}:${INV(1)}`],
  });
  assertEquals(log.calls, [TCL(2), TCL(1)]);
  assertEquals(log.tokens, [TOKEN, TOKEN]);
  assertEquals(fileText(env, "a.md"), "a0");
  assertEquals(seen.map((call) => [call.command, call.principal, call.actor]), [
    ["CheckpointRevert", APP_REVERT_PRINCIPAL, "machine"],
    ["CheckpointRevert", APP_REVERT_PRINCIPAL, "machine"],
    ["FinishRevert", APP_REVERT_PRINCIPAL, "machine"],
  ]);
  assertEquals(
    itemsOf(env, RVT(1)).map((item) => item.result),
    ["restored", "restored", "restored"],
  );
});

Deno.test("lophn-agent/revert#R11: a failed step leaves the earlier steps uncalled and the documents untouched", async () => {
  const env = await scenario();
  const { writer } = fakeWriter(env);
  const done = await handlerOf(env, writer, {
    [TCL(2)]: { result: "failure", invocation: null },
  })(asUser, input, TOKEN);
  assert(done.ok);
  assertEquals(done.value.outcome, "partial");
  assertEquals(done.value.called, [`${RVT(1)}:${INV(2)}`]);
  assertEquals(fileText(env, "a.md"), "a1");
  assertEquals(
    itemsOf(env, RVT(1)).map((item) => [item.result, item.reason]),
    [
      ["failure", "app_failed"],
      ["unchanged", "app_not_started"],
      ["unchanged", "app_not_settled"],
    ],
  );
});

Deno.test("lophn-agent/revert#R8: a run that stopped midway continues with the steps not yet recorded", async () => {
  const env = await scenario();
  const { writer } = fakeWriter(env);
  const lost = await handlerOf(env, writer, { [TCL(1)]: "throw" })(
    asUser,
    input,
    TOKEN,
  ).then(() => "returned", () => "stopped");
  assertEquals(lost, "stopped");
  assertEquals(fileText(env, "a.md"), "a1");
  const log = { tokens: [] as (string | undefined)[], calls: [] as string[] };
  const again = await handlerOf(env, writer, {}, log)(asUser, input, TOKEN);
  assert(again.ok);
  assertEquals(again.value.outcome, "applied");
  // 앞서 기록한 T2는 다시 부르지 않는다.
  assertEquals(log.calls, [TCL(1)]);
  assertEquals(fileText(env, "a.md"), "a0");
});

Deno.test("lophn-agent/revert#R8: a finished revert cannot be run again, and no writer means unavailable", async () => {
  const env = await scenario();
  const { writer } = fakeWriter(env);
  assert((await handlerOf(env, writer)(asUser, input, TOKEN)).ok);
  const log = { tokens: [] as (string | undefined)[], calls: [] as string[] };
  const second = await handlerOf(env, writer, {}, log)(asUser, input, TOKEN);
  assert(!second.ok);
  assertEquals(second.error.code, "conflict");
  assertEquals(log.calls, []);

  const none = await handlerOf(env, undefined)(asUser, input, TOKEN);
  assert(!none.ok);
  assertEquals(none.error.code, "unavailable");
});

Deno.test("lophn-agent/revert#R10: the internal credential is the machine's and carries only the step commands", () => {
  assertEquals(APP_REVERT_CONTEXT.actor, "machine");
  assertEquals(APP_REVERT_CONTEXT.scope.operations, [
    "CheckpointRevert",
    "FinishRevert",
  ]);
});

Deno.test("lophn-agent/revert#R10: a rewind with app steps is accepted as applying and carries only the observed files before the app steps", async () => {
  const env = await written();
  const { writer, seen } = fakeWriter(env);
  const plan = planOf(env, {
    kind: "rewind",
    checkpoint: MSG(1),
    choice: "restore_all",
  });
  const wrapped = withRewindFiles(writer, {
    snapshot: (read) => ok(read(env.world.lookup)),
    rootOf: () => env.root,
    store: env.store,
    relay: () => undefined,
  });
  const sent = await wrapped.command(asUser, {
    command: "Rewind",
    input: {
      id: RVT(1),
      session: SES,
      checkpoint: MSG(1),
      choice: "restore_all",
      accept_remaining: true,
      preview_hash: plan.preview.preview_hash,
      summary_call: null,
      files: [],
    },
    idempotency_key: "k1",
    compare: {},
    prepared: [],
  });
  assert(sent.ok, sent.ok ? undefined : JSON.stringify(sent.error));
  assertEquals((sent.value.result as { outcome: string }).outcome, "applying");
  // 관측만 싣고 복원 직전 내용은 두지 않는다.
  const files = (seen[0]!.input as {
    files: { path: string; redo_ref: string | null }[];
  }).files;
  assertEquals(files.map((file) => [file.path, file.redo_ref]), [[
    "a.md",
    null,
  ]]);
  assertEquals(seen.map((call) => call.command), ["Rewind"]);
  assertEquals(fileText(env, "a.md"), "a1");
});
