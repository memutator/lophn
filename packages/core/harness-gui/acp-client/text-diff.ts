// Bounded Myers line diff and minimal unified patch formatter for ACP full-file diffs.
// ACP ToolCallContent::Diff sends full-file oldText and newText rather than hunks;
// counting lines directly reports whole-file +N/-M and breaks diff previews on large files.

const MAX_EDITS = 2_000;
const CONTEXT_LINES = 3;

type Op =
  | {
      readonly kind: "same";
      readonly oldNo: number;
      readonly newNo: number;
      readonly text: string;
    }
  | { readonly kind: "delete"; readonly oldNo: number; readonly text: string }
  | { readonly kind: "add"; readonly newNo: number; readonly text: string };

export type TextDiffResult = {
  readonly added: number;
  readonly removed: number;
  readonly patch: string | null;
};

function splitLines(text: string): string[] {
  if (text === "") return [];
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Myers O((N+M)D) edit script on the changed middle window, bounded by MAX_EDITS. */
function diffMiddle(
  a: readonly string[],
  b: readonly string[],
  oldBase: number,
  newBase: number,
): Op[] {
  const n = a.length;
  const m = b.length;
  if (n === 0) {
    return b.map((text, idx) => ({ kind: "add", newNo: newBase + idx, text }));
  }
  if (m === 0) {
    return a.map((text, idx) => ({
      kind: "delete",
      oldNo: oldBase + idx,
      text,
    }));
  }

  const maxD = Math.min(n + m, MAX_EDITS);
  const offset = maxD;
  const v = new Int32Array(2 * maxD + 1);
  // trace[d] stores v_{d-1} on diagonals -(d-1)..(d-1) for d >= 1.
  const trace: Int32Array[] = [new Int32Array(0)];

  let foundD = -1;
  for (let d = 0; d <= maxD; d += 1) {
    if (d > 0) {
      trace.push(v.slice(offset - (d - 1), offset + (d - 1) + 1));
    }
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1]! < v[offset + k + 1]!)) {
        x = v[offset + k + 1]!;
      } else {
        x = v[offset + k - 1]! + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        foundD = d;
        break;
      }
    }
    if (foundD !== -1) break;
  }

  if (foundD === -1) {
    return [
      ...a.map(
        (text, idx): Op => ({ kind: "delete", oldNo: oldBase + idx, text }),
      ),
      ...b.map(
        (text, idx): Op => ({ kind: "add", newNo: newBase + idx, text }),
      ),
    ];
  }

  const reversed: Op[] = [];
  let x = n;
  let y = m;
  for (let d = foundD; d >= 1; d -= 1) {
    const prev = trace[d]!;
    const shift = d - 1;
    const k = x - y;
    const prevK =
      k === -d || (k !== d && prev[k - 1 + shift]! < prev[k + 1 + shift]!)
        ? k + 1
        : k - 1;
    const prevX = prev[prevK + shift]!;
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      reversed.push({
        kind: "same",
        oldNo: oldBase + x,
        newNo: newBase + y,
        text: a[x]!,
      });
    }
    if (x === prevX) {
      y -= 1;
      reversed.push({ kind: "add", newNo: newBase + y, text: b[y]! });
    } else {
      x -= 1;
      reversed.push({ kind: "delete", oldNo: oldBase + x, text: a[x]! });
    }
  }
  while (x > 0 && y > 0) {
    x -= 1;
    y -= 1;
    reversed.push({
      kind: "same",
      oldNo: oldBase + x,
      newNo: newBase + y,
      text: a[x]!,
    });
  }
  reversed.reverse();
  return reversed;
}

