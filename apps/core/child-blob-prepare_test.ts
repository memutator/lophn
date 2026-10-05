// 신뢰 자식의 blob 준비 통로(platform Q6, blob-store#R1 R2). 실제 core·I/O worker·자식
// process를 감독 pipe로 잇는 시험과, credit·abort·크기 상한을 따지는 handler 시험이다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import {
  BLOB_PREPARE_CREDIT_WINDOW,
  type ChildMessage,
  childMessageSchema,
  type Frame,
  type ParentMessage,
  STREAM_CHUNK_MAX_BYTES,
} from "../../packages/contracts/platform/mod.ts";
import {
  objectPathFor,
  tmpDirFor,
} from "../../packages/platform/blob-store/mod.ts";
import {
  type ByteReader,
  createFrameWriter,
  readFrames,
} from "../../packages/platform/responsiveness/frames.ts";
import { sha256Hex } from "../../packages/base/mod.ts";
import {
  BLOB_RELAY_BUFFER_MAX_BYTES,
  createBufferGauge,
} from "./blob-prepare.ts";
import {
  CHILD_BLOB_POLICIES,
  createChildBlobPrepare,
} from "./child-blob-prepare.ts";
import { type Core, startCore } from "./core.ts";
import { patternBytes, type Scenario } from "./testing/blob-prepare-child.ts";

const FIXTURE = new URL("./testing/blob-prepare-child.ts", import.meta.url)
  .pathname;

async function withCore(run: (core: Core) => Promise<void>) {
  const home = await Deno.makeTempDir({ prefix: "lophn-child-blob-" });
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(1),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  try {
    await run(started.value);
  } finally {
    await started.value.shutdown();
    await Deno.remove(home, { recursive: true });
  }
}

async function blobFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  const walk = async (dir: string) => {
    try {
      for await (const entry of Deno.readDir(dir)) {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory) await walk(path);
        else found.push(path);
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  };
  await walk(`${root}/blobs/sha256`);
  return found;
}

type ChildOutcome =
  | { ok: true; payload: Record<string, unknown> }
  | { ok: false; error: { code: string; message: string } };

// 실제 자식 process를 띄워 core의 handler와 감독 pipe로 잇는다. hello·worker_request를
// 보내고 자식의 worker_response를 받는다. 띄운 process는 끝나기를 기다리고 남기지 않는다.
async function runChild(
  core: Core,
  kind: string,
  scenario: Scenario,
): Promise<ChildOutcome> {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "--no-prompt", FIXTURE],
    clearEnv: true,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const stdin = child.stdin.getWriter();
  const writer = createFrameWriter({
    write: async (bytes) => {
      await stdin.write(bytes);
      return bytes.length;
    },
  });
  const reader = child.stdout.getReader({ mode: "byob" });
  const byteReader: ByteReader = {
    read: async (buffer) => {
      const next = await reader.read(new Uint8Array(buffer.length));
      if (next.done || next.value === undefined) return null;
      buffer.set(next.value);
      return next.value.length;
    },
  };
  const handler = core.childBlobPrepare(
    kind,
    (message) => writer.writeJson(message).then(() => true, () => false),
  );
  const outcome = Promise.withResolvers<ChildOutcome>();
  const stderrDone = child.stderr.cancel();
  const pump = (async () => {
    for await (const frame of readFrames(byteReader)) {
      if (frame.kind !== "json") {
        handler.onFrame(frame);
        continue;
      }
      const message = childMessageSchema.parse(frame.payload);
      if (message.type === "ready") {
        await writer.writeJson({
          type: "worker_request",
          request_id: "case-1",
          op: "test.prepare",
          payload: scenario,
        });
      } else if (message.type === "worker_response") {
        outcome.resolve(
          message.ok
            ? { ok: true, payload: message.payload as Record<string, unknown> }
            : { ok: false, error: message.error },
        );
      } else {
        handler.onMessage(message);
      }
    }
  })();
  try {
    await writer.writeJson({
      type: "hello",
      core_epoch: "epoch",
      process_identity: "proc",
      kind,
      task: "test",
      scope: { operations: [], targets: {} },
      credential: "credential-not-used",
      api_port: 1,
    });
    return await outcome.promise;
  } finally {
    handler.close();
    await writer.writeFinal({ type: "stop", grace_ms: 1000 }).catch(() => {});
    const status = await Promise.race([
      child.status,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5000)),
    ]);
    if (status === null) child.kill();
    await stdin.close().catch(() => {});
    await child.status;
    await stderrDone;
    await pump.catch(() => {});
  }
}

