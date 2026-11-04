// xterm.js 표시. 출력은 제목·색·커서 같은 표시로만 해석한다. clipboard(OSC 52)·자동 링크
// (OSC 8)·파일·앱·플랫폼 동작 handler는 등록하지 않고, 그 escape는 parser에서 먹어 xterm
// 기본 동작(링크 열기 확인 창)도 생기지 않게 한다. 화면에 보이는 http/https 글자와 파일 경로만 Ctrl/Cmd-click
// 하면 `onLink`·`onPathLink`로 알리고, 여는 것은 듣는 쪽이 한다. clipboard는 사람이 누른 키(Linux·Windows의
// Ctrl+Shift+C/V)로만 쓴다. macOS의 Cmd+C/V는 창 menu가 하므로 여기서 받지 않는다.
import { pathMatches } from "./path-links.ts";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import { Terminal } from "@xterm/xterm";

/** 탭 화면이 쓰는 터미널 표시. 테스트는 가짜를 끼운다. */
export interface TerminalView {
  write(text: string): void;
  /**
   * 이미 한 번 나온 출력을 다시 쓴다(탭을 다시 붙일 때). 그 출력에 들어 있던 질의(DA1 등)에 xterm이 만든
   * 응답은 onData로 나가지 않는다. program은 그 질의의 응답을 이미 받았거나 기다리지 않는다.
   */
  replay(text: string): void;
  /** 새 generation이면 화면을 비운다. 옛 출력·입력을 다시 쓰지 않는다. */
  reset(): void;
  focus(): void;
  /** 지금 표시 영역에 맞춘 PTY 치수. 아직 잴 수 없으면 null이다. */
  fit(): { columns: number; rows: number } | null;
  onData(listener: (text: string) => void): () => void;
  /** 보이는 http/https 링크를 Ctrl/Cmd-click했다. 그냥 click은 알리지 않는다. */
  onLink(listener: (url: string) => void): () => void;
  /**
   * 보이는 파일 경로에 link를 단다. `resolve`가 그 글자를 디스크에 있는 절대 경로로 바꾸면(없으면 null) 밑줄이
   * 생기고, Ctrl/Cmd-click하면 `open`을 부른다.
   */
  onPathLink(handlers: {
    resolve(path: string): Promise<string | null>;
    open(path: string, line: number | undefined): void;
  }): () => void;
  /** program이 OSC 0/2로 터미널 제목을 바꿨다. */
  onTitle(listener: (title: string) => void): () => void;
  dispose(): void;
}

/** OS clipboard. main이 쓰고 읽는다. 실패하면 copy는 조용히 끝나고 paste는 빈 글이다. */
export interface TerminalClipboard {
  copy(text: string): Promise<void>;
  paste(): Promise<string>;
}

/** 출력이 바꿔도 동작이 생기지 않게 먹는 OSC 번호. 8은 링크, 52는 clipboard다. */
const SWALLOWED_OSC = [8, 52] as const;

interface CellLike {
  isInverse(): number;
  isFgRGB(): boolean;
  isFgPalette(): boolean;
  getFgColor(): number;
  isBgRGB(): boolean;
  isBgPalette(): boolean;
  getBgColor(): number;
  getChars(): string;
  getWidth(): number;
}

interface LineLike {
  readonly length: number;
  getCell(x: number, cell?: CellLike): CellLike | undefined;
}

interface BufferLike {
  readonly type: "normal" | "alternate";
  readonly viewportY: number;
  getLine(y: number): LineLike | undefined;
  getNullCell(): CellLike;
}

interface LinkLike {
  range: {
    start: { x: number; y: number };
    end: { x: number; y: number };
  };
  text: string;
  activate(event: MouseEvent, text: string): void;
}

interface XtermLike {
  readonly cols: number;
  options: { theme?: Record<string, string | undefined> };
  readonly rows: number;
  readonly element: HTMLElement | undefined;
  readonly buffer: { readonly active: BufferLike };
  onRender(listener: () => void): { dispose(): void };
  readonly parser: {
    registerOscHandler(
      ident: number,
      callback: (data: string) => boolean,
    ): { dispose(): void };
  };
  hasSelection(): boolean;
  getSelection(): string;
  paste(data: string): void;
  attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void;
  registerLinkProvider(provider: {
    provideLinks(
      y: number,
      callback: (links: LinkLike[] | undefined) => void,
    ): void;
  }): { dispose(): void };
  open(element: HTMLElement): void;
  loadAddon(addon: unknown): void;
  write(data: string, callback?: () => void): void;
  reset(): void;
  focus(): void;
  onData(listener: (data: string) => void): { dispose(): void };
  onTitleChange(listener: (title: string) => void): { dispose(): void };
  dispose(): void;
}

