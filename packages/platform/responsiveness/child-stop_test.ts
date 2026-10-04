import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  encodeFrame,
  FrameDecoder,
  type ParentMessage,
  STREAM_CHUNK_MAX_BYTES,
} from "../../contracts/platform/mod.ts";
import type { ByteReader } from "./frames.ts";
import {
  type ChildHandlers,
  type ChildSession,
  READ_AHEAD_MAX_FRAMES,
  startChild,
} from "./child.ts";

const HELLO = {
  type: "hello" as const,
  core_epoch: "epoch-1",
  process_identity: "proc-1",
  kind: "platform/io" as const,
  task: "task-1",
  scope: { operations: ["blob.put"], targets: {} },
  credential: "credential-value-not-for-argv",
  api_port: 7431,
};
const REQUEST = {
  type: "worker_request",
  request_id: "req-1",
  op: "blob.put",
  payload: {},
};

const json = (payload: unknown) =>
  encodeFrame({ kind: "json", channel: 0, payload });
const bytes = (size: number) =>
  encodeFrame({ kind: "bytes", channel: 3, payload: new Uint8Array(size) });

// 테스트가 frame을 밀어 넣고 EOF를 직접 낸다. read는 들어올 때까지 기다린다.
function pushStdin() {
  const chunks: Uint8Array[] = [];
  let eof = false;
  let wake: (() => void) | undefined;
  const reader: ByteReader = {
    async read(buffer) {
      while (true) {
        const next = chunks.shift();
        if (next) {
          const count = Math.min(buffer.length, next.length);
          buffer.set(next.subarray(0, count));
          if (count < next.length) chunks.unshift(next.subarray(count));
          return count;
        }
        if (eof) return null;
        await new Promise<void>((resolve) => wake = resolve);
      }
    },
  };
  return {
    reader,
    push: (frame: Uint8Array) => {
      chunks.push(frame);
      wake?.();
    },
    eof: () => {
      eof = true;
      wake?.();
    },
  };
}

type Hung = "onHello" | "onFrame" | "onParent";