Deno.test("platform/blob-store#R2 platform/blob-store#R1: 문서 worker 자식이 감독 pipe로 3MiB를 준비하면 I/O worker가 hash를 정하고 blob store에 설치한다", async () => {
  await withCore(async (core) => {
    const size = 3 * 1024 * 1024 + 123;
    const outcome = await runChild(core, "documents/worker", {
      purpose: "document_files",
      size,
      mode: "ok",
    });
    assert(outcome.ok, outcome.ok ? "" : outcome.error.message);
    const expected = await sha256Hex(patternBytes(size));
    assertEquals(outcome.payload["hash"], expected);
    assertEquals(outcome.payload["size_bytes"], size);
    // principal은 자식이 아니라 core의 kind 정책이 정했다.
    assertEquals(outcome.payload["principal"], "machine");
    assertEquals(outcome.payload["purpose"], "document_files");
    const installed = await Deno.readFile(
      objectPathFor(core.dataRoot, expected),
    );
    assertEquals(installed.length, size);
    assertEquals(installed[1000], patternBytes(1001)[1000]);
  });
});

Deno.test("platform/blob-store#R2: report collector kind는 자기 principal과 purpose 상한 안에서 준비한다", async () => {
  await withCore(async (core) => {
    const outcome = await runChild(core, "problems/report-collector", {
      purpose: "report_text",
      size: 1000,
      mode: "ok",
    });
    assert(outcome.ok, outcome.ok ? "" : outcome.error.message);
    assertEquals(outcome.payload["principal"], "collector");
    assertEquals(outcome.payload["purpose"], "report_text");
  });
});

Deno.test("problems/feedback#R6 problems/feedback#R8: report collector는 feedback 상태와 선택 PNG도 purpose 상한 안에서 준비한다", async () => {
  await withCore(async (core) => {
    for (const purpose of ["feedback_state", "feedback_screenshot"]) {
      const cap = CHILD_BLOB_POLICIES.get("problems/report-collector")!
        .purposes.get(purpose)!;
      const outcome = await runChild(core, "problems/report-collector", {
        purpose,
        size: 1000,
        mode: "ok",
      });
      assert(outcome.ok, outcome.ok ? "" : outcome.error.message);
      assertEquals(outcome.payload["purpose"], purpose);
      const over = await runChild(core, "problems/report-collector", {
        purpose,
        size: cap + 1,
        mode: "ok",
      });
      assert(!over.ok);
      assertEquals(over.error.code, "invalid_input");
    }
  });
});

Deno.test("platform/blob-store#R3 platform/api#R4: 허용되지 않은 자식 kind와 허용되지 않은 purpose는 같은 forbidden이고 blob이 생기지 않는다", async () => {
  await withCore(async (core) => {
    const unknown = await runChild(core, "apps/supervisor", {
      purpose: "document_files",
      size: 10,
      mode: "ok",
    });
    assert(!unknown.ok);
    assertEquals(unknown.error.code, "forbidden");
    const wrongPurpose = await runChild(core, "problems/report-collector", {
      purpose: "document_files",
      size: 10,
      mode: "ok",
    });
    assert(!wrongPurpose.ok);
    assertEquals(wrongPurpose.error, unknown.error);
    assertEquals(await blobFiles(core.dataRoot), []);
  });
});

