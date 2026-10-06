import { assert, assertEquals } from "@std/assert";
import { seededRandom } from "../../base/mod.ts";
import {
  changeLines,
  decodeDiffCursor,
  type DiffBlock,
  diffBlocks,
  encodeDiffCursor,
  groupRuns,
  pageEnd,
} from "./diff.ts";

// 변경 block을 앞 줄 목록에 적용한다. 올바른 diff면 뒤 줄 목록이 나온다.
function apply(
  before: readonly string[],
  after: readonly string[],
  blocks: readonly DiffBlock[],
): string[] {
  const out: string[] = [];
  let at = 0;
  for (const block of blocks) {
    out.push(...before.slice(at, block.delete_start));
    out.push(...after.slice(block.insert_start, block.insert_end));
    at = block.delete_end;
  }
  out.push(...before.slice(at));
  return out;
}

// 최소 편집 거리의 대조 근거: LCS 동적 계획.
function lcsDistance(a: readonly string[], b: readonly string[]): number {
  const table = Array.from(
    { length: a.length + 1 },
    () => new Array<number>(b.length + 1).fill(0),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      table[i][j] = a[i - 1] === b[j - 1]
        ? table[i - 1][j - 1] + 1
        : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  return a.length + b.length - 2 * table[a.length][b.length];
}

function size(blocks: readonly DiffBlock[]): number {
  return blocks.reduce(
    (sum, block) =>
      sum + (block.delete_end - block.delete_start) +
      (block.insert_end - block.insert_start),
    0,
  );
}

Deno.test("documents/outline-and-search#R21: 추가와 삭제 줄이 변경 block으로 나오고 같은 줄은 나오지 않는다", () => {
  const before = ["a", "b", "c", "d", "e"];
  const after = ["a", "B", "c", "d", "e", "f"];
  const blocks = diffBlocks(before, after);
  assertEquals(blocks, [
    { delete_start: 1, delete_end: 2, insert_start: 1, insert_end: 2 },
    { delete_start: 5, delete_end: 5, insert_start: 5, insert_end: 6 },
  ]);
  assertEquals(diffBlocks(before, before), []);
  assertEquals(diffBlocks([], ["x"]), [
    { delete_start: 0, delete_end: 0, insert_start: 0, insert_end: 1 },
  ]);
  assertEquals(diffBlocks(["x"], []), [
    { delete_start: 0, delete_end: 1, insert_start: 0, insert_end: 0 },
  ]);
});

Deno.test("documents/outline-and-search#R21: 무작위 줄 목록의 diff는 적용하면 뒤 목록이 되고 최소 편집 거리다", () => {
  const source = seededRandom(7);
  const next = () => {
    const bytes = new Uint8Array(4);
    source.fill(bytes);
    return new DataView(bytes.buffer).getUint32(0) / 2 ** 32;
  };
  const alphabet = ["가", "나", "다", "라", "마"];
  for (let round = 0; round < 300; round++) {
    const pick = () =>
      Array.from(
        { length: Math.floor(next() * 14) },
        () => alphabet[Math.floor(next() * alphabet.length)],
      );
    const before = pick();
    const after = pick();
    const blocks = diffBlocks(before, after);
    assertEquals(apply(before, after, blocks), after, `${before} -> ${after}`);
    assertEquals(size(blocks), lcsDistance(before, after));
    for (const block of blocks) {
      assert(
        block.delete_end > block.delete_start ||
          block.insert_end > block.insert_start,
      );
    }
  }
});

Deno.test("documents/outline-and-search#R21: 계산 한도를 넘으면 구간 전체를 한 block으로 두고 적용하면 여전히 뒤 목록이 된다", () => {
  const before = Array.from({ length: 60 }, (_, i) => `앞 ${i}`);
  const after = Array.from({ length: 60 }, (_, i) => `뒤 ${i}`);
  // 한도 안: 줄이 하나도 같지 않으므로 거리 120이다. 한도 10이면 구간 전체가 한 block이다.
  const bounded = diffBlocks(before, after, 10);
  assertEquals(bounded, [{
    delete_start: 0,
    delete_end: 60,
    insert_start: 0,
    insert_end: 60,
  }]);
  assertEquals(apply(before, after, bounded), after);
  // 앞뒤 공통 줄은 한도와 무관하게 걷어 낸다.
  const wrapped = diffBlocks(["머리", ...before, "꼬리"], [
    "머리",
    ...after,
    "꼬리",
  ], 10);
  assertEquals(wrapped, [{
    delete_start: 1,
    delete_end: 61,
    insert_start: 1,
    insert_end: 61,
  }]);
});

Deno.test("documents/outline-and-search#R21: 큰 목록의 작은 수정은 한도 안에서 최소로 나온다", () => {
  const before = Array.from({ length: 5000 }, (_, i) => `줄 ${i}`);
  const after = [...before];
  after[1200] = "바뀐 줄";
  after.splice(3000, 0, "끼운 줄");
  const blocks = diffBlocks(before, after);
  assertEquals(blocks, [
    {
      delete_start: 1200,
      delete_end: 1201,
      insert_start: 1200,
      insert_end: 1201,
    },
    {
      delete_start: 3000,
      delete_end: 3000,
      insert_start: 3000,
      insert_end: 3001,
    },
  ]);
});

Deno.test("documents/outline-and-search#R21: 응답은 변경 block 경계에서 끊고 block 하나가 예산을 넘으면 줄 단위로 이어 간다", () => {
  const blocks: DiffBlock[] = [
    { delete_start: 0, delete_end: 2, insert_start: 0, insert_end: 1 },
    { delete_start: 5, delete_end: 5, insert_start: 4, insert_end: 6 },
    { delete_start: 9, delete_end: 12, insert_start: 10, insert_end: 10 },
  ];
  const { lines, ends } = changeLines(blocks);
  assertEquals(lines.length, 3 + 2 + 3);
  assertEquals(ends, [3, 5, 8]);
  const cost = () => 4;
  // 한 줄이 5(4+1)를 차지한다. 예산 12면 두 줄까지 들어가지만 block 경계(3)는 못 닿아
  // block이 하나도 못 끝나므로 줄 단위로 끊는다.
  assertEquals(pageEnd(lines, ends, 0, cost, 12), 2);
  // 예산 20이면 첫 block(3줄)은 들어가고 둘째 block의 줄이 넘치므로 경계 3에서 끊는다.
  assertEquals(pageEnd(lines, ends, 0, cost, 20), 3);
  // 이어 읽기는 그 위치에서 다시 시작해 둘째 block 전체(2줄)를 담는다.
  assertEquals(pageEnd(lines, ends, 3, cost, 20), 5);
  // 끝까지 들어가면 전체다.
  assertEquals(pageEnd(lines, ends, 0, cost, 1000), 8);
  // 줄 수 한도.
  assertEquals(pageEnd(lines, ends, 0, cost, 1000, 2), 2);
  // 항상 하나는 담아 이어 읽기가 멈추지 않는다.
  assertEquals(pageEnd(lines, ends, 0, () => 50, 10), 1);
});

Deno.test("documents/outline-and-search#R21: 이어 읽으면 겹침과 누락 없이 모든 변경 줄에 닿는다", () => {
  const before = Array.from({ length: 400 }, (_, i) => `앞 줄 ${i}`);
  const after = before.map((line, i) => (i % 3 === 0 ? `${line} 수정` : line));
  const blocks = diffBlocks(before, after);
  const { lines, ends } = changeLines(blocks);
  const seen: string[] = [];
  let start = 0;
  let pages = 0;
  while (start < lines.length) {
    const end = pageEnd(lines, ends, start, () => 10, 120, 7);
    assert(end > start);
    for (const line of lines.slice(start, end)) {
      seen.push(`${line.side}:${line.index}`);
    }
    start = end;
    pages += 1;
  }
  assert(pages > 1);
  assertEquals(
    seen,
    lines.map((line) => `${line.side}:${line.index}`),
  );
});

Deno.test("documents/outline-and-search#R21: 연속한 줄 번호만 한 범위로 묶는다", () => {
  assertEquals(groupRuns([]), []);
  assertEquals(groupRuns([3, 4, 5, 9, 11, 12]), [
    { start: 3, end: 5 },
    { start: 9, end: 9 },
    { start: 11, end: 12 },
  ]);
});

Deno.test("documents/outline-and-search#R21: diff cursor는 판·section이 다르면 invalid_input, 원문이 바뀌면 conflict다", () => {
  const binding = {
    before: "ver_a",
    after: "ver_b",
    section: "계획",
    before_text: "1".repeat(64),
    after_text: "2".repeat(64),
  };
  const cursor = encodeDiffCursor(binding, 17);
  const same = decodeDiffCursor(cursor, binding);
  assert(same.ok);
  assertEquals(same.value, 17);
  for (
    const other of [
      { ...binding, before: "ver_c" },
      { ...binding, after: "ver_c" },
      { ...binding, section: null },
    ]
  ) {
    const rejected = decodeDiffCursor(cursor, other);
    assert(!rejected.ok);
    assertEquals(rejected.error.code, "invalid_input");
  }
  const moved = decodeDiffCursor(cursor, {
    ...binding,
    after_text: "3".repeat(64),
  });
  assert(!moved.ok);
  assertEquals(moved.error.code, "conflict");
  const broken = decodeDiffCursor("not-a-cursor", binding);
  assert(!broken.ok);
  assertEquals(broken.error.code, "invalid_input");
});
