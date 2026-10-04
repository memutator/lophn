import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../base/mod.ts";
import {
  encodeFrame,
  type Frame,
  type ParentMessage,
} from "../../contracts/platform/mod.ts";
import { createSupervisor } from "./supervisor.ts";
import { startChild, type ChildStreams } from "./child.ts";
import { spawnProcess, type Spawned } from "./process.ts";

const entry = new URL("./testdata/child.ts", import.meta.url).pathname;
const clock = manualClock(Date.UTC(2026, 0, 1));

function ticking() {
  const base = manualClock(Date.now());
  const timer = setInterval(() => base.advance(20), 20);
  return {
    clock: base,
    stop: () => clearInterval(timer),
  };
}

function spec(over: Record<string, unknown> = {}) {
  return {
    kind: "platform/io",
    entry,
    allow_read: ["/opt/lophn"],
    allow_write: [] as string[],
    allow_net: [] as string[],
    allow_run: [] as string[],
    allow_env: [] as string[],
    policy: "always",
    memory_limit_bytes: 1024,
    ...over,
  };
}

function hello(): ParentMessage {
  return {
    type: "hello",
    core_epoch: "epoch-1",
    process_identity: "proc-1",
    kind: "platform/io",
    task: "task-1",
    scope: { operations: ["blob.put"], targets: {} },
    credential: "credential-value-not-for-argv",
    api_port: 7431,
  };
}

function supervisor(mode = "normal") {
  return createSupervisor({
    clock,
    denoCommand: Deno.execPath(),
    sleep: (ms) =>
      ms <= 20
        ? new Promise((resolve) => setTimeout(resolve, ms))
        : Promise.resolve(),
    readyMs: 800,
    stopMs: 800,
    env: () => ({ LOPHN_FIXTURE_MODE: mode }),
  });
}

function readable() {
  return spec({
    allow_read: [new URL("./testdata/", import.meta.url).pathname],
    allow_env: ["LOPHN_FIXTURE_MODE"],
  });
}

Deno.test("platform/security#R1: hello는 pipe frame으로 가고 argv·stderr에 credential이 없다", async () => {
  const stderr: string[] = [];
  const supervised = supervisor();
  const started = await supervised.start(readable(), hello(), {
    onMessage: () => {},
    onStderr: (line) => stderr.push(line),
  });
  assert(started.ok, JSON.stringify(supervised.observation("platform/io")));
  assertEquals(supervised.observation("platform/io").available, true);
  const leaked = stderr.join("\n");
  await supervised.stop("platform/io");
  assert(!leaked.includes("credential-value-not-for-argv"));
  assert(leaked.includes("hello seen"), JSON.stringify(leaked));
  assertEquals(supervised.observation("platform/io").available, false);
});

Deno.test("platform/security#R3: 금지 spec은 child를 띄우지 않고 거절한다", async () => {
  const supervised = supervisor();
  const started = await supervised.start(
    spec({ allow_read: ["*"] }),
    hello(),
    { onMessage: () => {} },
  );
  assert(!started.ok);
  assertEquals(started.ok ? "" : started.code, "invalid_input");
  assertEquals(supervised.observation("platform/io").reason, "not started");
});

Deno.test("platform/backup-and-migration#R17: 재기동은 진행 중이던 작업을 다시 보내지 않는다", async () => {
  const sent: string[] = [];
  const delays: number[] = [];
  const time = ticking();
  const supervised = createSupervisor({
    clock: time.clock,
    denoCommand: Deno.execPath(),
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
    readyMs: 40,
    env: () => ({}),
    spawn: (request) => {
      sent.push(request.args.join(" "));
      return closed(1);
    },
  });
  const started = await supervised.start(spec(), hello(), {
    onMessage: () => {
      throw new Error("진행 중이던 작업을 재기동에서 다시 받았다");
    },
  });
  assert(!started.ok);
  assertEquals(delays, [1000, 2000, 4000]);
  assertEquals(sent.length, 4);
  assert(sent.every((args) => !args.includes("credential")));
  assertEquals(supervised.observation("platform/io").available, false);
  assertEquals(
    supervised.observation("platform/io").reason,
    "restart limit reached",
  );
  const again = await supervised.start(spec(), hello(), {
    onMessage: () => {},
  });
  assert(!again.ok);
  assertEquals(again.ok ? "" : again.code, "unavailable");
  time.stop();
});

Deno.test("platform/security#R2: ready를 보내지 않으면 그 child만 끝내고 실패로 친다", async () => {
  const time = ticking();
  const silent = createSupervisor({
    clock: time.clock,
    denoCommand: Deno.execPath(),
    sleep: () => Promise.resolve(),
    readyMs: 80,
    stopMs: 20,
    env: () => ({ LOPHN_FIXTURE_MODE: "silent" }),
  });
  const started = await silent.start(readable(), hello(), {
    onMessage: () => {},
  });
  assert(!started.ok);
  assertEquals(silent.observation("platform/io").reason, "ready timed out");
  await silent.stopAll();
  time.stop();
});