function formatHunks(
  oldLines: readonly string[],
  newLines: readonly string[],
  head: number,
  midOps: readonly Op[],
  tail: number,
): string | null {
  const ops: Op[] = [];
  const headStart = Math.max(0, head - CONTEXT_LINES);
  for (let i = headStart; i < head; i += 1) {
    ops.push({ kind: "same", oldNo: i + 1, newNo: i + 1, text: oldLines[i]! });
  }
  for (const op of midOps) ops.push(op);
  const tailKeep = Math.min(tail, CONTEXT_LINES);
  const oldTailStart = oldLines.length - tail;
  const newTailStart = newLines.length - tail;
  for (let i = 0; i < tailKeep; i += 1) {
    ops.push({
      kind: "same",
      oldNo: oldTailStart + i + 1,
      newNo: newTailStart + i + 1,
      text: oldLines[oldTailStart + i]!,
    });
  }

  // Group changed op indices into hunks with CONTEXT_LINES of surrounding context.
  const ranges: { start: number; end: number }[] = [];
  for (let i = 0; i < ops.length; i += 1) {
    if (ops[i]!.kind === "same") continue;
    const start = Math.max(0, i - CONTEXT_LINES);
    const end = Math.min(ops.length - 1, i + CONTEXT_LINES);
    const last = ranges[ranges.length - 1];
    if (last !== undefined && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }
  if (ranges.length === 0) return null;

  const parts: string[] = [];
  for (const { start, end } of ranges) {
    const slice = ops.slice(start, end + 1);
    let oldCount = 0;
    let newCount = 0;
    let firstOld: number | null = null;
    let firstNew: number | null = null;
    const body: string[] = [];
    for (const op of slice) {
      if (op.kind === "same") {
        if (firstOld === null) firstOld = op.oldNo;
        if (firstNew === null) firstNew = op.newNo;
        oldCount += 1;
        newCount += 1;
        body.push(` ${op.text}`);
      } else if (op.kind === "delete") {
        if (firstOld === null) firstOld = op.oldNo;
        oldCount += 1;
        body.push(`-${op.text}`);
      } else {
        if (firstNew === null) firstNew = op.newNo;
        newCount += 1;
        body.push(`+${op.text}`);
      }
    }
    const oldStart =
      oldCount === 0 ? Math.max(0, (firstNew ?? 1) - 1) : (firstOld ?? 1);
    const newStart =
      newCount === 0 ? Math.max(0, (firstOld ?? 1) - 1) : (firstNew ?? 1);
    parts.push(
      `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${body.join("\n")}`,
    );
  }
  return parts.join("\n");
}

/**
 * Computes exact changed line counts and a minimal unified patch between `oldText` and `newText`.
 * When `oldText` is undefined (new file), all lines of `newText` are counted as additions.
 */
export function computeTextDiff(
  oldText: string | undefined,
  newText: string,
): TextDiffResult {
  const newLines = splitLines(newText);
  if (oldText === undefined || oldText === "") {
    if (newLines.length === 0) return { added: 0, removed: 0, patch: null };
    return {
      added: newLines.length,
      removed: 0,
      patch: `@@ -0,0 +1,${newLines.length} @@\n${newLines.map((line) => `+${line}`).join("\n")}`,
    };
  }
  const oldLines = splitLines(oldText);
  if (newLines.length === 0) {
    if (oldLines.length === 0) return { added: 0, removed: 0, patch: null };
    return {
      added: 0,
      removed: oldLines.length,
      patch: `@@ -1,${oldLines.length} +0,0 @@\n${oldLines.map((line) => `-${line}`).join("\n")}`,
    };
  }

  let head = 0;
  while (
    head < oldLines.length &&
    head < newLines.length &&
    oldLines[head] === newLines[head]
  ) {
    head += 1;
  }
  let tail = 0;
  while (
    tail < oldLines.length - head &&
    tail < newLines.length - head &&
    oldLines[oldLines.length - 1 - tail] ===
      newLines[newLines.length - 1 - tail]
  ) {
    tail += 1;
  }

  if (head + tail === oldLines.length && head + tail === newLines.length) {
    return { added: 0, removed: 0, patch: null };
  }

  const oldMid = oldLines.slice(head, oldLines.length - tail);
  const newMid = newLines.slice(head, newLines.length - tail);
  const midOps = diffMiddle(oldMid, newMid, head + 1, head + 1);

  let added = 0;
  let removed = 0;
  for (const op of midOps) {
    if (op.kind === "add") added += 1;
    else if (op.kind === "delete") removed += 1;
  }

  return {
    added,
    removed,
    patch: formatHunks(oldLines, newLines, head, midOps, tail),
  };
}