Deno.test("platform/blob-store#R2: purpose 상한을 넘는 선언 크기는 바이트를 받기 전에 invalid_input으로 거절하고 blob이 생기지 않는다", async () => {
  await withCore(async (core) => {
    const cap = CHILD_BLOB_POLICIES.get("problems/report-collector")!.purposes
      .get("report_text")!;
    const outcome = await runChild(core, "problems/report-collector", {
      purpose: "report_text",
      size: cap + 1,
      mode: "ok",
    });
    assert(!outcome.ok);
    assertEquals(outcome.error.code, "invalid_input");
    assertEquals(await blobFiles(core.dataRoot), []);
  });
});

Deno.test("platform/blob-store#R2: 자식 stream이 중간에 abort되면 blob이 설치되지 않고 자식은 오류를 받는다", async () => {
  await withCore(async (core) => {
    const outcome = await runChild(core, "documents/worker", {
      purpose: "document_files",
      size: 2 * 1024 * 1024,
      mode: "abort_midway",
    });
    assert(!outcome.ok);
    assertEquals(outcome.error.code, "unavailable");
    assertEquals(await blobFiles(core.dataRoot), []);
  });
});

// I/O worker가 임시 파일을 버리는 일은 자식이 오류를 받은 뒤에 끝날 수 있다.
async function tmpEntries(root: string): Promise<string[]> {
  const names: string[] = [];
  try {
    for await (const entry of Deno.readDir(tmpDirFor(root))) {
      names.push(entry.name);
    }
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound)) throw error;
  }
  return names;
}

async function settledEmpty(
  list: () => Promise<string[]>,
): Promise<string[]> {
  let found = await list();
  for (let waited = 0; found.length > 0 && waited < 100; waited++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    found = await list();
  }
  return found;
}

Deno.test("platform/responsiveness#R1 platform/blob-store#R2: 실제 자식이 64MiB를 보내도 core가 쥔 바이트는 credit window 안이고 I/O worker가 같은 hash로 설치한다", async () => {
  await withCore(async (core) => {
    const size = 64 * 1024 * 1024;
    const outcome = await runChild(core, "documents/worker", {
      purpose: "document_file",
      size,
      mode: "ok",
    });
    assert(outcome.ok, outcome.ok ? "" : outcome.error.message);
    const expected = await sha256Hex(patternBytes(size));
    assertEquals(outcome.payload["hash"], expected);
    assertEquals(outcome.payload["size_bytes"], size);
    const stat = await Deno.stat(objectPathFor(core.dataRoot, expected));
    assertEquals(stat.size, size);
    // 흐르는 내내(gauge가 모든 증가를 본다) core는 자식 쪽 credit window와 chunk 하나만 쥐었다.
    assert(core.blobBuffer.peak > 0, "core가 바이트를 쥔 적이 없다");
    assert(
      core.blobBuffer.peak <= BLOB_RELAY_BUFFER_MAX_BYTES,
      `core가 ${core.blobBuffer.peak}바이트를 쥐었다(한도 ${BLOB_RELAY_BUFFER_MAX_BYTES})`,
    );
    assert(BLOB_RELAY_BUFFER_MAX_BYTES * 16 <= size);
    assertEquals(core.blobBuffer.current, 0);
    assertEquals(await settledEmpty(() => tmpEntries(core.dataRoot)), []);
  });
});

