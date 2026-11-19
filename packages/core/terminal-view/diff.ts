// 화면 diff: core가 바로 앞에 읽은 화면과 지금 화면을 비교해 `TerminalScreenChanged`에 싣는다(`protocol/coding-agent/terminal-view.ts`).
import type { TerminalScreenDiff } from "../../protocol/coding-agent/terminal-view.ts";
import type { TerminalScreen } from "../terminals/ports.ts";

// diff 하나의 JSON 길이 상한. 넘으면 diff를 싣지 않고 보는 쪽이 snapshot을 읽는다(화면 한 번 통째로 다시 그리는 TUI가 연결을 채우지 않게).
export const MAX_DIFF_CHARS = 12_000;
// 이 안이면 키 입력의 echo 같은 작은 변화라 곧 이어질 출력을 빠르게 읽는다.
export const SMALL_DIFF_CHARS = 3_000;

const same = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);

/** 같은 generation·크기·scrollback이고 diff가 상한 안이면 diff, 아니면 null(보는 쪽이 snapshot을 읽는다). */
export function diffScreen(
  before: TerminalScreen | undefined,
  after: TerminalScreen,
): { diff: TerminalScreenDiff; chars: number } | null {
  if (
    before === undefined ||
    before.generation !== after.generation ||
    before.columns !== after.columns ||
    before.rows !== after.rows ||
    before.seq >= after.seq ||
    before.lines.length !== after.lines.length ||
    before.scrollback.length !== after.scrollback.length
  ) {
    return null;
  }
  for (let at = 0; at < after.scrollback.length; at += 1) {
    if (!same(before.scrollback[at], after.scrollback[at])) return null;
  }
  const lines: TerminalScreenDiff["lines"] = [];
  let chars = 0;
  for (let row = 0; row < after.lines.length; row += 1) {
    const line = after.lines[row]!;
    if (same(before.lines[row], line)) continue;
    const one = { row, ...line };
    chars += JSON.stringify(one).length;
    if (chars > MAX_DIFF_CHARS) return null;
    lines.push(one);
  }
  return {
    diff: {
      generation: after.generation,
      base_seq: before.seq,
      cursor: after.cursor,
      lines,
    },
    chars,
  };
}