interface FitLike {
  fit(): void;
}

interface WebglLike {
  onContextLoss(listener: () => void): unknown;
  dispose(): void;
}

interface XtermParts {
  Terminal: new (options: Record<string, unknown>) => XtermLike;
  FitAddon: new () => FitLike;
  WebglAddon: new () => WebglLike;
  WebLinksAddon: new (
    handler: (
      event: { ctrlKey: boolean; metaKey: boolean },
      uri: string,
    ) => void,
  ) => unknown;
}

const REAL: XtermParts = {
  Terminal: Terminal as unknown as XtermParts["Terminal"],
  FitAddon: FitAddon as unknown as XtermParts["FitAddon"],
  WebLinksAddon: WebLinksAddon as unknown as XtermParts["WebLinksAddon"],
  WebglAddon: WebglAddon as unknown as XtermParts["WebglAddon"],
};

function token(element: HTMLElement, name: string): string | undefined {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return value.length > 0 ? value : undefined;
}

/** 사람이 고른 코드 글꼴 굵기. xterm은 CSS를 따르지 않아 token을 숫자로 넘긴다. */
function monoWeight(element: HTMLElement): number | undefined {
  const weight = Number.parseInt(
    token(element, "--font-weight-mono") ?? "",
    10,
  );
  return Number.isFinite(weight) ? weight : undefined;
}

const ANSI = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
] as const;

// 바탕은 탭 본문과 같은 surface다. 글자·선택·ANSI 색도 token에서 읽어 light/dark와 Appearance를 따른다.
function themeOf(element: HTMLElement): Record<string, string | undefined> {
  const theme: Record<string, string | undefined> = {
    background: token(element, "--color-surface-base"),
    foreground: token(element, "--color-text-primary"),
    cursor: token(element, "--color-text-primary"),
    cursorAccent: token(element, "--color-surface-base"),
    selectionBackground: token(element, "--color-selection"),
    // scrollbar 자리(overview ruler)를 만들면 xterm이 그 왼쪽에 foreground색 1px 줄을 긋는다. 바탕색으로 감춘다.
    overviewRulerBorder: token(element, "--color-surface-base"),
  };
  for (const name of ANSI) {
    const bright = `bright${name[0].toUpperCase()}${name.slice(1)}`;
    theme[name] = token(element, `--terminal-${name}`);
    theme[bright] = token(element, `--terminal-bright-${name}`);
  }
  return theme;
}

/**
 * token 값이 바뀌면(theme, Appearance의 insertCSS) 부른다. xterm은 색을 CSS가 아니라 option으로 받으므로,
 * 그 token을 쓰는 보이지 않는 요소의 transition으로 바뀜을 안다. 숨은 탭에서는 transition이 돌지 않으니
 * fit 때도 다시 읽는다.
 */
function watchTokens(host: HTMLElement, onChange: () => void): () => void {
  const probe = host.ownerDocument.createElement("span");
  probe.setAttribute("aria-hidden", "true");
  Object.assign(probe.style, {
    position: "absolute",
    width: "0",
    height: "0",
    visibility: "hidden",
    pointerEvents: "none",
    backgroundColor: "var(--color-surface-base)",
    color: "var(--color-text-primary)",
    borderTopColor: "var(--color-selection)",
    transition: "background-color 1ms, color 1ms, border-top-color 1ms",
  });
  probe.addEventListener("transitionend", onChange);
  host.appendChild(probe);
  return () => {
    probe.removeEventListener("transitionend", onChange);
    probe.remove();
  };
}

// 256색 palette에서 16 위는 xterm 표준 6×6×6 cube와 회색 24단이다. 아래 16은 theme의 ANSI 색이다.
const CUBE = [0, 95, 135, 175, 215, 255];

function paletteColor(
  index: number,
  theme: Record<string, string | undefined>,
): string | undefined {
  if (index < 16) {
    const name = ANSI[index % 8];
    return theme[
      index < 8 ? name : `bright${name[0].toUpperCase()}${name.slice(1)}`
    ];
  }
  if (index < 232) {
    const i = index - 16;
    return rgb(
      (CUBE[Math.floor(i / 36)] << 16) |
        (CUBE[Math.floor(i / 6) % 6] << 8) |
        CUBE[i % 6],
    );
  }
  const gray = 8 + (index - 232) * 10;
  return rgb((gray << 16) | (gray << 8) | gray);
}

