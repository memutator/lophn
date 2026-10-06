// 줄 단위 diff의 순수 계산. 두 고정 판의 줄 목록을 bounded Myers 방식으로 비교해 변경
// block을 낸다(documents/outline-and-search#R21). 파일·SQL·시각이 없다. 호출하는 쪽(reader
// Worker의 diff handler)이 core 밖에서 돌리고, 한 번의 응답은 변경 block 단위로 끊어
// cursor로 이어 읽는다. 없는 줄을 지어내지 않는다: 계산 한도를 넘은 구간은 줄 수준의
// 일치를 찾지 못한 채 "앞 구간 전부 삭제 + 뒤 구간 전부 추가"인 한 block이다(적용하면 같은
// 결과가 되는 올바른 diff이고 최소가 아닐 뿐이다).
import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import { z } from "zod";

// 앞뒤 공통 줄을 걷어 낸 뒤 Myers가 탐색하는 최대 편집 거리. trace가 D² 정수라 한도가 있다.
export const MYERS_MAX_EDIT_DISTANCE = 1024;
// 탐색 단계(대각선 하나를 한 번 보거나 같은 줄을 한 칸 지나는 것) 수의 한도. 거리가 한도
// 안이어도 줄이 아주 많은 판이 한 응답을 오래 붙잡지 못하게 한다.
export const MYERS_MAX_STEPS = 20_000_000;
// 한 응답이 싣는 본문 codepoint 예산(`documents/read`와 같은 12,000)과 변경 줄 수 한도.
export const DIFF_PAGE_CODEPOINTS = 12000;
export const DIFF_PAGE_MAX_LINES = 1000;

// 두 줄 목록 사이의 변경 block. 0-based 반열린 구간이다: before[delete_start, delete_end)가
// 지워지고 after[insert_start, insert_end)가 그 자리에 들어간다. 둘 중 하나는 비어 있을 수 있다.
export type DiffBlock = {
  delete_start: number;
  delete_end: number;
  insert_start: number;
  insert_end: number;
};

type Edit = { kind: "delete" | "insert"; x: number; y: number };

function intern(
  before: readonly string[],
  after: readonly string[],
): { a: Int32Array; b: Int32Array } {
  const ids = new Map<string, number>();
  const idOf = (line: string) => {
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    return id;
  };
  return {
    a: Int32Array.from(before, idOf),
    b: Int32Array.from(after, idOf),
  };
}

// 편집 경로(앞에서 뒤로). 한도를 넘으면 null이다.
function myersEdits(
  a: Int32Array,
  b: Int32Array,
  from: { a: number; b: number },
  to: { a: number; b: number },
  maxEditDistance: number,
  maxSteps: number,
): Edit[] | null {
  const n = to.a - from.a;
  const m = to.b - from.b;
  const max = Math.min(n + m, maxEditDistance);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let steps = 0;
  for (let d = 0; d <= max; d++) {
    // 이 d 단계가 읽는 이전 단계(d-1)의 v. k는 [-d, d] 범위만 쓴다.
    trace.push(v.slice(offset - d, offset + d + 1));
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[from.a + x] === b[from.b + y]) {
        x += 1;
        y += 1;
        steps += 1;
      }
      steps += 1;
      if (steps > maxSteps) return null;
      v[offset + k] = x;
      if (x >= n && y >= m) return backtrack(trace, n, m, d);
    }
  }
  return null;
}

function backtrack(
  trace: readonly Int32Array[],
  n: number,
  m: number,
  distance: number,
): Edit[] {
  const edits: Edit[] = [];
  let x = n;
  let y = m;
  for (let d = distance; d > 0; d--) {
    const previous = trace[d];
    const k = x - y;
    const down = k === -d ||
      (k !== d && previous[k - 1 + d] < previous[k + 1 + d]);
    const previousK = down ? k + 1 : k - 1;
    const previousX = previous[previousK + d];
    const previousY = previousX - previousK;
    edits.push(
      down
        ? { kind: "insert", x: previousX, y: previousY }
        : { kind: "delete", x: previousX, y: previousY },
    );
    x = previousX;
    y = previousY;
  }
  return edits.reverse();
}

// 두 줄 목록의 변경 block. 앞뒤의 공통 줄을 먼저 걷어 내고 나머지를 Myers로 비교한다.
export function diffBlocks(
  before: readonly string[],
  after: readonly string[],
  maxEditDistance = MYERS_MAX_EDIT_DISTANCE,
  maxSteps = MYERS_MAX_STEPS,
): DiffBlock[] {
  let head = 0;
  while (
    head < before.length && head < after.length && before[head] === after[head]
  ) head += 1;
  let tail = 0;
  while (
    tail < before.length - head && tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) tail += 1;
  const from = { a: head, b: head };
  const to = { a: before.length - tail, b: after.length - tail };
  if (from.a === to.a && from.b === to.b) return [];
  if (from.a === to.a || from.b === to.b) {
    return [{
      delete_start: from.a,
      delete_end: to.a,
      insert_start: from.b,
      insert_end: to.b,
    }];
  }
  const { a, b } = intern(before, after);
  const edits = myersEdits(a, b, from, to, maxEditDistance, maxSteps);
  if (edits === null) {
    // 거리나 탐색 한도를 넘었다. 줄 수준 일치를 찾지 못한 구간 전체가 한 block이다.
    return [{
      delete_start: from.a,
      delete_end: to.a,
      insert_start: from.b,
      insert_end: to.b,
    }];
  }
  const blocks: DiffBlock[] = [];
  let current: DiffBlock | undefined;
  // 직전 편집이 끝난 자리. 다음 편집이 거기서 이어지면(사이에 같은 줄이 없으면) 같은 block이다.
  let endX = -1;
  let endY = -1;
  for (const edit of edits) {
    const x = from.a + edit.x;
    const y = from.b + edit.y;
    if (current === undefined || x !== endX || y !== endY) {
      current = {
        delete_start: x,
        delete_end: x,
        insert_start: y,
        insert_end: y,
      };
      blocks.push(current);
    }
    if (edit.kind === "delete") {
      current.delete_end = x + 1;
      endX = x + 1;
      endY = y;
    } else {
      current.insert_end = y + 1;
      endX = x;
      endY = y + 1;
    }
  }
  return blocks;
}

