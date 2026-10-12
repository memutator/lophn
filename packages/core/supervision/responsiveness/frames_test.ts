import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  FrameDecoder,
  STREAM_CHUNK_MAX_BYTES,
} from "../../../protocol/base/mod.ts";
import {
  createFrameWriter,
  WRITE_BACKLOG_MAX_BYTES,
  WRITE_BACKLOG_MAX_FRAMES,
} from "./frames.ts";

Deno.test("platform/security#R1: 동시에 쓴 frame은 각각 온전하고 순서대로 나간다", async () => {
  const chunks: Uint8Array[] = [];
  const writer = createFrameWriter({
    write: (bytes: Uint8Array) => {
      // 한 번의 write는 frame의 절반만 받는다. 나머지를 다음 write로 넘긴다.
      const count = Math.max(1, Math.floor(bytes.length / 2));
      chunks.push(bytes.subarray(0, count));
      return Promise.resolve(count);
    },
  });
  await Promise.all([
    writer.writeJson({ type: "ready" }),
    writer.writeBytes(3, new Uint8Array([9, 8, 7])),
  ]);
  const decoder = new FrameDecoder();
  const frames = chunks.flatMap((chunk) => [...decoder.push(chunk)]);
  assertEquals(frames.length, 2);
  assertEquals(frames[0].kind, "json");
  assertEquals(frames[1].kind, "bytes");
  if (frames[1].kind === "bytes") {
    assertEquals([...frames[1].payload], [9, 8, 7]);
  }
  assertEquals(writer.faulted, false);
});

Deno.test("platform/security#R1: partial write 실패 뒤 writer는 fault되고 이후 바이트를 붙이지 않는다", async () => {
  let writes = 0;
  const writer = createFrameWriter({
    write: (_bytes: Uint8Array) => {
      writes += 1;
      if (writes === 1) return Promise.resolve(1); // 진행은 있었지만 끝내지 못한다
      return Promise.reject(new Error("pipe broke"));
    },
  });
  await assertRejects(() => writer.writeJson({ type: "ready" }));
  assert(writer.faulted);
  // fault 뒤 새 frame은 한 번도 writer.write를 더 부르지 않고 바로 거절된다.
  const before = writes;
  await assertRejects(() => writer.writeBytes(1, new Uint8Array([1])));
  assertEquals(writes, before);
});

Deno.test("platform/security#R1: 큐에 있던 write도 앞선 fault와 함께 거절된다(FIFO 보존)", async () => {
  let calls = 0;
  const writer = createFrameWriter({
    write: () => {
      calls += 1;
      return Promise.resolve(-1); // count가 범위 밖이라 매번 fault로 간다
    },
  });
  // 둘 다 같은 tick에서 큐에 들어간다. 첫 frame이 fault되면 둘째는 write를 아예 안 부른다.
  const first = writer.writeJson({ type: "ready" });
  const second = writer.writeBytes(2, new Uint8Array([1, 2]));
  await assertRejects(() => first);
  await assertRejects(() => second);
  assert(writer.faulted);
  assertEquals(calls, 1);
});

Deno.test("platform/security#R1: write 진행 count는 1..remaining의 finite integer여야 한다", async () => {
  for (const bad of [0, -1, NaN, Infinity, 999]) {
    const writer = createFrameWriter({
      write: () => Promise.resolve(bad),
    });
    await assertRejects(() => writer.writeJson({ type: "ready" }));
  }
});

// 쓰기가 영원히 끝나지 않는 sink. release()로 하나씩 풀어 준다.
function blockedSink() {
  const written: Uint8Array[] = [];
  const pending: Array<() => void> = [];
  return {
    written,
    writer: {
      write: (bytes: Uint8Array) =>
        new Promise<number>((resolve) => {
          pending.push(() => {
            written.push(bytes.slice());
            resolve(bytes.length);
          });
        }),
    },
    release: () => pending.shift()?.(),
  };
}

