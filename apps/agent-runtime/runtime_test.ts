import { assert, assertEquals } from "@std/assert";
import { ok, type Result } from "../../packages/base/mod.ts";
import {
  encodeFrame,
  FrameDecoder,
} from "../../packages/contracts/platform/mod.ts";
import { redact, startAgentRuntime } from "./main.ts";

const HELLO = {
  type: "hello",
  core_epoch: "epoch-1",
  process_identity: "runtime-1",
  kind: "lophn-agent/runtime",
  task: "run-loop",
  scope: { operations: ["events/list"], targets: {} },
  credential: "machine-credential-1",
  api_port: 7431,
};

const CURSOR = {
  events: [],
  scanned_through_seq: "0",
  head_seq: "7",
  as_of_seq: "7",
  next_cursor: null,
};

// core를 대신하는 read. 받은 경로를 기록하고 cursor를 돌려준다.
function fakeRead(seen: string[]): () => Promise<Result<unknown>> {
  return () => {
    seen.push("/v1/events/list");
    return Promise.resolve(ok(CURSOR));
  };
}

// 감독 쪽 writer. 첫 frame은 runtime이 읽기 시작하기 전에 버퍼에 둔다.
function parentWriter(stream: WritableStream<Uint8Array>) {
  const writer = stream.getWriter();
  return {
    write(payload: unknown) {
      return writer.write(
        encodeFrame({ kind: "json", channel: 0, payload }),
      );
    },
    close: () => writer.close(),
  };
}

function pipes() {
  const toChild = new TransformStream<Uint8Array>();
  const fromChild = new TransformStream<Uint8Array>();
  const diagnostics = new TransformStream<Uint8Array>();
  return { toChild, fromChild, diagnostics };
}

Deno.test("lophn-agent/harness/run-loop#R8: 감독 pipe로 credential을 받고 core read로 event cursor를 조회한 뒤 ready를 낸다", async () => {
  const seen: string[] = [];
  const io = pipes();
  const parent = parentWriter(io.toChild.writable);
  // runtime이 stdin을 읽기 시작한 뒤에 도착한 첫 바이트를 놓치지 않게 먼저 쓴다.
  const written = parent.write(HELLO);
  const started = await startAgentRuntime({
    streams: {
      stdin: io.toChild.readable,
      stdout: io.fromChild.writable,
      stderr: io.diagnostics.writable,
    },
    read: fakeRead(seen),
  });
  await written;

  assert(started.ok);
  const frames = collectFrames(io.fromChild.readable);
  try {
    assertEquals(await frames.next(), { type: "ready" });
    assertEquals(started.value.startup.eventCursor, "7");
    assertEquals(started.value.startup.coreEpoch, "epoch-1");
    assertEquals(seen, ["/v1/events/list"]);
    // runtime은 core writer를 붙잡지 않는다. 연 것은 read 하나뿐이다.
    assertEquals(Object.keys(started.value.startup).sort(), [
      "apiPort",
      "coreEpoch",
      "credential",
      "eventCursor",
    ]);

    await parent.write({ type: "stop", grace_ms: 0 });
    assertEquals(await frames.next(), { type: "stopped" });
    assertEquals(started.value.stopped, true);
    await parent.close();
    await started.value.done;
  } finally {
    frames.close();
  }
});

Deno.test("lophn-agent/harness/run-loop#R4: runtime은 selector를 주고 selector가 읽는 route만 core loopback으로 연다", async () => {
  const seen: string[] = [];
  const io = pipes();
  const parent = parentWriter(io.toChild.writable);
  const written = parent.write(HELLO);
  const reply = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const started = await startAgentRuntime({
    streams: {
      stdin: io.toChild.readable,
      stdout: io.fromChild.writable,
      stderr: io.diagnostics.writable,
    },
    // core loopback을 대신하는 fetch. 받은 주소와 Bearer만 기록한다.
    fetch: (input, init) => {
      const url = new URL(String(input));
      seen.push(url.pathname);
      assertEquals(
        new Headers(init?.headers).get("authorization"),
        "Bearer machine-credential-1",
      );
      return Promise.resolve(
        url.pathname === "/v1/events/list" ? reply(CURSOR) : reply({
          runs: [],
          as_of_seq: "7",
          next_cursor: null,
        }),
      );
    },
  });
  await written;
  const frames = collectFrames(io.fromChild.readable);
  try {
    assertEquals(await frames.next(), { type: "ready" });
    assert(started.ok);
    // 접수된 run이 없으면 고를 것이 없고 core는 run 목록만 읽었다.
    assertEquals(await started.value.selector.next(), {
      ok: true,
      value: null,
    });
    assertEquals(seen, ["/v1/events/list", "/v1/runs/list"]);
    await parent.close();
    await started.value.done;
  } finally {
    frames.close();
  }
});

