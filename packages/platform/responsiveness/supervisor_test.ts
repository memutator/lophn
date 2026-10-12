import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../base/mod.ts";
import type { Frame } from "../../protocol/platform/mod.ts";
import { createSupervisor, type SupervisorOptions } from "./supervisor.ts";
import {
  type FakeOptions,
  fakeProcess,
  hello,
  spec,
  tracker,
  waitFor,
} from "./supervisor-fixture.ts";

const testdata = new URL("./testdata/", import.meta.url).pathname;

// 실제 Deno fixture child를 띄운다(실제 /usr/bin/kill adapter와 process group).
function real(mode = "normal", over: Partial<SupervisorOptions> = {}) {
  return createSupervisor({
    clock: manualClock(Date.UTC(2026, 0, 1)),
    denoCommand: Deno.execPath(),
    sleep: () => Promise.resolve(),
    readyMs: 5_000,
    stopMs: 2_000,
    env: () => ({ LOPHN_FIXTURE_MODE: mode }),
    ...over,
  });
}

function readable() {
  return spec({
    entry: `${testdata}child.ts`,
    allow_read: [testdata],
    allow_env: ["LOPHN_FIXTURE_MODE"],
  });
}

function faked(options: FakeOptions, over: Partial<SupervisorOptions> = {}) {
  const track = tracker();
  const supervised = createSupervisor({
    clock: manualClock(Date.UTC(2026, 0, 1)),
    denoCommand: "/opt/lophn/deno",
    sleep: () => Promise.resolve(),
    readyMs: 200,
    stopMs: 30,
    checkGroupKillAdapter: () => Promise.resolve(true),
    spawn: () => fakeProcess(track, options),
    ...over,
  });
  return { supervised, track };
}

Deno.test("platform/security#R1: hello는 pipe frame으로 가고 argv·stderr에 credential이 없다", async () => {
  const stderr: string[] = [];
  const supervised = real();
  const started = await supervised.start(readable(), hello(), {
    onMessage: () => {},
    onStderr: (line) => stderr.push(line),
  });
  assert(started.ok, JSON.stringify(supervised.observation("platform/io")));
  assertEquals(supervised.observation("platform/io").available, true);
  assert(await supervised.stop("platform/io"));
  const leaked = stderr.join("\n");
  assert(!leaked.includes("credential-value-not-for-argv"));
  assert(leaked.includes("hello seen"), JSON.stringify(leaked));
  assertEquals(supervised.observation("platform/io").available, false);
  // 관측에는 stderr 원문이 실리지 않는다.
  assertEquals(supervised.observation("platform/io").reason, "stopped");
});

Deno.test("platform/security#R3: 금지 spec은 child를 띄우지 않고 거절한다", async () => {
  const { supervised, track } = faked({});
  const started = await supervised.start(
    spec({ allow_read: ["*"] }),
    hello(),
    { onMessage: () => {} },
  );
  assertEquals(started.ok ? "" : started.code, "invalid_input");
  assertEquals(track.spawned, 0);
  assertEquals(supervised.observation("platform/io").reason, "not started");
});

Deno.test("platform/backup-and-migration#R17: 재기동은 진행 중이던 작업을 다시 보내지 않는다", async () => {
  const delays: number[] = [];
  const argv: string[] = [];
  const track = tracker();
  const supervised = createSupervisor({
    clock: manualClock(Date.UTC(2026, 0, 1)),
    denoCommand: "/opt/lophn/deno",
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
    readyMs: 200,
    checkGroupKillAdapter: () => Promise.resolve(true),
    spawn: (request) => {
      argv.push(request.args.join(" "));
      return fakeProcess(track, { dieAtStart: true });
    },
  });
  const started = await supervised.start(spec(), hello(), {
    onMessage: () => {
      throw new Error("진행 중이던 작업을 재기동에서 다시 받았다");
    },
  });
  assert(!started.ok);
  assertEquals(delays, [1000, 2000, 4000]);
  // 첫 기동과 재기동 3회. 네 번째 실패 뒤에는 더 띄우지 않는다.
  assertEquals(track.spawned, 4);
  assertEquals(track.maxLive, 1);
  assert(argv.every((args) => !args.includes("credential")));
  assertEquals(
    supervised.observation("platform/io").reason,
    "restart limit reached",
  );
  const again = await supervised.start(spec(), hello(), {
    onMessage: () => {},
  });
  assertEquals(again.ok ? "" : again.code, "unavailable");
  assertEquals(track.spawned, 4);
});

Deno.test("platform/security#R2: ready를 보내지 않으면 그 child만 끝내고 실패로 친다", async () => {
  const silent = real("silent", { readyMs: 300 });
  const started = await silent.start(readable(), hello(), {
    onMessage: () => {},
  });
  assert(!started.ok);
  assertEquals(silent.observation("platform/io").reason, "ready timed out");
  assert(await silent.stopAll());
});

