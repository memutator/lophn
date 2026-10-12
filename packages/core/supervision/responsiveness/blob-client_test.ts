// 자식 쪽 blob 준비 client(platform Q6). 실제 pipe 시험은 packages/core/storage/blobs/child-prepare_test.ts다.
import { assert, assertEquals } from "@std/assert";
import type {
  ChildMessage,
  ParentMessage,
} from "../../../protocol/supervision/mod.ts";
import { createBlobPrepareClient } from "./blob-client.ts";

type Sent =
  | { kind: "json"; message: ChildMessage }
  | { kind: "bytes"; channel: number; size: number }
  | { kind: "end" | "abort"; channel: number };

function link() {
  const sent: Sent[] = [];
  return {
    sent,
    link: {
      send: (message: ChildMessage) => {
        sent.push({ kind: "json", message });
        return Promise.resolve();
      },
      sendBytes: (channel: number, payload: Uint8Array) => {
        sent.push({ kind: "bytes", channel, size: payload.length });
        return Promise.resolve();
      },
      sendEnd: (channel: number) => {
        sent.push({ kind: "end", channel });
        return Promise.resolve();
      },
      sendAbort: (channel: number) => {
        sent.push({ kind: "abort", channel });
        return Promise.resolve();
      },
    },
  };
}
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 15));
const bytesSent = (sent: Sent[]) =>
  sent.reduce((sum, item) => sum + (item.kind === "bytes" ? item.size : 0), 0);

function requestOf(sent: Sent[]) {
  const request = sent[0];
  assert(request?.kind === "json");
  assert(request.message.type === "blob_prepare_request");
  return request.message;
}

Deno.test("platform/api#R5: client는 credit이 올 때까지 바이트를 보내지 않고 credit 안에서만 보낸다", async () => {
  const { sent, link: out } = link();
  const client = createBlobPrepareClient(out);
  const pending = client.prepare({
    purpose: "document_files",
    sizeBytes: 100,
    bytes: new Uint8Array(100),
  });
  await tick();
  assertEquals(sent.length, 1);
  assertEquals(bytesSent(sent), 0);
  const request = requestOf(sent);
  client.accept({ type: "credit", channel: request.channel, window: 30 });
  await tick();
  assertEquals(bytesSent(sent), 30);
  client.accept({ type: "credit", channel: request.channel, window: 1000 });
  await tick();
  assertEquals(bytesSent(sent), 100);
  assertEquals(sent.at(-1), { kind: "end", channel: request.channel });
  client.accept(
    {
      type: "blob_prepare_result",
      request_id: request.request_id,
      ok: true,
      prepared: {
        preparation: "p",
        principal: "machine",
        purpose: "document_files",
        hash: "b".repeat(64),
        size_bytes: 100,
      },
    } satisfies ParentMessage,
  );
  const result = await pending;
  assert(result.ok);
  assertEquals(result.value.hash, "b".repeat(64));
});

Deno.test("platform/blob-store#R2: 선언 크기와 다른 바이트는 end 없이 abort한다", async () => {
  const { sent, link: out } = link();
  const client = createBlobPrepareClient(out);
  const short = client.prepare({
    purpose: "document_files",
    sizeBytes: 100,
    bytes: new Uint8Array(40),
  });
  await tick();
  client.accept({
    type: "credit",
    channel: requestOf(sent).channel,
    window: 1000,
  });
  const result = await short;
  assert(!result.ok);
  assertEquals(result.error.code, "invalid_input");
  assertEquals(sent.filter((item) => item.kind === "end").length, 0);
  assertEquals(sent.filter((item) => item.kind === "abort").length, 1);
});

Deno.test("platform/api#R5: core가 먼저 거절하면 client는 바이트를 보내지 않고 그 오류를 돌려준다", async () => {
  const { sent, link: out } = link();
  const client = createBlobPrepareClient(out);
  const pending = client.prepare({
    purpose: "nope",
    sizeBytes: 5,
    bytes: new Uint8Array(5),
  });
  await tick();
  client.accept({
    type: "blob_prepare_result",
    request_id: requestOf(sent).request_id,
    ok: false,
    error: { code: "forbidden", message: "blob prepare is not allowed" },
  });
  const result = await pending;
  assert(!result.ok);
  assertEquals(result.error.code, "forbidden");
  assertEquals(bytesSent(sent), 0);
});
