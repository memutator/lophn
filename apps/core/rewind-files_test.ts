import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import type {
  CommandEnvelope,
  CommandSuccess,
  Writer,
} from "../../packages/platform/ledger/mod.ts";
import {
  agentWrite,
  type Env,
  fileText,
  humanEdit,
  itemsOf,
  openEnv,
  planOf,
} from "../../packages/lophn-agent/revert/testing/flow.ts";
import {
  machineCtx,
  MSG,
  must,
  RVT,
  SES,
  TCL,
  userCtx,
  writeProjectFile,
} from "../../packages/lophn-agent/revert/testing/mod.ts";
import { withRewindFiles } from "./rewind-files.ts";
import type { BodyPrepare } from "./message-body.ts";

// 되돌리기의 파일 흐름(writer queue 앞 처리기, lophn-agent/revert R8·R17). 실제 파일과 가짜 ledger Tx 위에서
// 가짜 writer가 command를 실행한다. 순서: 관측 → 판정 → 준비 → command → 설치(→ AmendRevertInstall).

type Seen = { command: string; input: unknown; actor: string };

// 가짜 writer: 같은 key의 다른 입력은 conflict, 같은 입력은 저장된 결과(replayed)다.
function fakeWriter(
  env: Env,
  hooks: { afterCommand?: (command: string) => void } = {},
): { writer: Writer; seen: Seen[] } {
  const seen: Seen[] = [];
  const stored = new Map<string, { input: string; value: CommandSuccess }>();
  const routes = {
    Rewind: env.commands.rewind,
    UndoEdit: env.commands.undo,
    Redo: env.commands.redo,
    AmendRevertInstall: env.commands.amend,
  } as const;
  const writer = {
    command(
      ctx: AuthenticatedContext,
      envelope: CommandEnvelope,
    ): Promise<Result<CommandSuccess>> {
      seen.push({
        command: envelope.command,
        input: envelope.input,
        actor: ctx.actor,
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
      hooks.afterCommand?.(envelope.command);
      return Promise.resolve(ok(value));
    },
  } as unknown as Writer;
  return { writer, seen };
}

function wrap(env: Env, writer: Writer, prepared: string[] = []): Writer {
  const relay = {
    live: () => true,
    prepare: () => {
      throw new Error("a live preparation is not prepared again");
    },
  } as unknown as BodyPrepare;
  return withRewindFiles(writer, {
    snapshot: (read) => ok(read(env.world.lookup)),
    rootOf: () => env.root,
    store: env.store,
    relay: () => {
      prepared.push("relay");
      return relay;
    },
  });
}

async function scenario() {
  const env = openEnv();
  const { run } = env.world.addRequest(1);
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
  return env;
}

function rewindEnvelope(
  env: Env,
  key = "k1",
  over: Record<string, unknown> = {},
): CommandEnvelope {
  const plan = planOf(env, {
    kind: "rewind",
    checkpoint: MSG(1),
    choice: "restore_all",
  });
  return {
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
      ...over,
    },
    idempotency_key: key,
    compare: {},
    prepared: [],
  };
}

const asUser = userCtx as AuthenticatedContext;

Deno.test("lophn-agent/revert#R17: the wrapper observes, prepares, runs the command with the prepared files, then installs", async () => {
  const env = await scenario();
  humanEdit(env, "b.md", "b by a person");
  const { writer, seen } = fakeWriter(env);
  const sent = await wrap(env, writer).command(asUser, rewindEnvelope(env));
  assert(sent.ok);
  assertEquals(fileText(env, "a.md"), "a0");
  assertEquals(fileText(env, "b.md"), "b by a person");
  const files = (seen[0]!.input as { files: { path: string }[] }).files;
  assertEquals(files.map((file) => file.path).sort(), ["a.md", "b.md"]);
  assertEquals((sent.value.result as { outcome: string }).outcome, "applied");
  assertEquals(seen.length, 1);
});

Deno.test("lophn-agent/revert#R17: a file changed after the command is not overwritten and the machine amends its item", async () => {
  const env = await scenario();
  const { writer, seen } = fakeWriter(env, {
    afterCommand: (command) => {
      if (command === "Rewind") humanEdit(env, "a.md", "a just now");
    },
  });
  const sent = await wrap(env, writer).command(asUser, rewindEnvelope(env));
  assert(sent.ok);
  assertEquals(fileText(env, "a.md"), "a just now");
  assertEquals(fileText(env, "b.md"), "b0");
  assertEquals(seen.map((call) => [call.command, call.actor]), [
    ["Rewind", "user"],
    ["AmendRevertInstall", "machine"],
  ]);
  assertEquals(
    itemsOf(env, RVT(1)).map((item) => [item.target, item.result]),
    [["a.md", "skipped"], ["b.md", "restored"]],
  );
});

Deno.test("lophn-agent/revert#R8: resending the same request installs once and sends the same prepared input", async () => {
  const env = await scenario();
  const { writer, seen } = fakeWriter(env);
  const wrapped = wrap(env, writer);
  const first = await wrapped.command(asUser, rewindEnvelope(env));
  assert(first.ok);
  humanEdit(env, "a.md", "a edited after the rewind");
  const again = await wrapped.command(asUser, rewindEnvelope(env, "k1"));
  assert(again.ok);
  assertEquals(again.value.replayed, true);
  assertEquals(seen[1]!.input, seen[0]!.input);
  assertEquals(fileText(env, "a.md"), "a edited after the rewind");
});

Deno.test("lophn-agent/revert#R19: Undo prepares the fact message body, restores the file and records the fact", async () => {
  const env = await scenario();
  const prepared: string[] = [];
  const { writer } = fakeWriter(env);
  const plan = planOf(env, { kind: "undo", tool_call: TCL(2) });
  const sent = await wrap(env, writer, prepared).command(asUser, {
    command: "UndoEdit",
    input: {
      id: RVT(1),
      session: SES,
      tool_call: TCL(2),
      preview_hash: plan.preview.preview_hash,
      files: [],
    },
    idempotency_key: "u1",
    compare: {},
    prepared: [],
  });
  assert(sent.ok);
  assertEquals(fileText(env, "b.md"), "b0");
  assertEquals(env.facts, ["Undid edit to b.md"]);
  assertEquals(prepared, ["relay"]);
});

Deno.test("lophn-agent/revert#R16: Redo reads the restored files, runs the command and rewrites the ones still as restored", async () => {
  const env = await scenario();
  const { writer } = fakeWriter(env);
  const wrapped = wrap(env, writer);
  assert((await wrapped.command(asUser, rewindEnvelope(env))).ok);
  humanEdit(env, "b.md", "b by a person after");
  const head = env.world.query("select result_seq from reverts where id = ?", [
    RVT(1),
  ])[0]!;
  const sent = await wrapped.command(asUser, {
    command: "Redo",
    input: {
      revert: RVT(1),
      result_seq: String(head["result_seq"]),
      files: [],
    },
    idempotency_key: "r1",
    compare: { redo: "available" },
    prepared: [],
  });
  assert(sent.ok);
  assertEquals(fileText(env, "a.md"), "a1");
  assertEquals(fileText(env, "b.md"), "b by a person after");
});

Deno.test("lophn-agent/revert#R2: a request that is not a person's passes through unchanged", async () => {
  const env = await scenario();
  const { writer, seen } = fakeWriter(env);
  const sent = await wrap(env, writer).command(
    machineCtx as AuthenticatedContext,
    rewindEnvelope(env),
  );
  assert(!sent.ok);
  assertEquals((seen[0]!.input as { files: unknown[] }).files, []);
  assertEquals(fileText(env, "a.md"), "a1");
});
