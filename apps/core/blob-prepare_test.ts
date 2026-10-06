// core의 blob 준비 중계(platform Q2·Q6). I/O worker 대신 credit을 직접 주는 가짜 worker로
// 중계가 바이트를 모으지 않고 worker의 credit 안에서만 흘려보내는지 따진다.
import { assert, assertEquals } from "@std/assert";
import { ok } from "../../packages/base/mod.ts";
import { createPreparationRegistry } from "../../packages/platform/blob-store/mod.ts";
import {
  BLOB_RELAY_BUFFER_MAX_BYTES,
  BLOB_RELAY_MIN_FRAME_BYTES,
  type BlobPrepareRelay,
  createBlobPrepareRelay,
  createBufferGauge,
} from "./blob-prepare.ts";

const CHUNK = 256 * 1024;
const MIB = 1024 * 1024;
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 5));

type Sent = {
  requests: { request_id: string; channel: number; op: string }[];
  // 순서대로: "request", "bytes:<n>", "end", "abort"
  events: string[];
  bytes: number;
};

function harness(options: { creditMs?: number; responseMs?: number } = {}) {
  const sent: Sent = { requests: [], events: [], bytes: 0 };
  const gauge = createBufferGauge();
  const relay: BlobPrepareRelay = createBlobPrepareRelay({
    send: (payload) => {
      sent.requests.push(payload as Sent["requests"][number]);
      sent.events.push("request");
      return Promise.resolve();
    },
    sendBytes: (_channel, chunk) => {
      sent.bytes += chunk.length;
      sent.events.push(`bytes:${chunk.length}`);
      return Promise.resolve();
    },
    sendEnd: () => {
      sent.events.push("end");
      return Promise.resolve();
    },
    sendAbort: () => {
      sent.events.push("abort");
      return Promise.resolve();
    },
    registry: createPreparationRegistry(),
    nowMs: () => 0,
    note: () => Promise.resolve(ok(undefined)),
    gauge,
    creditMs: options.creditMs ?? 5_000,
    responseMs: options.responseMs ?? 5_000,
  });
  const grant = (window: number) => {
    const request = sent.requests[0]!;
    relay.accept({ type: "credit", channel: request.channel, window });
  };
  const respond = (hash: string, size: number) => {
    const request = sent.requests[0]!;
    relay.accept({
      type: "worker_response",
      request_id: request.request_id,
      ok: true,
      payload: {
        preparation: request.request_id,
        principal: "machine",
        purpose: "document_file",
        hash,
        size_bytes: size,
      },
    });
  };
  return { relay, sent, gauge, grant, respond };
}

// pull할 때만 만들고, 몇 바이트를 읽어 갔는지 센다.
function source(total: number, options: { failAt?: number } = {}) {
  const state = { pulled: 0, cancelled: false };
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (options.failAt !== undefined && state.pulled >= options.failAt) {
        controller.error(new Error("source failed"));
        return;
      }
      if (state.pulled >= total) {
        controller.close();
        return;
      }
      const size = Math.min(CHUNK, total - state.pulled);
      state.pulled += size;
      controller.enqueue(new Uint8Array(size));
    },
    cancel() {
      state.cancelled = true;
    },
  }, { highWaterMark: 0 });
  return { state, stream };
}

const input = { principal: "machine", purpose: "document_file" };
const HASH = "a".repeat(64);

Deno.test("platform/responsiveness#R1 platform/blob-store#R2: 중계는 요청 json을 먼저 보내고 worker credit이 없으면 원천을 읽지 않는다", async () => {
  const h = harness();
  const src = source(8 * MIB);
  const done = h.relay.prepare(input, src.stream);
  await tick();
  await tick();
  assertEquals(h.sent.events, ["request"]);
  assertEquals(h.sent.requests[0]!.op, "blob.prepare");
  assertEquals(src.state.pulled, 0);
  assertEquals(h.gauge.current, 0);
  // 정리: worker가 오류로 답하면 중계가 끝난다.
  h.relay.accept({
    type: "worker_response",
    request_id: h.sent.requests[0]!.request_id,
    ok: false,
    error: { code: "unavailable", message: "x" },
  });
  await done;
});