Deno.test("platform/security#R3: 막힌 sink에 계속 써도 backlog는 상한에서 fail-closed한다", async () => {
  const sink = blockedSink();
  const writer = createFrameWriter(sink.writer);
  const accepted: Promise<void>[] = [];
  let refused: unknown;
  for (let i = 0; i < WRITE_BACKLOG_MAX_FRAMES + 10; i++) {
    const result = writer.writeBytes(1, new Uint8Array([i % 256]));
    result.catch(() => {});
    if (writer.faulted) {
      refused = await result.catch((error) => error);
      break;
    }
    accepted.push(result);
  }
  assert(refused instanceof Error && refused.message.includes("backlog"));
  assertEquals(accepted.length, WRITE_BACKLOG_MAX_FRAMES - 1);
  // 쓰는 중인 frame만 남고 줄 선 것은 모두 거절됐다.
  assertEquals(writer.backlog.frames, 1);
  await assertRejects(() => accepted[1]);
  await assertRejects(() => writer.writeFinal({ type: "stopped" }));
});

Deno.test("platform/security#R3: backlog byte 상한은 header까지 센다", async () => {
  const sink = blockedSink();
  const writer = createFrameWriter(sink.writer);
  writer.writeBytes(1, new Uint8Array(STREAM_CHUNK_MAX_BYTES)).catch(() => {});
  assertEquals(writer.backlog, {
    frames: 1,
    bytes: STREAM_CHUNK_MAX_BYTES + 9,
  });
  assert(writer.backlog.bytes <= WRITE_BACKLOG_MAX_BYTES);
  await assertRejects(
    () => writer.writeBytes(2, new Uint8Array(STREAM_CHUNK_MAX_BYTES)),
    Error,
    "backlog",
  );
  assert(writer.faulted);
});

Deno.test("platform/security#R3: 일반 frame이 상한까지 차도 마지막 제어 frame 하나는 들어간다", async () => {
  const sink = blockedSink();
  const writer = createFrameWriter(sink.writer);
  for (let i = 0; i < WRITE_BACKLOG_MAX_FRAMES - 1; i++) {
    writer.writeJson({ type: "ready" }).catch(() => {});
  }
  const final = writer.writeFinal({ type: "stopped" });
  assertEquals(writer.backlog.frames, WRITE_BACKLOG_MAX_FRAMES);
  assertEquals(writer.faulted, false);
  await assertRejects(
    () => writer.writeJson({ type: "ready" }),
    Error,
    "closed",
  );
  await assertRejects(() => writer.writeFinal({ type: "stopped" }));
  for (let i = 0; i < WRITE_BACKLOG_MAX_FRAMES; i++) {
    sink.release();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  await final;
  assertEquals(sink.written.length, WRITE_BACKLOG_MAX_FRAMES);
});

Deno.test("platform/security#R3: 줄에 넣은 뒤 payload를 바꿔도 나가는 frame은 바뀌지 않는다", async () => {
  const sink = blockedSink();
  const writer = createFrameWriter(sink.writer);
  const first = writer.writeJson({ type: "ready" });
  const payload = new Uint8Array([1, 2, 3]);
  const second = writer.writeBytes(5, payload);
  payload.fill(9);
  sink.release();
  await first;
  sink.release();
  await second;
  const frames = new FrameDecoder().push(
    new Uint8Array([...sink.written[0], ...sink.written[1]]),
  );
  assertEquals(frames[1].kind, "bytes");
  if (frames[1].kind === "bytes") {
    assertEquals([...frames[1].payload], [1, 2, 3]);
  }
});

Deno.test("platform/security#R1: 인코딩 실패는 그 호출만 거절하고 pipe를 fault로 만들지 않는다", async () => {
  const writer = createFrameWriter({
    write: (bytes) => Promise.resolve(bytes.length),
  });
  await assertRejects(() => writer.writeJson({ value: 1n }));
  assertEquals(writer.faulted, false);
  await writer.writeJson({ type: "ready" });
});

Deno.test("platform/security#R3: close는 시작 전 frame만 버리고 쓰는 중인 frame과 마지막 frame은 보낸다", async () => {
  const sink = blockedSink();
  const writer = createFrameWriter(sink.writer);
  const active = writer.writeJson({ type: "ready" });
  const queued = writer.writeBytes(1, new Uint8Array([1]));
  writer.close();
  await assertRejects(() => queued, Error, "closed");
  await assertRejects(() => writer.writeBytes(1, new Uint8Array([2])));
  const final = writer.writeFinal({ type: "stopped" });
  sink.release();
  await active;
  await new Promise((resolve) => setTimeout(resolve, 0));
  sink.release();
  await final;
  const frames = new FrameDecoder().push(
    new Uint8Array(sink.written.flatMap((chunk) => [...chunk])),
  );
  assertEquals(frames.map((frame) => frame.kind), ["json", "json"]);
});
