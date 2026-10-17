// 충돌 해결 화면의 줄 비교. 옛 쪽은 디스크(또는 최신 판), 새 쪽은 편집기 초안이다.
// 앞뒤 같은 줄을 떼고 가운데만 LCS로 맞춘다. 가운데가 너무 크면 통째로 지우고 더한 것으로 본다.
import type { DiffLine } from "@lophn/ui/reading";

/** 가운데 LCS 표의 칸 상한. 넘으면 통째 바꿈으로 보인다. */
const CELL_LIMIT = 4_000_000;

function linesOf(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

export function compareLines(theirs: string, mine: string): DiffLine[] {
  const before = linesOf(theirs);
  const after = linesOf(mine);
  let head = 0;
  while (
    head < before.length && head < after.length &&
    before[head] === after[head]
  ) head += 1;
  let tail = 0;
  while (
    tail < before.length - head && tail < after.length - head &&
    before[before.length - 1 - tail] === after[after.length - 1 - tail]
  ) tail += 1;
  const out: DiffLine[] = [];
  for (let index = 0; index < head; index += 1) {
    out.push({
      kind: "same",
      oldNumber: index + 1,
      newNumber: index + 1,
      text: before[index]!,
    });
  }
  const oldMid = before.slice(head, before.length - tail);
  const newMid = after.slice(head, after.length - tail);
  for (const line of middle(oldMid, newMid)) {
    out.push({
      ...line,
      ...(line.oldNumber === undefined
        ? {}
        : { oldNumber: line.oldNumber + head }),
      ...(line.newNumber === undefined
        ? {}
        : { newNumber: line.newNumber + head }),
    });
  }
  for (let index = 0; index < tail; index += 1) {
    const oldAt = before.length - tail + index;
    const newAt = after.length - tail + index;
    out.push({
      kind: "same",
      oldNumber: oldAt + 1,
      newNumber: newAt + 1,
      text: before[oldAt]!,
    });
  }
  return out;
}

function middle(before: string[], after: string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;
  if (n === 0 || m === 0 || n * m > CELL_LIMIT) {
    return [
      ...before.map((text, index): DiffLine => ({
        kind: "delete",
        oldNumber: index + 1,
        text,
      })),
      ...after.map((text, index): DiffLine => ({
        kind: "add",
        newNumber: index + 1,
        text,
      })),
    ];
  }
  // 뒤에서부터 LCS 길이 표.
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] = before[i] === after[j]
        ? table[(i + 1) * width + j + 1]! + 1
        : Math.max(table[(i + 1) * width + j]!, table[i * width + j + 1]!);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({
        kind: "same",
        oldNumber: i + 1,
        newNumber: j + 1,
        text: before[i]!,
      });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j]! >= table[i * width + j + 1]!) {
      out.push({ kind: "delete", oldNumber: i + 1, text: before[i]! });
      i += 1;
    } else {
      out.push({ kind: "add", newNumber: j + 1, text: after[j]! });
      j += 1;
    }
  }
  for (; i < n; i += 1) {
    out.push({ kind: "delete", oldNumber: i + 1, text: before[i]! });
  }
  for (; j < m; j += 1) {
    out.push({ kind: "add", newNumber: j + 1, text: after[j]! });
  }
  return out;
}