Deno.test("platform/blob-store#R2 platform/responsiveness#R1: 64MiB 전송이 중간에 abort되면 blob도 임시 파일도 남지 않고 core가 쥔 바이트도 돌려받는다", async () => {
  await withCore(async (core) => {
    const outcome = await runChild(core, "documents/worker", {
      purpose: "document_file",
      size: 64 * 1024 * 1024,
      mode: "abort_midway",
    });
    assert(!outcome.ok);
    assertEquals(outcome.error.code, "unavailable");
    assertEquals(await blobFiles(core.dataRoot), []);
    assertEquals(await settledEmpty(() => tmpEntries(core.dataRoot)), []);
    assert(core.blobBuffer.peak <= BLOB_RELAY_BUFFER_MAX_BYTES);
    // 늦게 닿은 frame까지 버려진 뒤에는 쥔 바이트가 없다.
    for (let waited = 0; core.blobBuffer.current > 0 && waited < 40; waited++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assertEquals(core.blobBuffer.current, 0);
  });
});

// handler 시험: I/O worker 대신 stream을 직접 읽는 prepareBlob을 끼운다.
function harness(options: { kind?: string; idleMs?: number } = {}) {
  const sent: ParentMessage[] = [];
  const results: ParentMessage[] = [];
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const handler = createChildBlobPrepare({
    kind: options.kind ?? "documents/worker",
    idleMs: options.idleMs,
    send: (message) => {
      sent.push(message);
      if (message.type === "blob_prepare_result") results.push(message);
      return Promise.resolve(true);
    },
    prepareBlob: (call) => {
      reader = call.bytes.getReader();
      // consumer가 읽을 때까지 끝나지 않는 준비다.
      return new Promise(() => {});
    },
  });
  return { handler, sent, results, reader: () => reader };
}

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 15));
const request = (size: number, channel = 7): ChildMessage => ({
  type: "blob_prepare_request",
  request_id: "req-1",
  channel,
  purpose: "document_files",
  size_bytes: size,
});
const bytes = (channel: number, size: number): Frame => ({
  kind: "bytes",
  channel,
  payload: new Uint8Array(size),
});
const credits = (sent: ParentMessage[]) =>
  sent.flatMap((m) => m.type === "credit" ? [m.window] : []);

Deno.test("platform/api#R5 platform/blob-store#R2: credit은 처음 window만 주고 consumer가 읽은 만큼만 다시 준다", async () => {
  const h = harness();
  h.handler.onMessage(request(8 * 1024 * 1024));
  await tick();
  assertEquals(credits(h.sent), [BLOB_PREPARE_CREDIT_WINDOW]);
  // 자식이 credit을 다 쓴다. consumer가 읽기 전에는 credit이 늘지 않는다.
  h.handler.onFrame(bytes(7, STREAM_CHUNK_MAX_BYTES));
  h.handler.onFrame(bytes(7, STREAM_CHUNK_MAX_BYTES));
  await tick();
  assertEquals(credits(h.sent), [BLOB_PREPARE_CREDIT_WINDOW]);
  const reader = h.reader()!;
  const first = await reader.read();
  assertEquals(first.value?.length, STREAM_CHUNK_MAX_BYTES);
  await tick();
  assertEquals(credits(h.sent), [
    BLOB_PREPARE_CREDIT_WINDOW,
    STREAM_CHUNK_MAX_BYTES,
  ]);
  h.handler.close();
});

Deno.test("platform/api#R5: credit을 넘겨 보낸 바이트는 stream을 실패시키고 invalid_input 결과를 자식에게 준다", async () => {
  const sent: ParentMessage[] = [];
  let failed: unknown;
  const handler = createChildBlobPrepare({
    kind: "documents/worker",
    send: (message) => {
      sent.push(message);
      return Promise.resolve(true);
    },
    prepareBlob: async (call) => {
      try {
        const reader = call.bytes.getReader();
        for (;;) if ((await reader.read()).done) break;
        return {
          ok: false as const,
          error: { code: "internal" as const, message: "x" },
        };
      } catch (error) {
        failed = error;
        return {
          ok: false as const,
          error: {
            code: "unavailable" as const,
            message: "secret path /home/x",
          },
        };
      }
    },
  });
  handler.onMessage(request(8 * 1024 * 1024));
  await tick();
  // 선언 크기 안이어도 준 credit(2MiB)보다 많이 보내면 위반이다.
  handler.onFrame(bytes(7, STREAM_CHUNK_MAX_BYTES));
  handler.onFrame(bytes(7, STREAM_CHUNK_MAX_BYTES));
  handler.onFrame(bytes(7, 1));
  await tick();
  assert(failed instanceof Error);
  const result = sent.find((m) => m.type === "blob_prepare_result");
  assert(result?.type === "blob_prepare_result" && !result.ok);
  assertEquals(result.error.code, "invalid_input");
  assertEquals(handler.open, 0);
  handler.close();
});