Deno.test("platform/security#R1: frame이 아닌 stdout은 protocol 위반으로 그 child를 멈춘다", async () => {
  const junk = supervisor("junk");
  const started = await junk.start(readable(), hello(), { onMessage: () => {} });
  assert(!started.ok);
  assertEquals(junk.observation("platform/io").reason, "protocol violation");
  await junk.stopAll();
});

Deno.test("platform/security#R1: byte chunk frame은 버리지 않고 entry에 넘긴다", async () => {
  const chunks: Frame[] = [];
  const chunked = supervisor("chunk");
  const started = await chunked.start(readable(), hello(), {
    onMessage: () => {},
    onFrame: (frame) => chunks.push(frame),
  });
  assert(started.ok);
  await waitFor(() => chunks.length > 0);
  assertEquals(chunks[0].kind, "bytes");
  if (chunks[0].kind === "bytes") {
    assertEquals(chunks[0].channel, 7);
    assertEquals(new TextDecoder().decode(chunks[0].payload), "blob-bytes");
  }
  await chunked.stop("platform/io");
});

Deno.test("platform/security#R2: ready 이후 crash도 재기동은 최대 3회다", async () => {
  const delays: number[] = [];
  let spawned = 0;
  const killed: number[] = [];
  const time = ticking();
  const crashing = createSupervisor({
    clock: time.clock,
    denoCommand: Deno.execPath(),
    sleep: (ms) => {
      if (ms >= 1_000) delays.push(ms);
      return Promise.resolve();
    },
    readyMs: 40,
    stopMs: 20,
    spawn: () => {
      spawned += 1;
      return scripted(killed);
    },
  });
  const started = await crashing.start(spec(), hello(), { onMessage: () => {} });
  assert(!started.ok);
  assertEquals(spawned, 4);
  assertEquals(delays, [1000, 2000, 4000]);
  assertEquals(crashing.observation("platform/io").reason, "restart limit reached");
  assertEquals(killed.length, 0);
  time.stop();
});

Deno.test("platform/security#R3: 부모 pipe EOF면 child는 credential 사용을 멈추고 끝난다", async () => {
  const encoder = new TextEncoder();
  const stdinChunks: Uint8Array[] = [];
  let stdinClosed = false;
  const stdout = queue();
  const stderrLines: string[] = [];
  const streams: ChildStreams = {
    stdin: {
      read: async (buffer) => {
        while (stdinChunks.length === 0 && !stdinClosed) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        if (stdinChunks.length === 0) return null;
        const chunk = stdinChunks.shift()!;
        buffer.set(chunk.subarray(0, buffer.length));
        if (chunk.length > buffer.length) {
          stdinChunks.unshift(chunk.subarray(buffer.length));
        }
        return Math.min(buffer.length, chunk.length);
      },
    },
    stdout: {
      write: async (bytes) => {
        stdout.push(bytes);
        return bytes.length;
      },
    },
    stderr: {
      write: async (bytes) => {
        stderrLines.push(new TextDecoder().decode(bytes));
        return bytes.length;
      },
    },
  };
  let credential = "";
  const frames: Frame[] = [];
  const session = startChild(streams, {
    onHello: (message) => {
      credential = message.credential;
    },
    onStop: () => {},
    onFrame: (frame) => {
      frames.push(frame);
    },
  });
  const running = session.run();
  stdinChunks.push(encodeFrame({ kind: "json", channel: 0, payload: hello() }));
  stdinChunks.push(encodeFrame({
    kind: "bytes",
    channel: 3,
    payload: encoder.encode("kept"),
  }));
  await session.send({ type: "ready" });
  await waitFor(() => credential === "credential-value-not-for-argv");
  console.log("must not reach stdout");
  assert(stderrLines.join("").includes("must not reach stdout"));
  await waitFor(() => frames.length === 1);
  stdinClosed = true;
  await running;
  assert(session.stopped);
  assert(!session.credentialUsable);
  assert(!stdout.text().includes("credential-value"));
  let rejected = false;
  try {
    await session.send({ type: "ready" });
  } catch {
    rejected = true;
  }
  assert(rejected);
});

