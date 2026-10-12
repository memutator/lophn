import { assert, assertEquals, assertRejects } from "@std/assert";
import { encodeFrame, type Frame } from "../../../protocol/base/mod.ts";
import { type ByteReader, type ByteWriter, readFrames } from "./frames.ts";
import { type ChildStreams, startChild } from "./child.ts";

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

// 미리 준 frame들을 순서대로 내주고 끝나면 EOF(null)로 막는다.
function queuedStdin(frames: Uint8Array[]): ByteReader {
  const queue = [...frames];
  let closed = false;
  return {
    read: (buffer) => {
      const next = queue.shift();
      if (next) {
        buffer.set(next.subarray(0, buffer.length));
        return Promise.resolve(Math.min(buffer.length, next.length));
      }
      closed = true;
      return Promise.resolve(closed ? null : 0);
    },
  };
}

function recordingStdout(): { writer: ByteWriter; lines: string[] } {
  const lines: string[] = [];
  return {
    lines,
    writer: {
      write: (bytes) => {
        lines.push(new TextDecoder().decode(bytes));
        return Promise.resolve(bytes.length);
      },
    },
  };
}

function streams(stdin: ByteReader): ChildStreams {
  const out = recordingStdout();
  return {
    stdin,
    stdout: out.writer,
    stderr: { write: () => Promise.resolve(0) },
  };
}

Deno.test("platform/security#R1: hello 전 byte chunk frame은 protocol 위반으로 거절한다", async () => {
  const frames = [
    encodeFrame({ kind: "bytes", channel: 3, payload: new Uint8Array([1]) }),
  ];
  const seenFrames: Frame[] = [];
  const session = startChild(streams(queuedStdin(frames)), {
    onHello: () => {},
    onStop: () => {},
    onFrame: (frame) => {
      seenFrames.push(frame);
    },
  });
  await assertRejects(() => session.run(), Error, "before hello");
  assertEquals(
    seenFrames.length,
    0,
    "hello 전 bytes가 onFrame에 넘어가면 안 된다",
  );
});

Deno.test("platform/security#R1: 두 번째 hello와 hello 전 worker_request는 거절한다", async () => {
  const early = startChild(
    streams(
      queuedStdin([
        encodeFrame({
          kind: "json",
          channel: 0,
          payload: {
            type: "worker_request",
            request_id: "req-1",
            op: "blob.put",
            payload: {},
          },
        }),
      ]),
    ),
    { onHello: () => {}, onStop: () => {} },
  );
  await assertRejects(() => early.run(), Error, "before hello");

  const twice = startChild(
    streams(
      queuedStdin([
        encodeFrame({ kind: "json", channel: 0, payload: HELLO }),
        encodeFrame({ kind: "json", channel: 0, payload: HELLO }),
      ]),
    ),
    { onHello: () => {}, onStop: () => {} },
  );
  await assertRejects(() => twice.run(), Error, "already received");
});

Deno.test("platform/security#R1: hello 전 send/sendBytes는 거절한다", async () => {
  const session = startChild(streams(queuedStdin([])), {
    onHello: () => {},
    onStop: () => {},
  });
  await assertRejects(() => session.send({ type: "ready" }), Error, "hello");
  await assertRejects(
    () => session.sendBytes(1, new Uint8Array([1])),
    Error,
    "hello",
  );
});

Deno.test("platform/security#R1: explicit stop은 cleanup을 정확히 한 번 부르고 stopped frame을 보낼 수 있다", async () => {
  let stopCalls = 0;
  const out = recordingStdout();
  const session = startChild(
    {
      stdin: queuedStdin([
        encodeFrame({ kind: "json", channel: 0, payload: HELLO }),
        encodeFrame({
          kind: "json",
          channel: 0,
          payload: { type: "stop", grace_ms: 10 },
        }),
      ]),
      stdout: out.writer,
      stderr: { write: () => Promise.resolve(0) },
    },
    {
      onHello: () => {},
      onStop: async () => {
        stopCalls += 1;
        await session.send({ type: "stopped" });
      },
    },
  );
  await session.run();
  assertEquals(stopCalls, 1);
  assertEquals(session.stopped, true);
  assertEquals(session.credentialUsable, false);
  assert(out.lines.some((line) => line.includes("stopped")));
  await assertRejects(() => session.send({ type: "stopped" }));
});

Deno.test("platform/security#R3: 부모 EOF는 즉시 credential을 막고 cleanup을 정확히 한 번 부른다", async () => {
  let stopCalls = 0;
  let credentialAtCleanup: boolean | undefined;
  const session = startChild(
    streams(
      queuedStdin([encodeFrame({ kind: "json", channel: 0, payload: HELLO })]),
    ),
    {
      onHello: () => {},
      onStop: () => {
        stopCalls += 1;
        credentialAtCleanup = session.credentialUsable;
      },
    },
  );
  await session.run();
  assertEquals(stopCalls, 1);
  assertEquals(credentialAtCleanup, false);
  assertEquals(session.stopped, true);
  assertEquals(session.credentialUsable, false);
  await assertRejects(() => session.send({ type: "ready" }));
});

Deno.test("platform/security#R1: protocol 위반도 cleanup을 정확히 한 번 부른다", async () => {
  let stopCalls = 0;
  const session = startChild(
    streams(
      queuedStdin([
        encodeFrame({ kind: "json", channel: 0, payload: HELLO }),
        encodeFrame({ kind: "json", channel: 0, payload: { type: "bogus" } }),
      ]),
    ),
    {
      onHello: () => {},
      onStop: () => {
        stopCalls += 1;
      },
    },
  );
  await assertRejects(() => session.run());
  assertEquals(stopCalls, 1);
  assertEquals(session.stopped, true);
});

Deno.test("platform/security#R1: byte chunk frame은 hello 뒤에는 그대로 entry에 넘어간다", async () => {
  const frames: Frame[] = [];
  const session = startChild(
    streams(
      queuedStdin([
        encodeFrame({ kind: "json", channel: 0, payload: HELLO }),
        encodeFrame({
          kind: "bytes",
          channel: 3,
          payload: new Uint8Array([1, 2]),
        }),
      ]),
    ),
    {
      onHello: () => {},
      onStop: () => {},
      onFrame: (frame) => {
        frames.push(frame);
      },
    },
  );
  await session.run();
  assertEquals(frames.length, 1);
  assertEquals(frames[0].kind, "bytes");
});

// readFrames 자체가 child.ts 밖에서도 쓰이는지 확인하는 sanity: import가 안 죽는지만 본다.
Deno.test("platform/security#R1: readFrames는 frame이 아닌 바이트를 protocol 위반으로 던진다", async () => {
  const reader: ByteReader = {
    read: (() => {
      let done = false;
      return (buffer: Uint8Array) => {
        if (done) return Promise.resolve(null);
        done = true;
        const bytes = new TextEncoder().encode("not a frame");
        buffer.set(bytes);
        return Promise.resolve(bytes.length);
      };
    })(),
  };
  const frames = readFrames(reader);
  await assertRejects(() => frames.next());
});