function rgb(value: number): string {
  return `#${value.toString(16).padStart(6, "0")}`;
}

/** cell이 화면에 칠하는 바탕색. 뒤집힌 cell은 글자색이 바탕이다. */
function cellBackground(
  cell: CellLike,
  theme: Record<string, string | undefined>,
): string | undefined {
  if (cell.isInverse() !== 0) {
    if (cell.isFgRGB()) return rgb(cell.getFgColor());
    if (cell.isFgPalette()) return paletteColor(cell.getFgColor(), theme);
    return theme.foreground;
  }
  if (cell.isBgRGB()) return rgb(cell.getBgColor());
  if (cell.isBgPalette()) return paletteColor(cell.getBgColor(), theme);
  return theme.background;
}

/**
 * 탭 여백과 scrollbar 자리를 가장 가까운 cell의 바탕색으로 칠한다(Ghostty `window-padding-color = extend`).
 * 자기 바탕을 칠하는 full-screen TUI(OpenCode 등) 둘레에 탭 바탕 띠가 남지 않게 한다. 여백을 없애면 shell
 * 글자가 칸 경계에 붙고, TUI일 때만 없애면 cols·rows가 바뀌어 resize가 일어나므로 크기는 두고 색만 바꾼다.
 * alternate screen만 칠한다: 일반 화면은 prompt·powerline 글자가 늘어나 어색하고 Ghostty도 거기서는 거의
 * 늘리지 않는다. TUI의 화면이 줄·칸마다 다른 색이라(sidebar, header) 띠도 줄·칸마다 칠한다.
 */
function paintEdges(
  term: XtermLike,
  edge: HTMLCanvasElement,
  theme: Record<string, string | undefined>,
): void {
  const context = edge.getContext("2d");
  if (context === null) return;
  const buffer = term.buffer.active;
  // 일반 화면이 거의 늘 보이는 화면이다. 출력마다 크기를 재지 않고 지우기만 한다.
  if (buffer.type !== "alternate" || term.cols === 0 || term.rows === 0) {
    context.clearRect(0, 0, edge.width, edge.height);
    return;
  }
  const box = edge.getBoundingClientRect();
  const ratio = globalThis.devicePixelRatio || 1;
  const width = Math.round(box.width * ratio);
  const height = Math.round(box.height * ratio);
  if (edge.width !== width) edge.width = width;
  if (edge.height !== height) edge.height = height;
  context.clearRect(0, 0, width, height);
  const grid = term.element
    ?.querySelector(".xterm-screen")
    ?.getBoundingClientRect();
  if (grid === undefined || grid.width === 0) return;
  // 경계를 device pixel에 맞춘다. 소수점 경계는 같은 색 띠 사이에 옅은 선을 남긴다.
  const px = (value: number) => Math.round(value * ratio);
  const left = px(grid.left - box.left);
  const top = px(grid.top - box.top);
  const right = px(grid.right - box.left);
  const bottom = px(grid.bottom - box.top);
  const rowAt = (y: number) =>
    top + Math.round(((bottom - top) * y) / term.rows);
  const colAt = (x: number) =>
    left + Math.round(((right - left) * x) / term.cols);
  const cell = buffer.getNullCell();
  const fill = (
    x: number,
    y: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
  ) => {
    const found = buffer.getLine(buffer.viewportY + y)?.getCell(x, cell);
    const color =
      found === undefined ? undefined : cellBackground(found, theme);
    if (color === undefined || x1 <= x0 || y1 <= y0) return;
    context.fillStyle = color;
    context.fillRect(x0, y0, x1 - x0, y1 - y0);
  };
  const last = { x: term.cols - 1, y: term.rows - 1 };
  for (let y = 0; y < term.rows; y += 1) {
    fill(0, y, 0, rowAt(y), left, rowAt(y + 1));
    fill(last.x, y, right, rowAt(y), width, rowAt(y + 1));
  }
  // 위·아래 띠는 모서리까지 늘린다.
  for (let x = 0; x < term.cols; x += 1) {
    const x0 = x === 0 ? 0 : colAt(x);
    const x1 = x === last.x ? width : colAt(x + 1);
    fill(x, 0, x0, 0, x1, top);
    fill(x, last.y, x0, bottom, x1, height);
  }
}