Deno.test("platform/blob-store#R2: end 때 받은 바이트가 선언 크기와 다르면 준비가 성공하지 않는다", async () => {
  const h = harness();
  h.handler.onMessage(request(100));
  await tick();
  h.handler.onFrame(bytes(7, 40));
  h.handler.onFrame({ kind: "end", channel: 7 });
  await tick();
  const result = h.results[0];
  assert(result?.type === "blob_prepare_result" && !result.ok);
  assertEquals(result.error.code, "invalid_input");
  h.handler.close();
});

Deno.test("platform/blob-store#R2: abort frame은 stream을 닫고 결과를 보내지 않으며 이어 오는 frame을 버린다", async () => {
  const h = harness();
  h.handler.onMessage(request(100));
  await tick();
  h.handler.onFrame(bytes(7, 40));
  h.handler.onFrame({ kind: "abort", channel: 7 });
  h.handler.onFrame(bytes(7, 10));
  await tick();
  assertEquals(h.results, []);
  assertEquals(h.handler.open, 0);
  await h.reader()!.read().then(
    () => assert(false, "stream이 열려 있다"),
    () => {},
  );
});

Deno.test("platform/blob-store#R2: 말이 없는 자식의 stream은 idle 시간 뒤 버려진다", async () => {
  const h = harness({ idleMs: 20 });
  h.handler.onMessage(request(100));
  await tick();
  assertEquals(h.handler.open, 1);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assertEquals(h.handler.open, 0);
  h.handler.close();
});

Deno.test("platform/api#R4: 자식이 보낸 결과 오류에는 core 내부 메시지가 없다", async () => {
  const sent: ParentMessage[] = [];
  const handler = createChildBlobPrepare({
    kind: "documents/worker",
    send: (message) => {
      sent.push(message);
      return Promise.resolve(true);
    },
    prepareBlob: async (call) => {
      const reader = call.bytes.getReader();
      for (;;) if ((await reader.read()).done) break;
      return {
        ok: false as const,
        error: { code: "unavailable" as const, message: "/home/secret/path" },
      };
    },
  });
  handler.onMessage(request(0));
  await tick();
  handler.onFrame({ kind: "end", channel: 7 });
  await tick();
  assertEquals(JSON.stringify(sent).includes("/home/secret"), false);
  const result = sent.find((m) => m.type === "blob_prepare_result");
  assert(result?.type === "blob_prepare_result" && !result.ok);
  assertEquals(result.error.code, "unavailable");
  handler.close();
});

Deno.test("platform/blob-store#R2: I/O worker가 바이트를 다 받기 전에 오류로 답하면 자식은 그 오류의 안전한 결과를 받고 대기열은 비워진다", async () => {
  const sent: ParentMessage[] = [];
  const gauge = createBufferGauge();
  const handler = createChildBlobPrepare({
    kind: "documents/worker",
    gauge,
    send: (message) => {
      sent.push(message);
      return Promise.resolve(true);
    },
    prepareBlob: async (call) => {
      const reader = call.bytes.getReader();
      await reader.read();
      // 중계가 worker의 오류 응답을 받고 읽기를 그만둔다.
      await reader.cancel();
      return {
        ok: false as const,
        error: { code: "unavailable" as const, message: "/home/x/secret" },
      };
    },
  });
  handler.onMessage(request(8 * 1024 * 1024));
  await tick();
  handler.onFrame(bytes(7, 1000));
  handler.onFrame(bytes(7, 2000));
  await tick();
  const result = sent.find((m) => m.type === "blob_prepare_result");
  assert(result?.type === "blob_prepare_result" && !result.ok);
  assertEquals(result.error.code, "unavailable");
  assertEquals(JSON.stringify(sent).includes("/home/x"), false);
  assertEquals(handler.open, 0);
  assertEquals(gauge.current, 0);
  assertEquals(gauge.peak, 3000);
});
