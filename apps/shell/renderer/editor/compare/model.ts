// 버전 비교 화면의 순수 규칙(shell/editor#R13, R14). 줄 diff 계산은 documents가 한다
// (documents/outline-and-search#R21). 여기서는 documents가 준 추가·삭제 줄과 두 판의 대표
// 텍스트(같은 줄 좌표)를 줄 목록으로 맞추고, 접기·나란히 짝·바뀐 절 목록만 정한다.
import type {
  ChangeRun,
  LineSpan,
  SectionEntry,
  VersionDiff,
} from "../versions/source.ts";

/** 나란히 보기는 본문이 이 폭 이상일 때만이다. */
export const SIDE_BY_SIDE_MIN = 1100;
/** 문서가 이 줄 수를 넘으면 절을 골라 그 절만 그린다. */
export const SECTION_PICK_LINES = 5000;
/** 바뀌지 않은 줄이 이만큼보다 길게 이어지면 접는다. */
export const FOLD_OVER = 7;
/** 접힌 구간 앞뒤에 남기는 줄 수. */
export const FOLD_KEEP = 3;

export interface CompareLine {
  readonly kind: "same" | "add" | "delete";
  readonly oldNumber?: number;
  readonly newNumber?: number;
  readonly text: string;
}

export type CompareRow =
  | { readonly kind: "line"; readonly index: number }
  | { readonly kind: "fold"; readonly start: number; readonly count: number };

export type PairRow =
  | {
    readonly kind: "pair";
    readonly old: number | null;
    readonly new: number | null;
  }
  | { readonly kind: "fold"; readonly start: number; readonly count: number };

