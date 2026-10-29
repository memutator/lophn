import assert from "node:assert/strict";
import { test } from "node:test";
import { RingBuffer } from "./ring-buffer.ts";

test("raw buffer는 LF와 chunk 수를 따로 제한하고 after_seq 뒤의 출력만 보존해 돌려준다", () => {
  const buffer = new RingBuffer();
  for (let i = 0; i < 100; i++) buffer.push("a");
  buffer.push("한글\n다음");
  assert.equal(buffer.size.lines, 1);
  assert.equal(buffer.dropped, false);
  assert.deepStrictEqual(
    buffer.snapshot(100).chunks.map((chunk) => [chunk.seq, chunk.text]),
    [[101, "한글\n다음"]],
  );
  assert.deepStrictEqual(buffer.snapshot(101).chunks, []);
  for (let i = 0; i < 10_000; i++) buffer.push("z");
  const latest = buffer.snapshot().chunks;
  assert.equal(latest.length, 10_000);
  assert.equal(latest[0]?.seq, 102);
  assert.equal(latest.at(-1)?.seq, buffer.outputSeq);
  assert.equal(buffer.dropped, true);
});
