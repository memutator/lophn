import assert from "node:assert/strict";
import { test } from "node:test";

import {
  MAX_BYTES,
  MAX_LINES,
  RingBuffer,
} from "../../terminal-host/ring-buffer.ts";

test("shell/terminal#R7: 10,000줄을 넘으면 오래된 chunk부터 빼고 dropped를 켠다", () => {
  const buffer = new RingBuffer();
  for (let i = 0; i < MAX_LINES + 3; i++) buffer.push(`line ${i}\n`);
  const snap = buffer.snapshot();
  assert.equal(buffer.dropped, true);
  assert.ok(snap.chunks.length < MAX_LINES + 3);
  assert.equal(snap.chunks[0]?.text.startsWith("line 0"), false);
  assert.ok(buffer.size.lines <= MAX_LINES);
});

test("shell/terminal#R7: 5,242,880 bytes에 먼저 닿으면 줄을 남기지 않고 오래된 chunk를 뺀다", () => {
  const buffer = new RingBuffer();
  const block = "x".repeat(200_000);
  let pushed = 0;
  while (pushed < MAX_BYTES + block.length) {
    buffer.push(block);
    pushed += block.length;
  }
  assert.equal(buffer.dropped, true);
  assert.ok(buffer.size.bytes <= MAX_BYTES);
  assert.ok(buffer.size.lines <= MAX_LINES);
});

test("shell/terminal#R7: 한 chunk가 상한보다 크면 문자 경계로 자르고 원본은 디스크에 없다", () => {
  const buffer = new RingBuffer();
  const hangul = "가".repeat(MAX_BYTES);
  buffer.push(hangul);
  assert.equal(buffer.dropped, true);
  assert.ok(buffer.size.bytes <= MAX_BYTES);
  const text = buffer.snapshot().chunks[0]?.text ?? "";
  assert.equal(text.includes("�"), false);
});