export function linesOf(text: string): string[] {
  const lines = text.split("\n");
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function byLine(runs: readonly ChangeRun[]): Map<number, string> {
  const found = new Map<number, string>();
  for (const run of runs) {
    const texts = run.text.split("\n");
    for (let at = run.range.start; at <= run.range.end; at += 1) {
      found.set(at, texts[at - run.range.start] ?? "");
    }
  }
  return found;
}

/**
 * documents의 추가·삭제 줄을 두 판 본문과 맞춰 한 줄 목록으로 만든다. 같은 줄은 옛 판에서,
 * 추가 줄은 diff에서 온다. 줄 좌표가 맞지 않으면(지운 줄 글이 옛 판과 다르거나 남는 줄이
 * 생기면) null이다. 그때 화면은 비교를 꾸미지 않고 실패로 보인다.
 */
export function buildLines(
  before: string,
  after: string,
  diff: Pick<VersionDiff, "additions" | "deletions">,
): CompareLine[] | null {
  const old = linesOf(before);
  const next = linesOf(after);
  const deleted = byLine(diff.deletions);
  const added = byLine(diff.additions);
  const out: CompareLine[] = [];
  let i = 1;
  let j = 1;
  while (i <= old.length || j <= next.length) {
    if (deleted.has(i)) {
      if (i > old.length || old[i - 1] !== deleted.get(i)) return null;
      out.push({ kind: "delete", oldNumber: i, text: old[i - 1]! });
      i += 1;
    } else if (added.has(j)) {
      if (j > next.length) return null;
      out.push({ kind: "add", newNumber: j, text: added.get(j)! });
      j += 1;
    } else if (i <= old.length && j <= next.length) {
      if (old[i - 1] !== next[j - 1]) return null;
      out.push({
        kind: "same",
        oldNumber: i,
        newNumber: j,
        text: old[i - 1]!,
      });
      i += 1;
      j += 1;
    } else return null;
  }
  return out;
}

export function identical(lines: readonly CompareLine[]): boolean {
  return lines.every((line) => line.kind === "same");
}

/**
 * 그릴 줄과 접힌 구간. 변경 없는 줄이 7줄 넘게 이어지면 변경 앞뒤 3줄만 남긴다. 범위의 처음이나
 * 끝에 붙은 구간은 변경 쪽 3줄만 남긴다. expanded는 펼친 구간의 시작 index다.
 */
export function foldRows(
  lines: readonly CompareLine[],
  expanded: ReadonlySet<number>,
  fold: boolean,
  from = 0,
  to = lines.length,
): CompareRow[] {
  const rows: CompareRow[] = [];
  let at = from;
  while (at < to) {
    if (lines[at]!.kind !== "same") {
      rows.push({ kind: "line", index: at });
      at += 1;
      continue;
    }
    let end = at;
    while (end < to && lines[end]!.kind === "same") end += 1;
    const length = end - at;
    const leading = at === from;
    const trailing = end === to;
    const keepHead = leading ? 0 : FOLD_KEEP;
    const keepTail = trailing ? 0 : FOLD_KEEP;
    const hidden = length - keepHead - keepTail;
    const start = at + keepHead;
    if (!fold || length <= FOLD_OVER || hidden <= 0 || expanded.has(start)) {
      for (let index = at; index < end; index += 1) {
        rows.push({ kind: "line", index });
      }
    } else {
      for (let index = at; index < start; index += 1) {
        rows.push({ kind: "line", index });
      }
      rows.push({ kind: "fold", start, count: hidden });
      for (let index = start + hidden; index < end; index += 1) {
        rows.push({ kind: "line", index });
      }
    }
    at = end;
  }
  return rows;
}

/** 나란히 보기의 짝. 한 변경 묶음 안에서 지운 줄과 더한 줄을 차례로 맞춘다. */
export function pairRows(
  rows: readonly CompareRow[],
  lines: readonly CompareLine[],
): PairRow[] {
  const out: PairRow[] = [];
  let at = 0;
  while (at < rows.length) {
    const row = rows[at]!;
    if (row.kind === "fold") {
      out.push(row);
      at += 1;
      continue;
    }
    if (lines[row.index]!.kind === "same") {
      out.push({ kind: "pair", old: row.index, new: row.index });
      at += 1;
      continue;
    }
    const deleted: number[] = [];
    const added: number[] = [];
    while (at < rows.length) {
      const next = rows[at]!;
      if (next.kind !== "line" || lines[next.index]!.kind === "same") break;
      (lines[next.index]!.kind === "delete" ? deleted : added).push(
        next.index,
      );
      at += 1;
    }
    for (let k = 0; k < Math.max(deleted.length, added.length); k += 1) {
      out.push({
        kind: "pair",
        old: deleted[k] ?? null,
        new: added[k] ?? null,
      });
    }
  }
  return out;
}

export type SectionDeltaKind = "modified" | "added" | "missing";

/** 바뀐 절 목록의 한 행. */
export interface SectionDelta {
  readonly key: string;
  readonly title: string;
  readonly change: SectionDeltaKind;
  readonly added: number;
  readonly removed: number;
}

function inside(ranges: readonly LineSpan[], line: number | undefined) {
  return line !== undefined &&
    ranges.some((range) => line >= range.start && line <= range.end);
}

/**
 * 두 판의 절을 같은 key로 비교한다(documents의 section 비교와 같은 body_hash 규칙). 이름이 바뀐
 * 절은 소실과 추가다. 소실 행은 살아 있는 행 뒤에 온다. 줄 수는 그 절 자기 범위 안의 추가·삭제다.
 */
export function changedSections(
  before: readonly SectionEntry[],
  after: readonly SectionEntry[],
  lines: readonly CompareLine[],
): SectionDelta[] {
  const old = new Map(before.map((entry) => [entry.key, entry]));
  const kept = new Set(after.map((entry) => entry.key));
  const count = (
    newRanges: readonly LineSpan[],
    oldRanges: readonly LineSpan[],
  ) => ({
    added:
      lines.filter((line) =>
        line.kind === "add" && inside(newRanges, line.newNumber)
      ).length,
    removed:
      lines.filter((line) =>
        line.kind === "delete" && inside(oldRanges, line.oldNumber)
      ).length,
  });
  const out: SectionDelta[] = [];
  for (const entry of after) {
    const previous = old.get(entry.key);
    if (previous && previous.bodyHash === entry.bodyHash) continue;
    out.push({
      key: entry.key,
      title: entry.title,
      change: previous ? "modified" : "added",
      ...count(entry.ownRanges, previous?.ownRanges ?? []),
    });
  }
  for (const entry of before) {
    if (kept.has(entry.key)) continue;
    out.push({
      key: entry.key,
      title: entry.title,
      change: "missing",
      ...count([], entry.ownRanges),
    });
  }
  return out;
}

/** 한 절이 차지하는 줄 목록 index 구간 [from, to). 그 절의 줄이 없으면 null이다. */
export function sectionSlice(
  lines: readonly CompareLine[],
  before: LineSpan | null,
  after: LineSpan | null,
): { from: number; to: number } | null {
  let from = -1;
  let to = -1;
  lines.forEach((line, index) => {
    const hit = (after !== null && line.newNumber !== undefined &&
      line.newNumber >= after.start && line.newNumber <= after.end) ||
      (before !== null && line.oldNumber !== undefined &&
        line.oldNumber >= before.start && line.oldNumber <= before.end);
    if (!hit) return;
    if (from < 0) from = index;
    to = index + 1;
  });
  return from < 0 ? null : { from, to };
}

/** 줄 수가 많아 절을 골라야 하는지. */
export function needsSection(before: string, after: string): boolean {
  return Math.max(linesOf(before).length, linesOf(after).length) >
    SECTION_PICK_LINES;
}

/** 나란히 보기를 할 수 있는지. 폭을 아직 모르면 할 수 없다. */
export function sideBySideFits(width: number | undefined): boolean {
  return width !== undefined && width >= SIDE_BY_SIDE_MIN;
}