Deno.test("platform/security#R1: frame이 아닌 stdout은 protocol 위반으로 그 child를 멈춘다", async () => {
  const junk = real("junk");
  const started = await junk.start(readable(), hello(), {
    onMessage: () => {},
  });
  assert(!started.ok);
  assertEquals(junk.observation("platform/io").reason, "protocol violation");
  assert(await junk.stopAll());
});

Deno.test("platform/security#R1: byte chunk frame은 버리지 않고 entry에 넘긴다", async () => {
  const chunks: Frame[] = [];
  const chunked = real("chunk");
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
  assert(await chunked.stop("platform/io"));
});

Deno.test("platform/security#R2: ready 직후 끝나도 ready로 세지 않고 재기동은 최대 3회다", async () => {
  const delays: number[] = [];
  const { supervised, track } = faked({ exitAfterReady: true }, {
    sleep: (ms) => {
      delays.push(ms);
      return Promise.resolve();
    },
  });
  const started = await supervised.start(spec(), hello(), {
    onMessage: () => {},
  });
  assert(!started.ok);
  assertEquals(track.spawned, 4);
  assertEquals(track.maxLive, 1);
  assertEquals(track.live, 0);
  assertEquals(delays, [1000, 2000, 4000]);
  assertEquals(
    supervised.observation("platform/io").reason,
    "restart limit reached",
  );
});

Deno.test("platform/security#R2: stop 기한이 지나면 sleep과 상관없이 group 종료를 확인한다", async () => {
  // 재기동 sleep은 영원히 끝나지 않는다. stop 기한은 그것과 무관해야 한다.
  const spawned: Array<ReturnType<typeof fakeProcess>> = [];
  const track = tracker();
  const supervised = createSupervisor({
    clock: manualClock(Date.UTC(2026, 0, 1)),
    denoCommand: "/opt/lophn/deno",
    sleep: () => new Promise(() => {}),
    readyMs: 200,
    stopMs: 30,
    checkGroupKillAdapter: () => Promise.resolve(true),
    spawn: () => {
      const process = fakeProcess(track, {
        exitOnStop: false,
        blockWrites: "stop",
      });
      spawned.push(process);
      return process;
    },
  });
  assert((await supervised.start(spec(), hello(), { onMessage: () => {} })).ok);
  const begun = performance.now();
  assert(await supervised.stop("platform/io"));
  assert(performance.now() - begun < 1_000);
  assertEquals(spawned[0].terminated() > 0, true);
  assertEquals(track.live, 0);
  assertEquals(supervised.observation("platform/io").reason, "stopped");
});

Deno.test("platform/security#R3: spec이 바뀌면 그 child만 정상 정지 뒤 다시 띄운다", async () => {
  const kinds: string[] = [];
  const track = tracker();
  const supervised = createSupervisor({
    clock: manualClock(Date.UTC(2026, 0, 1)),
    denoCommand: "/opt/lophn/deno",
    sleep: () => Promise.resolve(),
    readyMs: 200,
    stopMs: 20,
    checkGroupKillAdapter: () => Promise.resolve(true),
    spawn: (request) => {
      kinds.push(request.env.KIND ?? "");
      return fakeProcess(track);
    },
    env: (kind) => ({ KIND: kind }),
  });
  const first = await supervised.start(spec(), hello(), {
    onMessage: () => {},
  });
  const second = await supervised.start(
    spec({ kind: "documents/worker" }),
    hello("documents/worker"),
    { onMessage: () => {} },
  );
  assert(first.ok && second.ok);
  const updated = await supervised.updateSpec(
    spec({ allow_read: ["/opt/lophn/next"] }),
    hello(),
  );
  assert(updated.ok);
  assertEquals(supervised.observation("documents/worker").available, true);
  assertEquals(kinds.filter((kind) => kind === "platform/io").length, 2);
  assertEquals(kinds.filter((kind) => kind === "documents/worker").length, 1);
  assert(await supervised.stopAll());
  assertEquals(track.live, 0);
});

Deno.test("platform/security#R2: stop 뒤 영원히 끝나지 않는 재기동 sleep이 깨어나도 새로 띄우지 않는다", async () => {
  let wake: () => void = () => {};
  const { supervised, track } = faked({ dieAtStart: true }, {
    sleep: () => new Promise<void>((resolve) => wake = resolve),
  });
  const started = supervised.start(spec(), hello(), { onMessage: () => {} });
  await waitFor(() => track.spawned === 1 && track.live === 0);
  assert(await supervised.stop("platform/io"));
  assertEquals((await started).ok, false);
  wake();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assertEquals(track.spawned, 1);
  assertEquals(supervised.observation("platform/io").reason, "stopped");
});