/** shell CSP는 inline <style>을 막는다. xterm이 넣는 <style>의 글을 constructable stylesheet로 옮긴다. */
function adoptInlineStyles(root: HTMLElement): () => void {
  const document = root.ownerDocument;
  const sheets = new Map<HTMLStyleElement, CSSStyleSheet>();
  const adopt = (element: HTMLStyleElement) => {
    let sheet = sheets.get(element);
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheets.set(element, sheet);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    }
    sheet.replaceSync(element.textContent ?? "");
  };
  const visit = (node: Node) => {
    if (node instanceof HTMLStyleElement) adopt(node);
    else if (node instanceof Element) {
      for (const style of node.querySelectorAll("style")) adopt(style);
    }
  };
  visit(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      const parent = record.target;
      if (parent instanceof HTMLStyleElement) adopt(parent);
      for (const node of record.addedNodes) visit(node);
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
  });
  return () => {
    observer.disconnect();
    const removed = new Set(sheets.values());
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter(
      (sheet) => !removed.has(sheet),
    );
  };
}

/**
 * xterm.js를 host 요소에 연다. edge는 host를 둘러싼 여백 전체를 덮는 canvas이고 `paintEdges`가 칠한다.
 * clipboard가 없으면 Ctrl+Shift+C/V는 아무것도 하지 않는다. parts는 테스트가 바꾼다.
 */
