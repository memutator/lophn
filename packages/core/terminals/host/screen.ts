// 재연결용 화면. raw 출력을 쌓아 다시 재생하지 않고, headless xterm이 파싱한 화면(scrollback 포함)을 두었다가
// 직렬화해 준다. raw를 한도까지 쌓으면 history를 한 번만 쓰고 그 뒤로 아래 viewport만 고쳐 그리는 TUI(omp는
// 초당 30여 chunk)가 몇 분 만에 한도를 채워 처음 그린 history를 밀어내고, 다시 붙은 화면이 빈다.
// disk·ledger·blob·log에 쓰지 않는다.

/// <reference path="./addon-serialize.d.ts" />
/// <reference path="./addon-unicode11.d.ts" />
import { createHash } from "node:crypto";
import serialize from "@xterm/addon-serialize/lib/addon-serialize.js";
import unicode11 from "@xterm/addon-unicode11/lib/addon-unicode11.js";
import headless from "@xterm/headless";
import type { TerminalLine } from "../../../protocol/coding-agent/terminal-view.ts";
import {
  TUI_HIGHLIGHTS_MAX,
  TUI_SCROLLBACK_MAX,
  TUI_SNAPSHOT_MAX_BYTES,
  type TerminalModes,
  type TuiCursor,
  type TuiHighlight,
} from "../../../protocol/lophn-agent/terminal-use.ts";
import type { TerminalScreen } from "../ports.ts";

/** renderer xterm의 scrollback과 같다. 그보다 오래된 줄은 보이는 화면에도 없다. */
const SCROLLBACK = 10_000;
/** OSC 52 clipboard 쓰기 최대 크기(디코드 후 1 MiB). */
export const OSC52_MAX_BYTES = 1024 * 1024;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;
const KITTY_STACK_MAX = 64;

/** OSC 52 데이터(`Pc;Pd`)에서 유효한 쓰기 payload의 바이트 길이를 잰다. 읽기(`?`)·빈 값·잘못된 base64·1 MiB 초과는 null이다. */
export function parseOsc52WriteBytes(data: string): number | null {
  const semi = data.indexOf(";");
  if (semi < 0) return null;
  const payload = data.slice(semi + 1).replace(/\s+/g, "");
  if (payload === "" || payload === "?") return null;
  if (payload.length % 4 !== 0 || !BASE64_PATTERN.test(payload)) return null;
  const padding = payload.endsWith("==") ? 2 : payload.endsWith("=") ? 1 : 0;
  const bytes = (payload.length / 4) * 3 - padding;
  if (bytes <= 0 || bytes > OSC52_MAX_BYTES) return null;
  return bytes;
}

// serialize는 mouse tracking(?1000·1002·1003)은 되살리지만 report 인코딩은 빠뜨린다. 그러면 다시 붙은 xterm이
// 기본 X10으로 보내고, X10 report는 onData가 아닌 onBinary로 나가 TUI(Claude Code, OpenCode)가 mouse를 하나도
// 못 받는다. 커서 숨김(?25l)도 빠뜨려 TUI 위에 커서가 남는다. 둘은 출력에서 직접 따라간다.
const MOUSE_ENCODINGS = [1005, 1006, 1015, 1016] as const;
const MOUSE_ENCODING_NAMES: Readonly<
  Record<(typeof MOUSE_ENCODINGS)[number], TerminalModes["mouse_encoding"]>
> = {
  1005: "utf8",
  1006: "sgr",
  1015: "urxvt",
  1016: "sgr_pixel",
};
const MOUSE_TRACKING_MODES: Readonly<
  Record<number, TerminalModes["mouse_tracking"]>
> = {
  9: "x10",
  1000: "normal",
  1002: "button",
  1003: "any",
};

export type ScreenRead =
  | { unchanged: true }
  | (Omit<TerminalScreen, "generation" | "scrollback"> & {
      scrollback?: TerminalLine[];
      scrollback_key: string;
    });

export type TuiScreenState = {
  seq: number;
  columns: number;
  rows: number;
  title: string;
  cursor: TuiCursor;
  modes: TerminalModes;
  visual_hash: string;
};

export type TuiScreenSnapshot = TuiScreenState & {
  screen: string;
  scrollback?: string;
  highlights: TuiHighlight[];
  truncated: boolean;
};

export type ScreenWindowsPty = {
  readonly backend: "conpty";
  readonly buildNumber: number;
};