Deno.test("platform/responsiveness#R1 platform/blob-store#R2: 64MiB를 worker credit만큼씩 흘려보내고 중계가 쥔 바이트는 chunk 하나를 넘지 않는다", async () => {
  const h = harness();
  const total = 64 * MIB;
  const src = source(total);
  const done = h.relay.prepare(input, src.stream);
  await tick();
  // credit이 chunk보다 작으면 chunk를 읽어 쥔 채 나눠 보낸다.
  h.grant(100 * 1024);
  await tick();
  assertEquals(h.sent.bytes, 100 * 1024);
  assertEquals(src.state.pulled, CHUNK);
  assertEquals(h.gauge.current, CHUNK - 100 * 1024);
  // 쓴 만큼만 다시 받는다. worker가 늦으면 원천은 더 읽히지 않는다.
  for (let rounds = 0; rounds < 10; rounds++) await tick();
  assertEquals(src.state.pulled, CHUNK);
  // worker가 받은 만큼 credit을 주며 끝까지 흘린다.
  let stalled = 0;
  while (!h.sent.events.includes("end")) {
    const before = h.sent.bytes;
    h.grant(MIB);
    await tick();
    stalled = h.sent.bytes === before ? stalled + 1 : 0;
    assert(stalled < 50, "중계가 더 흐르지 않는다");
    // 읽어 간 것에서 worker로 넘긴 것을 뺀 양이 중계가 쥔 바이트다.
    assert(src.state.pulled - h.sent.bytes <= CHUNK);
  }
  assertEquals(h.sent.bytes, total);
  assertEquals(src.state.pulled, total);
  assert(h.gauge.peak <= CHUNK, `중계가 ${h.gauge.peak}바이트를 쥐었다`);
  assert(h.gauge.peak <= BLOB_RELAY_BUFFER_MAX_BYTES);
  assertEquals(h.gauge.current, 0);
  // 요청이 맨 앞, end가 맨 뒤다. abort는 없다.
  assertEquals(h.sent.events[0], "request");
  assertEquals(h.sent.events.at(-1), "end");
  assert(!h.sent.events.includes("abort"));
  h.respond(HASH, total);
  const result = await done;
  assert(result.ok);
  assertEquals(result.value.size_bytes, total);
  assert(
    h.relay.live(
      { hash: HASH, principal: "machine", purpose: "document_file" },
      0,
    ),
  );
});

Deno.test("platform/blob-store#R2: 원천이 중간에 실패하면 중계는 end가 아니라 abort를 보내고 쥔 바이트를 돌려준다", async () => {
  const h = harness();
  const src = source(8 * MIB, { failAt: 2 * CHUNK });
  const done = h.relay.prepare(input, src.stream);
  await tick();
  h.grant(8 * MIB);
  const result = await done;
  assert(!result.ok);
  assertEquals(result.error.code, "unavailable");
  assertEquals(h.sent.bytes, 2 * CHUNK);
  assertEquals(h.sent.events.at(-1), "abort");
  assert(!h.sent.events.includes("end"));
  assertEquals(h.gauge.current, 0);
  // 늦게 온 응답은 기다리는 요청이 없어 버려진다.
  h.respond(HASH, 2 * CHUNK);
  assertEquals(h.relay.size, 0);
});

Deno.test("platform/blob-store#R2: 바이트가 끝나기 전에 worker가 오류로 답하면 중계는 읽기를 멈추고 원천을 닫고 그 오류를 돌려준다", async () => {
  const h = harness();
  const src = source(64 * MIB);
  const done = h.relay.prepare(input, src.stream);
  await tick();
  h.grant(MIB);
  await tick();
  const pulledBefore = src.state.pulled;
  h.relay.accept({
    type: "worker_response",
    request_id: h.sent.requests[0]!.request_id,
    ok: false,
    error: { code: "unavailable", message: "디스크 여유가 부족하다" },
  });
  const result = await done;
  assert(!result.ok);
  assertEquals(result.error.code, "unavailable");
  assertEquals(src.state.pulled, pulledBefore);
  assert(src.state.cancelled);
  assertEquals(h.sent.events.at(-1), "abort");
  assertEquals(h.gauge.current, 0);
});

Deno.test("platform/responsiveness#R3: worker가 credit도 응답도 주지 않으면 기한 뒤 중계는 abort하고 unavailable로 끝난다", async () => {
  const h = harness({ creditMs: 40 });
  const src = source(8 * MIB);
  const result = await h.relay.prepare(input, src.stream);
  assert(!result.ok);
  assertEquals(result.error.code, "unavailable");
  assertEquals(h.sent.events, ["request", "abort"]);
  assertEquals(src.state.pulled, 0);
});

Deno.test("platform/responsiveness#R3: end 뒤 응답이 오지 않으면 기한 뒤 unavailable로 끝난다", async () => {
  const h = harness({ responseMs: 40 });
  const src = source(CHUNK);
  const done = h.relay.prepare(input, src.stream);
  await tick();
  h.grant(MIB);
  const result = await done;
  assert(!result.ok);
  assertEquals(result.error.code, "unavailable");
  assertEquals(h.sent.events.at(-1), "end");
  assert(!h.sent.events.includes("abort"));
});

