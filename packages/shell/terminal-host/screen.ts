// 재연결용 화면. raw 출력을 쌓아 다시 재생하지 않고, headless xterm이 파싱한 화면(scrollback 포함)을 두었다가
// 직렬화해 준다. raw를 한도까지 쌓으면 history를 한 번만 쓰고 그 뒤로 아래 viewport만 고쳐 그리는 TUI(omp는
// 초당 30여 chunk)가 몇 분 만에 한도를 채워 처음 그린 history를 밀어내고, 다시 붙은 화면이 빈다.
// disk·ledger·blob·log에 쓰지 않는다.

/// <reference path="./addon-serialize.d.ts" />
/// <reference path="./addon-unicode11.d.ts" />
import serialize from "@xterm/addon-serialize/lib/addon-serialize.js";
import unicode11 from "@xterm/addon-unicode11/lib/addon-unicode11.js";
import headless from "@xterm/headless";
import type { TerminalLine, TerminalScreen } from "../ipc/terminal.ts";

/** renderer xterm의 scrollback과 같다. 그보다 오래된 줄은 보이는 화면에도 없다. */
const SCROLLBACK = 10_000;

// serialize는 mouse tracking(?1000·1002·1003)은 되살리지만 report 인코딩은 빠뜨린다. 그러면 다시 붙은 xterm이
// 기본 X10으로 보내고, X10 report는 onData가 아닌 onBinary로 나가 TUI(Claude Code, OpenCode)가 mouse를 하나도
// 못 받는다. 커서 숨김(?25l)도 빠뜨려 TUI 위에 커서가 남는다. 둘은 출력에서 직접 따라간다.
const MOUSE_ENCODINGS = [1005, 1006, 1015, 1016];

export class Screen {
  readonly #term: headless.Terminal;
  readonly #serializer: serialize.SerializeAddon;
  #seq = 0;
  #disposed = false;
  #mouseEncoding: number | null = null;
  #cursorHidden = false;