export class Screen {
  readonly #term: headless.Terminal;
  readonly #serializer: serialize.SerializeAddon;
  #seq = 0;
  #cols: number;
  #rows: number;
  #scrollSeq = 0;
  #scrollCache: { key: string; lines: TerminalLine[] } | null = null;
  #disposed = false;
  #mouseEncoding: (typeof MOUSE_ENCODINGS)[number] | null = null;
  #mouseTracking: TerminalModes["mouse_tracking"] = "none";
  #cursorHidden = false;
  #applicationCursorKeys = false;
  #bracketedPaste = false;
  #kittyNormal: number[] = [];
  #kittyAlternate: number[] = [];
  #title = "";

  constructor(
    columns: number,
    rows: number,
    options: {
      windowsPty?: ScreenWindowsPty;
      /** 프로그램이 OSC 52로 clipboard 쓰기를 요청했다(읽기 `?` 제외, 1 MiB 이하). */
      onClipboard?: (bytes: number) => void;
      /** 붙은 desktop xterm이 없을 때 PTY에 돌려줄 VT 질의 회신(DA, DSR, OSC 10/11, Kitty query). */
      onReply?: (data: string) => void;
    } = {},
  ) {
    this.#cols = columns;
    this.#rows = rows;
    this.#term = new headless.Terminal({
      cols: columns,
      rows,
      scrollback: SCROLLBACK,
      allowProposedApi: true,
      ...(options.windowsPty === undefined
        ? {}
        : { windowsPty: options.windowsPty }),
    });
    this.#serializer = new serialize.SerializeAddon();
    this.#term.loadAddon(this.#serializer);
    // 글자 폭은 renderer xterm과 같아야 다시 붙은 화면의 칸이 맞는다.
    this.#term.loadAddon(new unicode11.Unicode11Addon());
    this.#term.unicode.activeVersion = "11";
    this.#term.onScroll(() => {
      this.#scrollSeq += 1;
    });
    this.#term.onTitleChange((title) => {
      this.#title = title;
    });
    // @xterm/headless가 DA1/DA2/DSR 질의에 대해 생성한 응답을 호스트로 전달한다.
    this.#term.onData((reply) => {
      if (!this.#disposed) options.onReply?.(reply);
    });
    const track = (set: boolean) => (params: (number | number[])[]) => {
      for (const param of params) {
        if (typeof param !== "number") continue;
        if (param === 1) this.#applicationCursorKeys = set;
        else if (param === 25) this.#cursorHidden = !set;
        else if (param === 2004) this.#bracketedPaste = set;
        else if (param in MOUSE_TRACKING_MODES) {
          const mode = MOUSE_TRACKING_MODES[param]!;
          if (set) this.#mouseTracking = mode;
          else if (this.#mouseTracking === mode) this.#mouseTracking = "none";
        } else if ((MOUSE_ENCODINGS as readonly number[]).includes(param)) {
          const enc = param as (typeof MOUSE_ENCODINGS)[number];
          if (set) this.#mouseEncoding = enc;
          else if (this.#mouseEncoding === enc) this.#mouseEncoding = null;
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
    // Kitty keyboard protocol: push(`CSI > flags u`), pop(`CSI < count u`), set(`CSI = flags ; mode u`), query(`CSI ? u`).
    this.#term.parser.registerCsiHandler(
      { prefix: ">", final: "u" },
      (params) => {
        const flags =
          typeof params[0] === "number" && params[0] >= 0 ? params[0] : 0;
        const stack = this.#kittyStack();
        stack.push(flags);
        if (stack.length > KITTY_STACK_MAX) stack.shift();
        return true;
      },
    );
    this.#term.parser.registerCsiHandler(
      { prefix: "<", final: "u" },
      (params) => {
        const count =
          typeof params[0] === "number" && params[0] > 0 ? params[0] : 1;
        const stack = this.#kittyStack();
        for (let i = 0; i < count && stack.length > 0; i++) stack.pop();
        return true;
      },
    );
    this.#term.parser.registerCsiHandler(
      { prefix: "=", final: "u" },
      (params) => {
        const flags =
          typeof params[0] === "number" && params[0] >= 0 ? params[0] : 0;
        const mode = typeof params[1] === "number" ? params[1] : 1;
        const stack = this.#kittyStack();
        const prev = stack.at(-1) ?? 0;
        const next =
          mode === 2 ? prev | flags : mode === 3 ? prev & ~flags : flags;
        if (stack.length === 0) stack.push(next);
        else stack[stack.length - 1] = next;
        return true;
      },
    );
    this.#term.parser.registerCsiHandler({ prefix: "?", final: "u" }, () => {
      if (!this.#disposed) {
        options.onReply?.(`\x1b[?${this.#kittyFlags()}u`);
      }
      return true;
    });
    // CSI 3 J는 scrollback을 비운다. scrollback cache를 무효화한다.
    this.#term.parser.registerCsiHandler({ final: "J" }, (params) => {
      if (params.includes(3)) this.#scrollSeq += 1;
      return false;
    });
    this.#term.parser.registerEscHandler({ final: "c" }, () => {
      this.#mouseEncoding = null;
      this.#mouseTracking = "none";
      this.#cursorHidden = false;
      this.#applicationCursorKeys = false;
      this.#bracketedPaste = false;
      this.#kittyNormal = [];
      this.#kittyAlternate = [];
      this.#title = "";
      this.#scrollSeq += 1;
      return false;
    });
    // OSC 10/11 기본 전경·배경색 질의(`?`) 회신. 창 없이 띄운 vim·less가 시작에서 멈추지 않게 한다.
    this.#term.parser.registerOscHandler(10, (data) => {
      if (data === "?" && !this.#disposed) {
        options.onReply?.("\x1b]10;rgb:e6e6/e6e6/e6e6\x1b\\");
        return true;
      }
      return false;
    });
    this.#term.parser.registerOscHandler(11, (data) => {
      if (data === "?" && !this.#disposed) {
        options.onReply?.("\x1b]11;rgb:1a1a/1a1a/1a1a\x1b\\");
        return true;
      }
      return false;
    });
    // OSC 52 쓰기(1 MiB 이하)를 감시해 remote 화면에 toast를 알린다. 읽기(`?`)는 차단한다.
    this.#term.parser.registerOscHandler(52, (data) => {
      const bytes = parseOsc52WriteBytes(data);
      if (bytes !== null) options.onClipboard?.(bytes);
      return true;
    });
  }

  #kittyStack(): number[] {
    return this.#term.buffer.active.type === "alternate"
      ? this.#kittyAlternate
      : this.#kittyNormal;
  }

  #kittyFlags(): number {
    return this.#kittyStack().at(-1) ?? 0;
  }

  #currentModes(): TerminalModes {
    return {
      application_cursor_keys: this.#applicationCursorKeys,
      bracketed_paste: this.#bracketedPaste,
      alt_screen: this.#term.buffer.active.type === "alternate",
      cursor_visible: !this.#cursorHidden,
      mouse_tracking: this.#mouseTracking,
      mouse_encoding:
        this.#mouseEncoding === null
          ? "default"
          : MOUSE_ENCODING_NAMES[this.#mouseEncoding],
      kitty_keyboard_flags: this.#kittyFlags(),
    };
  }

  #currentCursor(): TuiCursor {
    const buffer = this.#term.buffer.active;
    return {
      x: Math.min(buffer.cursorX, Math.max(0, this.#term.cols - 1)),
      y: buffer.cursorY,
      visible: !this.#cursorHidden,
    };
  }

  #visualHash(cursor: TuiCursor, modes: TerminalModes): string {
    const term = this.#term;
    const buffer = term.buffer.active;
    const base = buffer.baseY;
    const cell = buffer.getNullCell();
    const hash = createHash("sha256");
    hash.update(
      `${term.cols}x${term.rows}|${cursor.x},${cursor.y},${cursor.visible ? 1 : 0}|${modes.alt_screen ? 1 : 0}\n`,
    );
    for (let row = 0; row < term.rows; row++) {
      const line = buffer.getLine(base + row);
      if (!line) {
        hash.update("\n");
        continue;
      }
      let encoded = "";
      for (let x = 0; x < term.cols; x++) {
        if (!line.getCell(x, cell)) break;
        if (cell.getWidth() === 0) continue;
        const chars = cell.getChars() || " ";
        encoded += cell.isInverse() !== 0 ? `\x01${chars}\x02` : chars;
      }
      hash.update(encoded);
      hash.update("\n");
    }
    return hash.digest("hex");
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
    if (this.#cols === columns && this.#rows === rows) return;
    this.#cols = columns;
    this.#rows = rows;
    this.#term.write("", () => {
      if (!this.#disposed) {
        this.#term.resize(columns, rows);
        this.#scrollSeq += 1;
        this.#scrollCache = null;
      }
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
   * `known`과 seq·크기가 같으면 파싱이나 직렬화 없이 `unchanged`를 돌려주고, `scrollbackKey`가 같으면 scrollback을 생략한다.
   */
  screen(
    tail: number,
    known?: {
      afterSeq?: number;
      columns?: number;
      rows?: number;
      scrollbackKey?: string;
    },
  ): Promise<ScreenRead | null> {
    const seq = this.#seq;
    if (this.#disposed) return Promise.resolve(null);
    if (
      known?.afterSeq !== undefined &&
      known.afterSeq === seq &&
      known.columns === this.#cols &&
      known.rows === this.#rows
    ) {
      return Promise.resolve({ unchanged: true });
    }
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
        const scrollKey = `${buffer.type}:${base}:${tail}:${term.cols}:${this.#scrollSeq}`;
        let scrollback: TerminalLine[] | undefined;
        if (known?.scrollbackKey !== scrollKey) {
          if (this.#scrollCache?.key === scrollKey) {
            scrollback = this.#scrollCache.lines;
          } else {
            scrollback = read(Math.max(0, base - tail), base);
            this.#scrollCache = { key: scrollKey, lines: scrollback };
          }
        }
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
          scrollback_key: scrollKey,
          ...(scrollback === undefined ? {} : { scrollback }),
          lines: read(base, base + term.rows),
        });
      });
    });
  }

  /** 모델용 경량 상태(화면 본문 없음). parse barrier 뒤에 모드·커서·제목·시각 해시를 읽는다. */
  tuiState(): Promise<TuiScreenState | null> {
    const seq = this.#seq;
    if (this.#disposed) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.#term.write("", () => {
        if (this.#disposed) return resolve(null);
        const cursor = this.#currentCursor();
        const modes = this.#currentModes();
        resolve({
          seq,
          columns: this.#term.cols,
          rows: this.#term.rows,
          title: this.#title,
          cursor,
          modes,
          visual_hash: this.#visualHash(cursor, modes),
        });
      });
    });
  }

  /** 모델용 화면 스냅샷. 평문(또는 --ansi), 반전 구간(highlights), 선택 scrollback, 32 KiB 절단(하단 보존). */
  tuiSnapshot(
    options: { scrollback?: number; ansi?: boolean } = {},
  ): Promise<TuiScreenSnapshot | null> {
    const seq = this.#seq;
    if (this.#disposed) return Promise.resolve(null);
    return new Promise((resolve) => {
      this.#term.write("", () => {
        if (this.#disposed) return resolve(null);
        const term = this.#term;
        const buffer = term.buffer.active;
        const base = buffer.baseY;
        const cell = buffer.getNullCell();
        const cursor = this.#currentCursor();
        const modes = this.#currentModes();
        const visual_hash = this.#visualHash(cursor, modes);
        const highlights = extractHighlights(
          buffer,
          base,
          term.rows,
          term.cols,
          cell,
        );

        const scrollLines =
          options.scrollback === undefined
            ? undefined
            : Math.min(Math.max(0, options.scrollback), TUI_SCROLLBACK_MAX);

        let rawScreen: string;
        let rawScrollback: string | undefined;
        if (options.ansi === true) {
          rawScreen = this.#serializer.serialize({ scrollback: 0 });
          if (scrollLines !== undefined) {
            rawScrollback = plainLines(
              buffer,
              Math.max(0, base - scrollLines),
              base,
              term.cols,
              cell,
            );
          }
        } else {
          rawScreen = plainLines(
            buffer,
            base,
            base + term.rows,
            term.cols,
            cell,
          );
          if (scrollLines !== undefined) {
            rawScrollback = plainLines(
              buffer,
              Math.max(0, base - scrollLines),
              base,
              term.cols,
              cell,
            );
          }
        }

        const fitted = truncateBottom(
          rawScreen,
          rawScrollback,
          TUI_SNAPSHOT_MAX_BYTES,
        );
        resolve({
          seq,
          columns: term.cols,
          rows: term.rows,
          title: this.#title,
          cursor,
          modes,
          visual_hash,
          screen: fitted.screen,
          ...(fitted.scrollback === undefined
            ? {}
            : { scrollback: fitted.scrollback }),
          highlights,
          truncated: fitted.truncated,
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

/** buffer의 [from, to) 줄을 행 끝 공백을 제거한 평문으로 읽는다. 전각 continuation 셀은 건너뛴다. */
function plainLines(
  buffer: headless.IBuffer,
  from: number,
  to: number,
  columns: number,
  cell: headless.IBufferCell,
): string {
  const lines: string[] = [];
  for (let y = from; y < to; y++) {
    const line = buffer.getLine(y);
    if (!line) {
      lines.push("");
      continue;
    }
    let text = "";
    for (let x = 0; x < columns; x++) {
      if (!line.getCell(x, cell)) break;
      if (cell.getWidth() === 0) continue;
      text += cell.getChars() || " ";
    }
    lines.push(text.replace(/\s+$/, ""));
  }
  return lines.join("\n");
}

/** viewport 각 행에서 inverse === true인 비공백 연속 셀 구간을 최대 32개 추출한다(0-based 표시 열 좌표). */
function extractHighlights(
  buffer: headless.IBuffer,
  base: number,
  rows: number,
  columns: number,
  cell: headless.IBufferCell,
): TuiHighlight[] {
  const highlights: TuiHighlight[] = [];
  for (
    let row = 0;
    row < rows && highlights.length < TUI_HIGHLIGHTS_MAX;
    row++
  ) {
    const line = buffer.getLine(base + row);
    if (!line) continue;
    let runCells: { col: number; width: number; chars: string }[] = [];
    const flush = () => {
      if (runCells.length === 0 || highlights.length >= TUI_HIGHLIGHTS_MAX) {
        runCells = [];
        return;
      }
      // 앞뒤 공백 셀을 걷어 내어 비공백 텍스트와 정확한 표시 열 구간을 맞춘다.
      let start = 0;
      while (start < runCells.length && runCells[start]!.chars.trim() === "") {
        start++;
      }
      let end = runCells.length - 1;
      while (end >= start && runCells[end]!.chars.trim() === "") {
        end--;
      }
      if (start <= end) {
        const first = runCells[start]!;
        const last = runCells[end]!;
        const text = runCells
          .slice(start, end + 1)
          .map((item) => item.chars)
          .join("");
        highlights.push({
          row,
          col_start: first.col,
          col_end: last.col + last.width - 1,
          text,
        });
      }
      runCells = [];
    };
    for (let x = 0; x < columns; x++) {
      if (!line.getCell(x, cell)) break;
      const width = cell.getWidth();
      if (width === 0) continue;
      if (cell.isInverse() !== 0) {
        runCells.push({ col: x, width, chars: cell.getChars() || " " });
      } else {
        flush();
      }
    }
    flush();
  }
  return highlights;
}

/** 텍스트 끝(하단) 행을 보존하면서 UTF-8 바이트 상한 이하로 자른다. */
function takeBottomBytes(
  text: string,
  maxBytes: number,
): { text: string; cut: boolean } {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return { text, cut: false };
  if (maxBytes <= 0) return { text: "", cut: text.length > 0 };
  const lines = text.split("\n");
  const kept: string[] = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    const lineBytes = Buffer.byteLength(line, "utf8");
    const extra = kept.length > 0 ? 1 : 0;
    if (used + lineBytes + extra <= maxBytes) {
      kept.push(line);
      used += lineBytes + extra;
    } else {
      if (kept.length === 0) {
        // 마지막 한 줄 자체가 상한을 넘으면 끝쪽 바이트만 안전하게 자른다.
        const chars = [...line];
        let tail = "";
        let tailBytes = 0;
        for (let j = chars.length - 1; j >= 0; j--) {
          const ch = chars[j]!;
          const b = Buffer.byteLength(ch, "utf8");
          if (tailBytes + b > maxBytes) break;
          tail = ch + tail;
          tailBytes += b;
        }
        kept.push(tail);
      }
      break;
    }
  }
  kept.reverse();
  return { text: kept.join("\n"), cut: true };
}

/** screen + 선택 scrollback을 합쳐 maxBytes 이하로 자른다. 최신(하단) 행인 screen을 먼저 보존한다. */
export function truncateBottom(
  screen: string,
  scrollback: string | undefined,
  maxBytes: number,
): { screen: string; scrollback?: string; truncated: boolean } {
  const screenBytes = Buffer.byteLength(screen, "utf8");
  if (scrollback === undefined) {
    if (screenBytes <= maxBytes) return { screen, truncated: false };
    const cut = takeBottomBytes(screen, maxBytes);
    return { screen: cut.text, truncated: cut.cut };
  }
  const scrollBytes = Buffer.byteLength(scrollback, "utf8");
  if (screenBytes + scrollBytes <= maxBytes) {
    return { screen, scrollback, truncated: false };
  }
  if (screenBytes >= maxBytes) {
    const cut = takeBottomBytes(screen, maxBytes);
    return { screen: cut.text, scrollback: "", truncated: true };
  }
  const remaining = maxBytes - screenBytes;
  const cutScroll = takeBottomBytes(scrollback, remaining);
  return { screen, scrollback: cutScroll.text, truncated: true };
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