function hungSession(hung: Hung) {
  const stdin = pushStdin();
  const sent: string[] = [];
  const calls = { hello: 0, frame: 0, parent: 0, stop: 0 };
  let release: () => void = () => {};
  const hang = () => new Promise<void>((resolve) => release = resolve);
  const handlers: ChildHandlers = {
    onHello: () => {
      calls.hello += 1;
      return hung === "onHello" ? hang() : undefined;
    },
    onFrame: () => {
      calls.frame += 1;
      return hung === "onFrame" ? hang() : undefined;
    },
    onParent: () => {
      calls.parent += 1;
      return hung === "onParent" ? hang() : undefined;
    },
    onStop: async () => {
      calls.stop += 1;
      await session.send({ type: "stopped" });
    },
  };
  const session: ChildSession = startChild({
    stdin: stdin.reader,
    stdout: {
      write: (chunk) => {
        sent.push(new TextDecoder().decode(chunk));
        return Promise.resolve(chunk.length);
      },
    },
    stderr: { write: (chunk) => Promise.resolve(chunk.length) },
  }, handlers);
  stdin.push(json(HELLO));
  if (hung !== "onHello") {
    stdin.push(hung === "onFrame" ? bytes(4) : json(REQUEST));
  }
  // 막힌 handler 뒤에 줄 선 frame. 끝난 뒤에는 시작되면 안 된다.
  stdin.push(bytes(2));
  stdin.push(json(REQUEST));
  return { stdin, session, calls, sent, release: () => release() };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

Deno.test("platform/security#R3: 막힌 handler 중에도 EOF·stop·protocol 실패를 즉시 보고 onStop을 한 번 부른다", async () => {
  for (const hung of ["onHello", "onFrame", "onParent"] as const) {
    for (const end of ["eof", "stop", "violation"] as const) {
      const label = `${hung}/${end}`;
      const { stdin, session, calls, sent, release } = hungSession(hung);
      const running = session.run().then(() => undefined, (error) => error);
      await settle();
      assertEquals(session.credentialUsable, true, label);
      const before = { ...calls };
      if (end === "eof") stdin.eof();
      if (end === "stop") stdin.push(json({ type: "stop", grace_ms: 10 }));
      if (end === "violation") stdin.push(json({ type: "bogus" }));
      await settle();
      // 막힌 handler가 끝나기 전인데도 사용 허가는 내려갔고 cleanup은 끝났다.
      assertEquals(session.credentialUsable, false, label);
      assertEquals(calls.stop, 1, label);
      const failure = await running;
      assertEquals(failure instanceof Error, end === "violation", label);
      assertEquals(session.stopped, true, label);
      // explicit stop·EOF 모두 onStop 안에서 stopped frame은 보낼 수 있었다.
      assert(sent.some((line) => line.includes('"stopped"')), label);
      // 진 handler가 끝나도 대기 중이던 handler는 시작하지 않고 session은 되살아나지 않는다.
      release();
      await settle();
      assertEquals(calls.frame, before.frame, label);
      assertEquals(calls.parent, before.parent, label);
      assertEquals(calls.stop, 1, label);
      assertEquals(session.credentialUsable, false, label);
      const frames = sent.length;
      await assertRejects(() => session.send({ type: "ready" }));
      assertEquals(sent.length, frames, label);
    }
  }
});

Deno.test("platform/security#R3: 진 handler의 거절은 관측만 하고 결과를 바꾸지 않는다", async () => {
  const stdin = pushStdin();
  let reject: (error: Error) => void = () => {};
  const session = startChild({
    stdin: stdin.reader,
    stdout: { write: (chunk) => Promise.resolve(chunk.length) },
    stderr: { write: (chunk) => Promise.resolve(chunk.length) },
  }, {
    onHello: () => new Promise((_, no) => reject = no),
    onStop: () => {},
  });
  stdin.push(json(HELLO));
  const running = session.run();
  await settle();
  stdin.eof();
  await running;
  reject(new Error("late"));
  await settle();
  assertEquals(session.stopped, true);
  assertEquals(session.credentialUsable, false);
});

Deno.test("platform/security#R3: handler는 받은 순서대로 하나씩 돈다", async () => {
  const stdin = pushStdin();
  const order: string[] = [];
  const session = startChild({
    stdin: stdin.reader,
    stdout: { write: (chunk) => Promise.resolve(chunk.length) },
    stderr: { write: (chunk) => Promise.resolve(chunk.length) },
  }, {
    onHello: async () => {
      order.push("hello:start");
      await settle();
      order.push("hello:end");
    },
    onFrame: (frame) => {
      order.push(`frame:${frame.channel}`);
    },
    onParent: (message: ParentMessage) => {
      order.push(`parent:${message.type}`);
    },
    onStop: () => {
      order.push("stop");
    },
  });
  for (const frame of [json(HELLO), bytes(1), json(REQUEST)]) stdin.push(frame);
  const running = session.run();
  await new Promise((resolve) => setTimeout(resolve, 30));
  stdin.eof();
  await running;
  assertEquals(order, [
    "hello:start",
    "hello:end",
    "frame:3",
    "parent:worker_request",
    "stop",
  ]);
});

Deno.test("platform/security#R3: 미리 읽은 frame 수가 상한을 넘으면 fail-closed한다", async () => {
  const { stdin, session, calls } = hungSession("onFrame");
  const running = session.run();
  running.catch(() => {});
  await settle();
  for (let i = 0; i < READ_AHEAD_MAX_FRAMES; i++) stdin.push(bytes(1));
  await assertRejects(() => running, Error, "read-ahead");
  assertEquals(session.credentialUsable, false);
  assertEquals(calls.stop, 1);
  assertEquals(session.readAhead.pendingFrames, 0);
});

Deno.test("platform/security#R3: 미리 읽은 byte 합이 상한을 넘으면 fail-closed하되 최대 frame 하나는 받는다", async () => {
  const { stdin, session, calls } = hungSession("onFrame");
  const running = session.run();
  running.catch(() => {});
  await settle();
  // 처리 중 frame(4 bytes) 뒤에 대기 2개가 있다. 최대 frame 하나는 함께 들어간다.
  stdin.push(bytes(STREAM_CHUNK_MAX_BYTES));
  await settle();
  assertEquals(session.stopped, false);
  assertEquals(session.readAhead.activeFrames, 1);
  assertEquals(session.readAhead.pendingFrames, 3);
  assert(session.readAhead.pendingBytes > STREAM_CHUNK_MAX_BYTES);
  stdin.push(bytes(STREAM_CHUNK_MAX_BYTES));
  await assertRejects(() => running, Error, "read-ahead");
  assertEquals(calls.stop, 1);
  assertEquals(session.credentialUsable, false);
});

Deno.test("platform/security#R3: 실제 Deno pipe EOF는 막힌 onHello 중에도 child를 끝낸다", async () => {
  const entry = new URL("./testdata/child.ts", import.meta.url).pathname;
  const testdata = new URL("./testdata/", import.meta.url).pathname;
  const child = new Deno.Command(Deno.execPath(), {
    args: [
      "run",
      "--no-prompt",
      `--allow-read=${testdata}`,
      "--allow-env=LOPHN_FIXTURE_MODE",
      entry,
    ],
    env: { LOPHN_FIXTURE_MODE: "hang-hello" },
    clearEnv: true,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(json(HELLO));
  await new Promise((resolve) => setTimeout(resolve, 300));
  await writer.close();
  const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
  const [status, stdout, stderr] = await Promise.all([
    child.status,
    new Response(child.stdout).arrayBuffer(),
    new Response(child.stderr).text(),
  ]);
  clearTimeout(timer);
  assertEquals(status.code, 0);
  assert(stderr.includes("stop credential=false"), stderr);
  assert(!stderr.includes("credential-value-not-for-argv"));
  // 이 mode는 stdout에 아무 frame도 쓰지 않는다(protocol 위반 바이트도 없다).
  assertEquals(new FrameDecoder().push(new Uint8Array(stdout)).length, 0);
});
