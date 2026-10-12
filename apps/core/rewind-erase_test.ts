import { assert, assertEquals } from "@std/assert";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/protocol/platform/mod.ts";
import type {
  CommandEnvelope,
  CommandSuccess,
  Writer,
} from "../../packages/platform/ledger/mod.ts";
import { openEnv } from "../../packages/lophn-agent/revert/testing/flow.ts";
import { SES, userCtx } from "../../packages/lophn-agent/revert/testing/mod.ts";
import { withRewindFiles } from "./rewind-files.ts";

// session을 지우거나 닫으면 그 session의 저장소 디렉터리도 commit 뒤에 지운다(lophn-agent/revert R20,
// conversation#R20; agent-RW3d). 지우기에 실패해도 command의 결과는 그대로다(쓸기가 다시 쓸어낸다).

const encode = (text: string) => new TextEncoder().encode(text);

function writerAnswering(answer: Result<CommandSuccess>): Writer {
  return { command: () => Promise.resolve(answer) } as unknown as Writer;
}

const success: Result<CommandSuccess> = ok({
  result: {},
  replayed: false,
  first_seq: null,
  last_seq: null,
  wake: true,
});

function sent(command: string): CommandEnvelope {
  return {
    command,
    input: { session: SES },
    idempotency_key: `k-${command}`,
    compare: {},
    prepared: [],
  };
}

async function wrapped(answer: Result<CommandSuccess>) {
  const env = openEnv();
  await env.store.put(SES, encode("pre-image"));
  const dir = join(env.dataRoot, "rewind", SES);
  assert(existsSync(dir));
  const writer = withRewindFiles(writerAnswering(answer), {
    snapshot: (read) => ok(read(env.world.lookup)),
    rootOf: () => env.root,
    store: env.store,
    relay: () => undefined,
  });
  return { writer, dir };
}

for (const command of ["DeleteSession", "CloseSession"]) {
  Deno.test(`lophn-agent/revert#R20 [agent-RW3d]: ${command} that succeeded removes the session's rewind store`, async () => {
    const { writer, dir } = await wrapped(success);
    const result = await writer.command(
      userCtx as AuthenticatedContext,
      sent(command),
    );
    assert(result.ok);
    assert(!existsSync(dir));
  });

  Deno.test(`lophn-agent/revert#R20 [agent-RW3d]: ${command} that was refused leaves the rewind store as it is`, async () => {
    const { writer, dir } = await wrapped(
      err({
        code: "conflict",
        message: "a run of the session is not finished",
      }),
    );
    const result = await writer.command(
      userCtx as AuthenticatedContext,
      sent(command),
    );
    assertEquals(result.ok, false);
    assert(existsSync(dir));
  });
}