export function createXtermView(
  host: HTMLElement,
  edge: HTMLCanvasElement,
  parts: XtermParts = REAL,
  clipboard: TerminalClipboard | null = null,
): TerminalView {
  let theme = themeOf(host);
  const term = new parts.Terminal({
    // 색·글꼴은 design token을 읽는다. clipboard 관련 option은 주지 않는다.
    fontFamily: token(host, "--font-mono"),
    fontWeight: monoWeight(host),
    fontSize: Number.parseFloat(token(host, "--type-small-size") ?? "") || 13,
    cursorBlink: true,
    scrollback: 10_000,
    // xterm 6.0은 scrollbar 폭을 overviewRuler.width로만 정하고, addon-fit도 그 폭(없으면 14px)만큼 오른쪽을
    // 비워 둔다. 기본 14px 자리는 alternate buffer(scrollback 없음)에서 영영 비어 TUI 배경이 오른쪽에서 크게
    // 끊겨 보인다. 탭 왼쪽 여백(--space-3)과 같은 폭으로 줄이고 .screen은 오른쪽 여백을 비워, scrollbar 자리가
    // 오른쪽 여백을 겸해 양쪽 간격이 같게 한다.
    overviewRuler: { width: Number.parseFloat(token(host, "--space-3") ?? "") },
    theme,
  });
  let shown = JSON.stringify(theme);
  const retheme = () => {
    const next = themeOf(host);
    const key = JSON.stringify(next);
    if (key === shown) return;
    shown = key;
    theme = next;
    term.options.theme = next;
  };
  const swallowed = SWALLOWED_OSC.map((ident) =>
    term.parser.registerOscHandler(ident, () => true),
  );
  const fitAddon = new parts.FitAddon();
  term.loadAddon(fitAddon);
  const linkListeners = new Set<(url: string) => void>();
  // window.open이나 기본 동작은 쓰지 않는다. 그냥 click은 글을 고르는 데 쓰이므로 무시한다.
  term.loadAddon(
    new parts.WebLinksAddon((event, uri) => {
      if (!event.ctrlKey && !event.metaKey) return;
      for (const listener of linkListeners) listener(uri);
    }),
  );
  // Linux·Windows의 Ctrl+C는 shell의 SIGINT라 복사는 Ctrl+Shift+C, 붙여 넣기는 Ctrl+Shift+V다. 고른 글이 없으면
  // Ctrl+Shift+C도 shell로 보내지 않고 먹는다. paste는 xterm이 bracketed paste로 감싸 줄마다 실행되지 않는다.
  // shell 창 session은 web clipboard permission을 거절하므로 OS clipboard는 main이 쓴다(`clipboard`).
  const mac = /Mac OS X|Macintosh/.test(globalThis.navigator?.userAgent ?? "");
  term.attachCustomKeyEventHandler((event) => {
    if (
      mac ||
      !event.ctrlKey ||
      !event.shiftKey ||
      event.altKey ||
      event.metaKey ||
      (event.code !== "KeyC" && event.code !== "KeyV")
    )
      return true;
    if (event.type === "keydown") {
      event.preventDefault();
      if (event.code === "KeyC") {
        if (term.hasSelection()) void clipboard?.copy(term.getSelection());
      } else {
        void clipboard?.paste().then((text) => {
          if (text !== "") term.paste(text);
        });
      }
    }
    return false;
  });
  let pathLinks: Parameters<TerminalView["onPathLink"]>[0] | null = null;
  const pathProvider = term.registerLinkProvider({
    provideLinks(y, callback) {
      const handlers = pathLinks;
      const line = term.buffer.active.getLine(y - 1);
      if (handlers === null || line === undefined) return callback(undefined);
      // 넓은 글자(한글)는 cell 둘을 쓰므로 글자 index마다 column(1부터)을 적는다.
      let text = "";
      const columns: number[] = [];
      const cell = term.buffer.active.getNullCell();
      for (let x = 0; x < line.length; x += 1) {
        const found = line.getCell(x, cell);
        if (found === undefined || found.getWidth() === 0) continue;
        const chars = found.getChars() || " ";
        for (let i = 0; i < chars.length; i += 1) columns.push(x + 1);
        text += chars;
      }
      const matches = pathMatches(text);
      if (matches.length === 0) return callback(undefined);
      void Promise.all(
        matches.map(async (match) => {
          const absolute = await handlers.resolve(match.path).catch(() => null);
          if (absolute === null) return null;
          const link: LinkLike = {
            range: {
              start: { x: columns[match.start]!, y },
              end: { x: columns[match.end - 1]!, y },
            },
            text: text.slice(match.start, match.end),
            activate(event) {
              if (event.ctrlKey || event.metaKey)
                handlers.open(absolute, match.line);
            },
          };
          return link;
        }),
      ).then((links) => {
        const kept = links.filter((link) => link !== null);
        callback(kept.length === 0 ? undefined : kept);
      });
    },
  });
  const release =
    typeof MutationObserver === "function" &&
    typeof CSSStyleSheet === "function" &&
    "adoptedStyleSheets" in host.ownerDocument
      ? adoptInlineStyles(host)
      : () => {};
  term.open(host);
  // 셀은 WebGL renderer가 그린다(빠르다). WebGL2가 없거나 context를 잃으면 addon을 버려 DOM renderer로 돌아가고,
  // 다음 fit·focus 때 다시 붙여 본다. GPU process가 되살아나도 xterm은 스스로 WebGL로 돌아오지 않는다.
  // DOM renderer도 truecolor를 칠한다(shell CSP의 `style-src-attr`).
  let webgl: WebglLike | null = null;
  const attachWebgl = () => {
    if (webgl !== null) return;
    const addon = new parts.WebglAddon();
    try {
      term.loadAddon(addon);
    } catch {
      addon.dispose();
      return;
    }
    webgl = addon;
    addon.onContextLoss(() => {
      addon.dispose();
      if (webgl === addon) webgl = null;
    });
  };
  attachWebgl();
  const unwatch =
    typeof getComputedStyle === "function"
      ? watchTokens(host, retheme)
      : () => {};
  // 화면을 다시 그릴 때마다(출력, buffer 바꿈, resize, theme) 여백도 다시 칠한다.
  const rendered = term.onRender(() => paintEdges(term, edge, theme));
  // 다시 쓰는 출력이 끝나기 전에 나온 응답을 거른다. write 큐는 순서대로 처리되므로 callback이 불릴 때까지가
  // 그 출력의 구문 분석 구간이고, 그 뒤에 쓴 새 출력의 응답은 그대로 나간다.
  let replaying = 0;
  return {
    write: (text) => term.write(text),
    replay(text) {
      replaying += 1;
      term.write(text, () => {
        replaying -= 1;
      });
    },
    reset: () => term.reset(),
    focus() {
      attachWebgl();
      term.focus();
    },
    fit() {
      retheme();
      attachWebgl();
      try {
        fitAddon.fit();
      } catch {
        return null;
      }
      // cols·rows가 그대로인 크기 바뀜은 다시 그리지 않으므로 여백 폭은 여기서 맞춘다.
      paintEdges(term, edge, theme);
      return term.cols > 0 && term.rows > 0
        ? { columns: term.cols, rows: term.rows }
        : null;
    },
    onData(listener) {
      const subscription = term.onData((text) => {
        if (replaying === 0) listener(text);
      });
      return () => subscription.dispose();
    },
    onLink(listener) {
      linkListeners.add(listener);
      return () => linkListeners.delete(listener);
    },
    onPathLink(handlers) {
      pathLinks = handlers;
      return () => {
        if (pathLinks === handlers) pathLinks = null;
      };
    },
    onTitle(listener) {
      const subscription = term.onTitleChange(listener);
      return () => subscription.dispose();
    },
    dispose() {
      for (const handler of swallowed) handler.dispose();
      rendered.dispose();
      pathProvider.dispose();
      unwatch();
      release();
      term.dispose();
    },
  };
}
