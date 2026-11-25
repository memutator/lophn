import assert from "node:assert/strict";
import { test } from "node:test";
import { applyScreenDiff } from "../../protocol/coding-agent/terminal-view.ts";
import type { TerminalScreen } from "../terminals/ports.ts";
import { diffScreen, MAX_DIFF_CHARS } from "./diff.ts";

const line = (text: string) => ({ runs: [{ text }], wrapped: false });
const screen = (seq: number, rows: string[], scrollback: string[] = []) =>
  ({
    generation: 1,
    seq,
    columns: 80,
    rows: rows.length,
    cursor: { x: 0, y: 0, hidden: false },
    scrollback: scrollback.map(line),
    lines: rows.map(line),
  }) satisfies TerminalScreen;

// diff를 적용한 화면이 core의 화면과 다르면 보는 쪽이 조용히 틀린 글을 보인다. 말할 수 없는 변화는 null이어야 snapshot으로 맞춘다.
test("diff를 적용하면 지금 화면이 되고, scrollback·크기·generation이 바뀌면 diff가 없다", () => {
  const before = screen(1, ["$ l", "", "x"]);
  const after = {
    ...screen(2, ["$ ls", "", "x"]),
    cursor: { x: 4, y: 0, hidden: false },
  };
  const diffed = diffScreen(before, after);
  assert.deepEqual(
    diffed?.diff.lines.map((one) => one.row),
    [0],
  );
  const applied = applyScreenDiff(before, 2, diffed!.diff);
  assert.deepEqual(applied, after);

  // 보는 쪽이 base가 아닌 화면을 가졌으면 적용하지 않는다.
  assert.equal(applyScreenDiff(screen(5, ["", "", ""]), 6, diffed!.diff), null);
  assert.equal(
    applyScreenDiff({ ...before, generation: 2 }, 2, diffed!.diff),
    null,
  );

  assert.equal(diffScreen(before, screen(2, ["$ ls", "", "x"], ["old"])), null);
  assert.equal(diffScreen(before, screen(2, ["$ ls", "x"])), null);
  assert.equal(diffScreen(before, { ...after, generation: 2 }), null);
  assert.equal(diffScreen(undefined, after), null);
  const big = screen(2, ["a".repeat(MAX_DIFF_CHARS + 1_000), "", ""]);
  assert.equal(diffScreen(before, big), null);
});