Deno.test("lophn-agent/harness/run-loop#R8: pipe가 닫히거나 core가 끝나면 새 진입을 막고 끝난다", async () => {
  const io = pipes();
  const parent = parentWriter(io.toChild.writable);
  const written = parent.write(HELLO);
  const started = await startAgentRuntime({
    streams: {
      stdin: io.toChild.readable,
      stdout: io.fromChild.writable,
      stderr: io.diagnostics.writable,
    },
    read: fakeRead([]),
  });
  await written;
  const frames = collectFrames(io.fromChild.readable);
  try {
    assertEquals(await frames.next(), { type: "ready" });
    assert(started.ok);

    // core 종료는 감독 pipe EOF로 온다. 별도 writer 연결은 없다.
    await parent.close();
    await started.value.done;
    assertEquals(started.value.stopped, true);
  } finally {
    frames.close();
  }
});

Deno.test("lophn-agent/harness/run-loop#R8: stderr에는 redaction된 진단만 쓴다", async () => {
  const io = pipes();
  const secret = "sk-ant-api03-secretvalue";
  const parent = parentWriter(io.toChild.writable);
  const written = parent.write({ ...HELLO, credential: secret });
  const started = startAgentRuntime({
    streams: {
      stdin: io.toChild.readable,
      stdout: io.fromChild.writable,
      stderr: io.diagnostics.writable,
    },
    read: () =>
      Promise.resolve({
        ok: false,
        error: {
          code: "unavailable",
          message: `core 연결 실패 authorization: Bearer ${secret}`,
        },
      }),
  });
  await written;
  await parent.close();
  const stdout = collectFrames(io.fromChild.readable);
  try {
    const result = await started;
    assertEquals(result.ok, false);

    const text = await readAll(io.diagnostics.readable);
    assert(text.includes("[redacted]"));
    assertEquals(text.includes(secret), false);
    assertEquals(text.includes("machine-credential"), false);
  } finally {
    stdout.close();
  }
});

Deno.test("lophn-agent/harness/run-loop#R8: 진단 redaction이 secret 형태를 가린다", () => {
  const input = [
    "key sk-ant-api03-abcdefghijklmnopqrstuvwxyz",
    "openai sk-proj1234567890abcdefghij",
    "github ghp_abcdefghijklmnopqrstuvwxyz",
    "aws AKIAIOSFODNN7EXAMPLE1",
    "slack xoxb-1234567890-abcdefghij",
    "jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature",
    "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
    "authorization: Bearer raw-token",
    "https://user:password@example.test/path",
  ].join(" ");
  const out = redact(input);
  for (
    const leaked of [
      "sk-ant-api03",
      "sk-proj",
      "ghp_",
      "AKIA",
      "xoxb-",
      "eyJhbGci",
      "PRIVATE KEY",
      "raw-token",
      "user:password",
    ]
  ) {
    assertEquals(out.includes(leaked), false, leaked);
  }
});

// stdout을 끝까지 읽어 역압을 풀고, 도착한 제어 frame을 순서대로 돌려준다.
function collectFrames(stream: ReadableStream<Uint8Array>) {
  const queue: unknown[] = [];
  let wake: (() => void) | undefined;
  const reader = stream.getReader();
  const decoder = new FrameDecoder();
  void (async () => {
    while (true) {
      const next = await reader.read();
      if (next.done || next.value.length === 0) return;
      for (const frame of decoder.push(next.value)) {
        if (frame.kind !== "json") continue;
        queue.push(frame.payload);
        wake?.();
      }
    }
  })();
  return {
    async next(): Promise<unknown> {
      while (queue.length === 0) {
        await new Promise<void>((resolve) => {
          wake = resolve;
        });
      }
      return queue.shift();
    },
    close() {
      void reader.cancel().catch(() => {});
      wake?.();
    },
  };
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  const first = await reader.read();
  if (!first.done) chunks.push(first.value);
  // 남은 읽기가 테스트 끝에 남으면 이벤트 루프가 안 선다.
  await reader.cancel().catch(() => {});
  const decoder = new TextDecoder();
  return chunks.map((chunk) => decoder.decode(chunk)).join("");
}
