import { assert, assertEquals } from "@std/assert";
import { ok } from "../../base/mod.ts";
import { type BlobSink, prepareFromStream } from "./stream.ts";

function memorySink(): { sink: BlobSink; chunks: Uint8Array[] } {
  const chunks: Uint8Array[] = [];
  return {
    chunks,
    sink: {
      write(chunk) {
        // chunk를 복사해 둔다. stream 버퍼를 그대로 쥐면 다음 읽기가 덮어쓴다.
        chunks.push(chunk.slice());
        return Promise.resolve(ok(undefined));
      },
      finish() {
        return Promise.resolve(ok({ preparation: "prep-1" }));
      },
    },
  };
}

Deno.test("documents/file-tracking#R6: hash와 blob은 같은 stream에서 나오고 파일 전체를 모으지 않는다", async () => {
  const body = new Uint8Array(5_000);
  for (let index = 0; index < body.length; index++) body[index] = index % 251;
  const collected = memorySink();
  const size = 700;
  let largest = 0;
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      // 한 번에 일부만 흘린다. 전체가 한 chunk로 나가지 않는다.
      if (offset >= body.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + size, body.length);
      const slice = body.subarray(offset, end);
      offset = end;
      if (slice.length > largest) largest = slice.length;
      controller.enqueue(slice);
    },
  });
  const prepared = await prepareFromStream(stream, collected.sink);
  assert(prepared.ok);
  assertEquals(prepared.value.preparation, "prep-1");
  assertEquals(prepared.value.size_bytes, body.length);
  assertEquals(prepared.value.hash.length, 64);
  const joined = new Uint8Array(body.length);
  let cursor = 0;
  for (const chunk of collected.chunks) {
    joined.set(chunk, cursor);
    cursor += chunk.length;
  }
  assertEquals(joined, body);
  assert(largest < body.length, "한 chunk가 파일 전체가 아니다");
});

Deno.test("documents/file-tracking#R6: sink가 실패하면 부분 hash를 성공으로 주지 않는다", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
  const prepared = await prepareFromStream(stream, {
    write: () =>
      Promise.resolve({
        ok: false,
        error: { code: "unavailable", message: "disk full" },
      }),
    finish: () => Promise.resolve(ok({ preparation: "nope" })),
  });
  assert(!prepared.ok);
  assertEquals(prepared.error.code, "unavailable");
});