  constructor(columns: number, rows: number) {
    this.#term = new headless.Terminal({
      cols: columns,
      rows,
      scrollback: SCROLLBACK,
      allowProposedApi: true,
    });
    this.#serializer = new serialize.SerializeAddon();
    this.#term.loadAddon(this.#serializer);
    // 글자 폭은 renderer xterm과 같아야 다시 붙은 화면의 칸이 맞는다.
    this.#term.loadAddon(new unicode11.Unicode11Addon());
    this.#term.unicode.activeVersion = "11";
    const track = (set: boolean) => (params: (number | number[])[]) => {
      for (const param of params) {
        if (typeof param !== "number") continue;
        if (param === 25) this.#cursorHidden = !set;
        else if (MOUSE_ENCODINGS.includes(param)) {
          if (set) this.#mouseEncoding = param;
          else if (this.#mouseEncoding === param) this.#mouseEncoding = null;
        }
      }
      return false;
    };
    this.#term.parser.registerCsiHandler(
      { prefix: "?", final: "h" },
      track(true),
    );
    this.#term.parser.registerCsiHandler(
      { prefix: "?", final: "l" },
      track(false),
    );
    this.#term.parser.registerEscHandler({ final: "c" }, () => {
      this.#mouseEncoding = null;
      this.#cursorHidden = false;
      return false;
    });
  }

  /** scrollback 한도를 넘어 가장 오래된 줄을 버리기 시작했다. 파싱이 따라온 만큼만 안다. */
  get dropped(): boolean {
    if (this.#disposed) return false;
    const normal = this.#term.buffer.normal;
    return normal.length >= this.#term.rows + SCROLLBACK;
  }

  push(text: string): number {
    this.#seq += 1;
    if (!this.#disposed) this.#term.write(text);
    return this.#seq;
  }

  /** 앞서 쓴 출력은 옛 크기로 파싱한 뒤에 바꾼다. 그 뒤 출력이 새 크기로 그려졌기 때문이다. */
  resize(columns: number, rows: number): void {
    if (this.#disposed) return;
    this.#term.write("", () => {
      if (!this.#disposed) this.#term.resize(columns, rows);
    });
  }

  /**
   * 지금까지 push한 출력을 모두 파싱한 화면. seq는 그 마지막 chunk라 받는 쪽은 그 뒤 출력만 이어 쓴다.
   * write 큐는 순서대로 돌고 callback은 앞 chunk 바로 뒤에 불리므로, 그 안의 직렬화는 seq까지만 담는다.
   */
  snapshot(): Promise<{ seq: number; text: string }> {
    const seq = this.#seq;
    if (this.#disposed) return Promise.resolve({ seq, text: "" });
    return new Promise((resolve) => {
      this.#term.write("", () => {
        if (this.#disposed) return resolve({ seq, text: "" });
        const buffer = this.#term.buffer.active;
        // 줄 끝까지 쓴 줄(wrap 대기)에서 addon이 cursor를 한 칸 틀리게 돌린다. 절대 위치로 다시 둔다.
        const cursor = `\x1b[${buffer.cursorY + 1};${buffer.cursorX + 1}H`;
        const modes =
          (this.#mouseEncoding === null
            ? ""
            : `\x1b[?${this.#mouseEncoding}h`) +
          (this.#cursorHidden ? "\x1b[?25l" : "");
        resolve({
          seq,
          text:
            this.#serializer.serialize({ scrollback: SCROLLBACK }) +
            modes +
            cursor,
        });
      });
    });
  }

  /**
   * 지금까지 push한 출력을 모두 파싱한 화면을 서식 run의 줄로 준다(폰의 터미널 보기). viewport 전체와 그 위
   * scrollback의 마지막 tail줄이다. seq를 맞추는 방법은 `snapshot()`과 같다. 닫힌 화면이면 null이다.
   */
  screen(tail: number): Promise<TerminalScreen | null> {
    const seq = this.#seq;
    if (this.#disposed) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.#term.write("", () => {
        if (this.#disposed) return resolve(null);
        const term = this.#term;
        const buffer = term.buffer.active;
        const cell = buffer.getNullCell();
        const read = (from: number, to: number) => {
          const lines: TerminalLine[] = [];
          for (let y = from; y < to; y++) {
            const line = buffer.getLine(y);
            lines.push({
              runs: line ? runsOf(line, term.cols, cell) : [],
              // xterm은 이어지는 쪽(아래 줄)에 표시한다. 계약은 이어 주는 쪽(위 줄)에 둔다.
              wrapped: buffer.getLine(y + 1)?.isWrapped ?? false,
            });
          }
          return lines;
        };
        const base = buffer.baseY;
        resolve({
          seq,
          columns: term.cols,
          rows: term.rows,
          cursor: {
            // 줄 끝까지 쓴 줄(wrap 대기)에서는 cursorX가 columns다.
            x: Math.min(buffer.cursorX, term.cols - 1),
            y: buffer.cursorY,
            hidden: this.#cursorHidden,
          },
          scrollback: read(Math.max(0, base - tail), base),
          lines: read(base, base + term.rows),
        });
      });
    });
  }

  /** 닫힌 탭은 힙에 출력을 남기지 않는다. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#term.dispose();
  }
}

type Run = TerminalLine["runs"][number];
const FLAGS = [
  "bold",
  "dim",
  "italic",
  "underline",
  "inverse",
  "wide",
] as const;

function colorOf(rgb: boolean, palette: boolean, value: number) {
  if (rgb) return `#${value.toString(16).padStart(6, "0")}`;
  if (palette) return `p${value}`;
  return undefined;
}

/** 서식이 같은 칸을 이은 run들. 줄 끝의 빈 칸(글자도 배경도 없는 것)은 버려 빈 줄은 run이 없다. */
function runsOf(
  line: headless.IBufferLine,
  columns: number,
  cell: headless.IBufferCell,
): Run[] {
  const runs: Run[] = [];
  let key = "";
  // 마지막으로 보이는 칸까지의 run 수와 그 run의 글 길이. 그 뒤 빈 칸을 잘라 낸다.
  let keepRuns = 0;
  let keepLength = 0;
  for (let x = 0; x < columns; x++) {
    if (!line.getCell(x, cell)) break;
    const width = cell.getWidth();
    // 폭 2 글자의 뒤 칸이다. 글자는 앞 칸이 갖는다.
    if (width === 0) continue;
    const chars = cell.getChars();
    const fg = colorOf(cell.isFgRGB(), cell.isFgPalette(), cell.getFgColor());
    const bg = colorOf(cell.isBgRGB(), cell.isBgPalette(), cell.getBgColor());
    const flags = [
      cell.isBold(),
      cell.isDim(),
      cell.isItalic(),
      cell.isUnderline(),
      cell.isInverse(),
      width === 2,
    ].map(Boolean);
    const next = `${fg}|${bg}|${flags.join()}`;
    if (runs.length === 0 || next !== key) {
      const run: Run = { text: "" };
      if (fg !== undefined) run.fg = fg;
      if (bg !== undefined) run.bg = bg;
      FLAGS.forEach((name, i) => {
        if (flags[i]) run[name] = true;
      });
      runs.push(run);
      key = next;
    }
    const run = runs.at(-1)!;
    run.text += chars || " ";
    if (chars !== "" || bg !== undefined || run.inverse) {
      keepRuns = runs.length;
      keepLength = run.text.length;
    }
  }
  runs.length = keepRuns;
  if (keepRuns > 0)
    runs[keepRuns - 1]!.text = runs[keepRuns - 1]!.text.slice(0, keepLength);
  return runs;
}