Deno.test("platform/responsiveness#R3: 잘게 쪼개진 원천은 합쳐서 보내 받는 쪽의 frame 수 한도를 쓰지 않는다", async () => {
  const h = harness();
  const total = MIB;
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (pulled >= total) return controller.close();
      pulled += 1024;
      controller.enqueue(new Uint8Array(1024));
    },
  }, { highWaterMark: 0 });
  const done = h.relay.prepare(input, stream);
  await tick();
  h.grant(2 * MIB);
  for (let i = 0; i < 400 && !h.sent.events.includes("end"); i++) await tick();
  assertEquals(h.sent.bytes, total);
  const frames = h.sent.events.filter((event) => event.startsWith("bytes:"));
  // 1024바이트 chunk가 1024개지만 32KiB 이상으로 합쳐 32개 안팎이 나간다.
  assert(
    frames.length <= total / BLOB_RELAY_MIN_FRAME_BYTES,
    `${frames.length}`,
  );
  assert(
    frames.every((event) =>
      Number(event.slice(6)) >= BLOB_RELAY_MIN_FRAME_BYTES
    ),
  );
  h.respond(HASH, total);
  assert((await done).ok);
});

Deno.test("platform/blob-store#R1 coding-agent/mcp-server#R13: 같은 주체·purpose·내용의 재준비는 conflict가 아니라 살아 있는 참조를 그대로 돌려준다", async () => {
  const h = harness();
  const prepareOnce = async () => {
    const before = h.sent.requests.length;
    const done = h.relay.prepare(input, source(100).stream);
    await tick();
    const request = h.sent.requests[before]!;
    h.relay.accept({ type: "credit", channel: request.channel, window: MIB });
    await tick();
    h.relay.accept({
      type: "worker_response",
      request_id: request.request_id,
      ok: true,
      payload: {
        preparation: request.request_id,
        principal: "machine",
        purpose: "document_file",
        hash: HASH,
        size_bytes: 100,
      },
    });
    return await done;
  };
  const first = await prepareOnce();
  assert(first.ok);
  const second = await prepareOnce();
  // 두 번째 요청은 새 참조를 만들지 않고 처음 참조(저장 command가 쥘 수 있는 값)를 돌려준다.
  assert(second.ok, second.ok ? "" : second.error.message);
  assertEquals(second.value, first.value);
  assertEquals(h.relay.size, 1);
});

Deno.test("platform/responsiveness#R3: I/O worker가 끝나면 credit을 기다리던 준비는 기한까지 두지 않고 abort하고 unavailable로 끝난다", async () => {
  // 기한은 5초다. worker가 끝난 순간 끝나지 않으면 이 시험은 그만큼 기다린다.
  const h = harness({ creditMs: 5_000, responseMs: 5_000 });
  const src = source(8 * MIB);
  const begun = performance.now();
  const done = h.relay.prepare(input, src.stream);
  await tick();
  h.relay.failPending("I/O worker ended");
  const result = await done;
  assert(performance.now() - begun < 2_000);
  assert(!result.ok);
  assertEquals(result.error.code, "unavailable");
  assertEquals(h.sent.events, ["request", "abort"]);
  assertEquals(h.gauge.current, 0);
});

Deno.test("platform/responsiveness#R3: I/O worker가 끝나면 end 뒤 응답을 기다리던 준비도 바로 unavailable이다", async () => {
  const h = harness({ creditMs: 5_000, responseMs: 5_000 });
  const src = source(CHUNK);
  const begun = performance.now();
  const done = h.relay.prepare(input, src.stream);
  await tick();
  h.grant(MIB);
  await tick();
  assertEquals(h.sent.events.at(-1), "end");
  h.relay.failPending("I/O worker ended");
  const result = await done;
  assert(performance.now() - begun < 2_000);
  assert(!result.ok);
  assertEquals(result.error.code, "unavailable");
});

Deno.test("platform/responsiveness#R3: I/O worker가 끝나면 blob 읽기도 기한(6초)까지 두지 않고 unavailable이다", async () => {
  const h = harness();
  const begun = performance.now();
  const reading = h.relay.readBytes(HASH, 0, 16);
  await tick();
  h.relay.failPending("I/O worker ended");
  const result = await reading;
  assert(performance.now() - begun < 2_000);
  assert(!result.ok);
  assertEquals(result.error.code, "unavailable");
});

Deno.test("platform/responsiveness#R3: failPending 뒤에 시작한 준비는 영향을 받지 않는다", async () => {
  const h = harness();
  h.relay.failPending("I/O worker ended");
  const src = source(CHUNK);
  const done = h.relay.prepare(input, src.stream);
  await tick();
  h.grant(MIB);
  await tick();
  h.respond(HASH, CHUNK);
  const result = await done;
  assert(result.ok);
});
