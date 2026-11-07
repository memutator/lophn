import assert from "node:assert/strict";
import { test } from "node:test";
import type { CodeLine } from "@lophn/ui/reading";
import { advance, type Session, type Tokenize } from "./incremental.ts";
import { Lru } from "./lru.ts";

// 줄마다 token 하나. state는 지금까지 본 줄 수라 앞 state에서 이어 갔는지 알 수 있다.
function counting(calls: string[]): Tokenize<number> {
  return (text, state) => {
    calls.push(text);
    const rows = text.split("\n");
    const lines: CodeLine[] = rows.map((row, i) => [
      { text: row, color: String((state ?? 0) + i) },
    ]);
    return { lines, state: (state ?? 0) + rows.length };
  };
}

test("자라는 code는 끝난 새 줄만 tokenize하고 쓰는 중인 줄은 final에서만 칠한다", () => {
  const calls: string[] = [];
  const tokenize = counting(calls);
  let session: Session<number> | undefined;
  const step = (code: string, final: boolean) => {
    const out = advance(session, code, "ts", final, tokenize, () => 0);
    session = out.session;
    return out.lines;
  };
  assert.deepEqual(step("a\nb", false)?.length, 1);
  assert.deepEqual(step("a\nb\nc\nd", false)?.length, 3);
  assert.deepEqual(calls, ["a", "b\nc"]);
  const final = step("a\nb\nc\nd", true);
  assert.deepEqual(final?.length, 4);
  assert.equal(final?.[3]?.[0]?.color, "3");
  assert.deepEqual(calls, ["a", "b\nc", "d"]);
});

test("앞부분이 바뀌거나 느리면 처음부터 다시 하거나 plain으로 둔다", () => {
  const calls: string[] = [];
  const tokenize = counting(calls);
  const first = advance(undefined, "a\nb\n", "ts", false, tokenize, () => 0);
  advance(first.session, "x\nb\n", "ts", false, tokenize, () => 0);
  assert.deepEqual(calls, ["a\nb", "x\nb"]);
  let tick = 0;
  const slow = advance(
    undefined,
    "a\nb\n",
    "ts",
    false,
    tokenize,
    () => (tick += 1000),
  );
  assert.equal(slow.session.slow, true);
  assert.equal(
    advance(slow.session, "a\nb\nc\n", "ts", false, tokenize, () => 0).lines,
    null,
  );
  assert.ok(
    advance(slow.session, "a\nb\nc\n", "ts", true, tokenize, () => 0).lines,
  );
});

test("LRU는 한도를 넘으면 가장 오래 안 쓴 것부터 버린다", () => {
  const lru = new Lru<string, number>(2);
  lru.set("a", 1);
  lru.set("b", 2);
  lru.get("a");
  lru.set("c", 3);
  assert.equal(lru.size, 2);
  assert.equal(lru.get("b"), undefined);
  assert.equal(lru.get("a"), 1);
});
