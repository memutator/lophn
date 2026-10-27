import { assertEquals } from "@std/assert";
import { manualClock } from "../../../base/mod.ts";
import { encodeFrame } from "../../../protocol/base/mod.ts";
import type { ParentMessage } from "../../../protocol/supervision/mod.ts";
import { runOnce } from "./run.ts";
import { makeSlot, STABLE_MS } from "./slot.ts";
import type { Spawned } from "./process.ts";

// ready를 한 번 말하고 stop 신호(exit)를 기다리는 가짜 child다.
function fakeChild() {
  const ready = encodeFrame({
    kind: "json",
    channel: 0,
    payload: { type: "ready" },
  });
  let exit!: (code: number | null) => void;
  const exited = new Promise<number | null>((resolve) => exit = resolve);
  let said = false;
  const pipe = {
    bufferedBytes: 0,
    cancel() {},
  };
  const spawned: Spawned = {
    pid: 1,
    stdin: { write: () => Promise.resolve(), close: () => Promise.resolve() },
    stdout: {
      ...pipe,
      async read(buffer) {
        if (!said) {
          said = true;
          buffer.set(ready);
          return ready.length;
        }
        await exited;
        return null;
      },
    },
    stderr: { ...pipe, read: () => exited.then(() => null) },
    exited,
    terminate: () => {
      exit(null);
      return Promise.resolve(true);
    },
  };
  return { spawned, exit };
}

// 위험: ready 직후 되풀이해 죽는 child는 한도에 닿아야 하고, 오래 버틴 child의 끝은 연속 실패가 아니다.
Deno.test("ready 뒤 60초를 버틴 child가 끝나야 재기동 횟수가 0으로 돌아간다", async () => {
  for (
    const [survivedMs, failures] of [[STABLE_MS, 0], [STABLE_MS - 1, 2]]
  ) {
    const clock = manualClock(0);
    const child = fakeChild();
    const slot = makeSlot(
      {
        kind: "lophn-agent/runtime",
        entry: "/x/main.ts",
        policy: "always",
        memory_limit_bytes: 1,
      },
      {} as ParentMessage,
      {
        onMessage() {},
      },
    );
    slot.failures = 2;
    const ready = new Promise<boolean>((resolve) => slot.settle = resolve);
    const running = runOnce(slot, {
      clock,
      denoCommand: "deno",
      readyMs: 10_000,
      teardownMs: 1_000,
      writeMs: 1_000,
      spawn: () => child.spawned,
    });
    await ready;
    clock.advance(survivedMs);
    child.exit(1);
    assertEquals(await running, "ready-ended");
    assertEquals(slot.failures, failures);
  }
});