Deno.test("platform/security#R2: stop 기한이 지나면 실제 process group을 끝낸다", async () => {
  const signals: string[] = [];
  let group = 0;
  let finish: (code: number | null) => void = () => {};
  let release: (count: number | null) => void = () => {};
  const time = ticking();
  const hanging = createSupervisor({
    clock: time.clock,
    denoCommand: Deno.execPath(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    readyMs: 2_000,
    stopMs: 30,
    spawn: () => ({
      pid: 44,
      stdin: { write: () => Promise.resolve(), close: () => Promise.resolve() },
      stdout: {
        read: () =>
          new Promise((resolve) => {
            release = resolve;
          }),
      },
      stderr: { read: () => Promise.resolve(null) },
      exited: new Promise((resolve) => {
        finish = resolve;
      }),
      killGroup: (signal) => {
        signals.push(signal);
        group = -44;
        release(null);
        finish(null);
      },
    }),
  });
  const started = hanging.start(spec(), hello(), { onMessage: () => {} });
  await new Promise((resolve) => setTimeout(resolve, 30));
  await hanging.stop("platform/io");
  const result = await started;
  assert(!result.ok);
  assert(signals.includes("SIGKILL"));
  assertEquals(group, -44);
  time.stop();
});

Deno.test("platform/security#R2: process group 종료는 손자까지 끝내고 PID 파일을 쓰지 않는다", async () => {
  const root = await Deno.makeTempDir();
  const marker = `${root}/alive`;
  const supervised = createSupervisor({
    clock,
    denoCommand: "/bin/sh",
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    readyMs: 1_000,
    stopMs: 200,
    spawn: () =>
      spawnProcess({
        command: "/bin/sh",
        args: ["-c", `sleep 30 & echo $! > ${marker}; wait`],
        env: {},
      }),
  });
  const started = supervised.start(spec(), hello(), { onMessage: () => {} });
  await new Promise((resolve) => setTimeout(resolve, 200));
  await supervised.stop("platform/io");
  await started;
  const pid = Number(await Deno.readTextFile(marker));
  let alive = true;
  try {
    Deno.kill(pid, "SIGCONT");
  } catch {
    alive = false;
  }
  await Deno.remove(root, { recursive: true });
  assert(!alive);
  assertEquals(supervised.observation("platform/io").available, false);
});

Deno.test("platform/security#R3: spec이 바뀌면 그 child만 정상 정지 뒤 다시 띄운다", async () => {
  const kinds: string[] = [];
  const supervised = createSupervisor({
    clock,
    denoCommand: Deno.execPath(),
    sleep: () => Promise.resolve(),
    readyMs: 200,
    stopMs: 20,
    spawn: (request) => {
      kinds.push(request.env.KIND ?? "");
      return readyThenStop();
    },
    env: (kind) => ({ KIND: kind }),
  });
  const other = spec({ kind: "documents/worker" });
  const first = await supervised.start(spec(), hello(), { onMessage: () => {} });
  const secondHello = hello();
  if (secondHello.type !== "hello") throw new Error("hello");
  secondHello.kind = "documents/worker";
  const second = await supervised.start(other, secondHello, {
    onMessage: () => {},
  });
  assert(first.ok && second.ok);
  const updated = await supervised.updateSpec(
    spec({ allow_read: ["/opt/lophn/next"] }),
    hello(),
  );
  assert(updated.ok);
  assertEquals(supervised.observation("documents/worker").available, true);
  assertEquals(kinds.filter((kind) => kind === "platform/io").length, 2);
  assertEquals(kinds.filter((kind) => kind === "documents/worker").length, 1);
  await supervised.stopAll();
});

function closed(code: number): Spawned {
  let stop = () => {};
  return {
    pid: 1,
    stdin: { write: () => Promise.resolve(), close: () => Promise.resolve() },
    stdout: {
      read: () =>
        new Promise((resolve) => {
          stop = () => resolve(null);
        }),
    },
    stderr: { read: () => Promise.resolve(null) },
    exited: Promise.resolve(code),
    killGroup: () => stop(),
  };
}

function scripted(killed: number[]): Spawned {
  const ready = encodeFrame({
    kind: "json",
    channel: 0,
    payload: { type: "ready" },
  });
  let given = false;
  let finish: (code: number | null) => void = () => {};
  return {
    pid: 9,
    stdin: { write: () => Promise.resolve(), close: () => Promise.resolve() },
    stdout: {
      read: async (buffer) => {
        if (given) return null;
        given = true;
        buffer.set(ready);
        return ready.length;
      },
    },
    stderr: { read: () => Promise.resolve(null) },
    exited: new Promise((resolve) => {
      finish = resolve;
      queueMicrotask(() => resolve(3));
    }),
    killGroup: () => {
      killed.push(1);
      finish(null);
    },
  };
}

function readyThenStop(): Spawned {
  const ready = encodeFrame({ kind: "json", channel: 0, payload: { type: "ready" } });
  const stopped = encodeFrame({
    kind: "json",
    channel: 0,
    payload: { type: "stopped" },
  });
  const chunks = [ready];
  let sentStop = false;
  let resolveExit: (code: number | null) => void = () => {};
  return {
    pid: 5,
    stdin: {
      write: async (bytes) => {
        const text = new TextDecoder().decode(bytes);
        if (!sentStop && text.includes('"stop"')) {
          sentStop = true;
          chunks.push(stopped);
          resolveExit(0);
        }
      },
      close: () => Promise.resolve(),
    },
    stdout: {
      read: async (buffer) => {
        while (chunks.length === 0 && !sentStop) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        const next = chunks.shift();
        if (!next) return null;
        buffer.set(next);
        return next.length;
      },
    },
    stderr: { read: () => Promise.resolve(null) },
    exited: new Promise((resolve) => {
      resolveExit = resolve;
    }),
    killGroup: () => resolveExit(null),
  };
}

function queue() {
  const parts: Uint8Array[] = [];
  return {
    push: (bytes: Uint8Array) => parts.push(bytes),
    text: () => parts.map((part) => new TextDecoder().decode(part)).join(""),
  };
}

async function waitFor(ready: () => boolean) {
  for (let i = 0; i < 100 && !ready(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert(ready());
}
