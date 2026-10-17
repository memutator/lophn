import { assert, assertEquals } from "@std/assert";
import { collect } from "./run.ts";

function streamOf(bytes: Uint8Array, chunkSize = 5000) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let at = 0; at < bytes.length; at += chunkSize) {
        controller.enqueue(bytes.slice(at, at + chunkSize));
      }
      controller.close();
    },
  });
}

const encode = (text: string) => new TextEncoder().encode(text);

Deno.test("shell 출력은 stream마다 상한을 넘지 않고 앞뒤가 남으며 가운데 생략이 표시된다", async () => {
  const small = "hello\nworld\n";
  assertEquals(await collect(streamOf(encode(small))), {
    text: small,
    truncated: false,
  });

  const lines = Array.from({ length: 20_000 }, (_, i) => `line ${i}`).join(
    "\n",
  );
  const big = await collect(streamOf(encode(lines)));
  assert(big.truncated);
  assert(big.text.startsWith("line 0\n"));
  assert(big.text.endsWith("line 19999"));
  assert(big.text.includes("bytes omitted"));
  assert(encode(big.text).length < 24 * 1024 + 200);

  // 앞뒤 자르는 자리가 2 byte 문자 한가운데에 걸린다.
  const multi = "x" + "é".repeat(30_000);
  const cut = await collect(streamOf(encode(multi)));
  assert(cut.truncated);
  assert(!cut.text.includes("�"));
});