// 변경 줄 하나. block 안에서는 삭제가 먼저고 추가가 뒤다.
export type ChangeLine = { side: "delete" | "insert"; index: number };

export function changeLines(blocks: readonly DiffBlock[]): {
  lines: ChangeLine[];
  // 각 block이 끝나는 flat 위치(반열린). 이어 읽기가 block 경계에서 끊을 때 쓴다.
  ends: number[];
} {
  const lines: ChangeLine[] = [];
  const ends: number[] = [];
  for (const block of blocks) {
    for (let i = block.delete_start; i < block.delete_end; i++) {
      lines.push({ side: "delete", index: i });
    }
    for (let i = block.insert_start; i < block.insert_end; i++) {
      lines.push({ side: "insert", index: i });
    }
    ends.push(lines.length);
  }
  return { lines, ends };
}

// start부터 한 응답이 싣는 끝 위치(반열린). 가능하면 변경 block 경계에서 끊고, block 하나가
// 예산을 넘으면 줄 단위로 끊어 다음 응답이 이어 간다. 항상 하나는 담아 이어 읽기가 멈추지
// 않게 한다. cost는 그 줄이 예산에서 차지하는 codepoint 수다.
export function pageEnd(
  lines: readonly ChangeLine[],
  ends: readonly number[],
  start: number,
  cost: (line: ChangeLine) => number,
  budget = DIFF_PAGE_CODEPOINTS,
  maxLines = DIFF_PAGE_MAX_LINES,
): number {
  let used = 0;
  let boundary = start;
  let blockAt = 0;
  while (blockAt < ends.length && ends[blockAt] <= start) blockAt += 1;
  let index = start;
  for (; index < lines.length; index++) {
    const weight = cost(lines[index]) + 1;
    if (
      index > start && (used + weight > budget || index - start >= maxLines)
    ) {
      return boundary > start ? boundary : index;
    }
    used += weight;
    while (blockAt < ends.length && ends[blockAt] <= index + 1) {
      if (ends[blockAt] === index + 1) boundary = index + 1;
      blockAt += 1;
    }
  }
  return lines.length;
}

// 연속한 줄 번호를 하나의 범위로 묶는다. numbers는 오름차순이다.
export function groupRuns(
  numbers: readonly number[],
): { start: number; end: number }[] {
  const runs: { start: number; end: number }[] = [];
  for (const number of numbers) {
    const last = runs[runs.length - 1];
    if (last !== undefined && number === last.end + 1) last.end = number;
    else runs.push({ start: number, end: number });
  }
  return runs;
}

// diff 이어 읽기 cursor. 두 판·선택한 section·두 원문 hash와 변경 줄 위치에 묶인다.
// 판·section이 다른 cursor는 invalid_input, 원문이 바뀌어 basis를 못 지키면 conflict다.
const diffCursorSchema = z.object({
  diff: z.object({
    before: z.string(),
    after: z.string(),
    section: z.string().nullable(),
    before_text: z.string(),
    after_text: z.string(),
    position: z.number().int().nonnegative(),
  }),
});

export type DiffBinding = {
  before: string;
  after: string;
  section: string | null;
  before_text: string;
  after_text: string;
};

export function encodeDiffCursor(
  binding: DiffBinding,
  position: number,
): string {
  const bytes = new TextEncoder().encode(
    canonicalize({ diff: { ...binding, position } }),
  );
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function decodeDiffCursor(
  cursor: string,
  current: DiffBinding,
): Result<number> {
  try {
    const bytes = Uint8Array.from(atob(cursor), (char) => char.charCodeAt(0));
    const parsed = diffCursorSchema.safeParse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    if (!parsed.success) return invalidCursor();
    const read = parsed.data.diff;
    if (
      read.before !== current.before || read.after !== current.after ||
      read.section !== current.section
    ) return invalidCursor();
    if (
      read.before_text !== current.before_text ||
      read.after_text !== current.after_text
    ) {
      return err({ code: "conflict", message: "diff basis advanced" });
    }
    return ok(read.position);
  } catch {
    return invalidCursor();
  }
}

function invalidCursor(): Result<never> {
  return err({ code: "invalid_input", message: "invalid diff cursor" });
}
