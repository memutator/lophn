import { assert, assertEquals, assertRejects } from "@std/assert";
import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import {
  fromReadable,
  PIPE_MAX_BYTES,
  PIPE_PAUSE_BYTES,
  PipeFault,
} from "./pipe.ts";
import { spawnProcess } from "./process.ts";

// pause를 무시하고 data를 계속 내는 stream도 흉내 낼 수 있게 직접 만든다.
class FakeStream extends EventEmitter {
  paused = false;
  destroyed = false;
  pause() {
    this.paused = true;
    return this;
  }
  resume() {
    this.paused = false;
    return this;
  }
  isPaused() {
    return this.paused;
  }
  destroy() {
    this.destroyed = true;
    return this;
  }
}

function fake() {
  const stream = new FakeStream();
  return { stream, pipe: fromReadable(stream as unknown as Readable) };
}

const chunk = (size: number) => new Uint8Array(size);

Deno.test("platform/security#R3: 쌓인 stdout이 멈춤 선을 넘으면 pause하고 읽으면 다시 흐른다", async () => {
  const { stream, pipe } = fake();
  stream.emit("data", chunk(PIPE_PAUSE_BYTES));
  assertEquals(stream.paused, true);
  const buffer = new Uint8Array(PIPE_PAUSE_BYTES);
  assertEquals(await pipe.read(buffer), PIPE_PAUSE_BYTES);
  assertEquals(stream.paused, false);
  assertEquals(pipe.bufferedBytes, 0);
});

Deno.test("platform/security#R3: pause 뒤에도 상한을 넘으면 PipeFault로 끊고 stream을 닫는다", async () => {
  const { stream, pipe } = fake();
  for (let sent = 0; sent <= PIPE_MAX_BYTES; sent += 64 * 1024) {
    stream.emit("data", chunk(64 * 1024));
  }
  assertEquals(stream.destroyed, true);
  assertEquals(pipe.bufferedBytes, 0);
  await assertRejects(() => pipe.read(new Uint8Array(8)), PipeFault);
});

Deno.test("platform/security#R3: stdio 오류와 end 없는 close는 EOF로 숨기지 않는다", async () => {
  const failed = fake();
  const waiting = failed.pipe.read(new Uint8Array(8));
  failed.stream.emit("error", new Error("EIO"));
  await assertRejects(() => waiting, PipeFault);

  const cut = fake();
  cut.stream.emit("data", chunk(4));
  cut.stream.emit("close");
  await assertRejects(() => cut.pipe.read(new Uint8Array(8)), PipeFault);

  const clean = fake();
  clean.stream.emit("data", chunk(4));
  clean.stream.emit("end");
  clean.stream.emit("close");
  assertEquals(await clean.pipe.read(new Uint8Array(8)), 4);
  assertEquals(await clean.pipe.read(new Uint8Array(8)), null);
});

Deno.test("platform/security#R3: cancel은 기다리던 read를 null로 깨우고 stream을 닫는다", async () => {
  const { stream, pipe } = fake();
  const waiting = pipe.read(new Uint8Array(8));
  pipe.cancel();
  assertEquals(await waiting, null);
  assertEquals(stream.destroyed, true);
  stream.emit("close");
  assertEquals(await pipe.read(new Uint8Array(8)), null);
});

async function readAll(pipe: { read(b: Uint8Array): Promise<number | null> }) {
  const buffer = new Uint8Array(64 * 1024);
  let total = 0;
  while (true) {
    const count = await pipe.read(buffer);
    if (count === null) return total;
    total += count;
  }
}

Deno.test("platform/security#R3: leader exit 뒤에도 이미 쓰인 stdout·stderr 꼬리를 잃지 않는다", async () => {
  const spawned = spawnProcess({
    command: Deno.execPath(),
    args: [
      "eval",
      "--no-config",
      "Deno.stdout.writeSync(new Uint8Array(300000).fill(66));" +
      "Deno.stderr.writeSync(new Uint8Array(5000).fill(67));",
    ],
    env: {},
  });
  // exit를 먼저 본 뒤에 읽기 시작한다.
  assertEquals(await spawned.exited, 0);
  const [out, err] = await Promise.all([
    readAll(spawned.stdout),
    readAll(spawned.stderr),
  ]);
  assertEquals(out, 300000);
  assertEquals(err, 5000);
  assert(await spawned.terminate());
});

Deno.test("platform/security#R3: stdout flood는 bounded하게 멈추고 group 종료 뒤 안전하게 닫힌다", async () => {
  const spawned = spawnProcess({
    command: Deno.execPath(),
    args: [
      "eval",
      "--no-config",
      "const b = new Uint8Array(65536).fill(65); while (true) Deno.stdout.writeSync(b);",
    ],
    env: {},
  });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert(spawned.stdout.bufferedBytes >= PIPE_PAUSE_BYTES);
  assert(spawned.stdout.bufferedBytes <= PIPE_MAX_BYTES);
  assert(await spawned.terminate());
  assertEquals(await spawned.exited, null);
  spawned.stdout.cancel();
  spawned.stderr.cancel();
  assertEquals(await spawned.stdout.read(new Uint8Array(8)), null);
});
