// xterm.js 표시. 출력은 제목·색·커서 같은 표시로만 해석한다. clipboard(OSC 52)·
// 자동 링크(OSC 8)·파일·앱·플랫폼 동작 handler는 등록하지 않고, 그 escape는 parser에서
// 먹어 xterm 기본 동작(링크 열기 확인 창)도 생기지 않게 한다(shell/terminal#R11).
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

/** 탭 화면이 쓰는 터미널 표시. 테스트는 가짜를 끼운다. */
export interface TerminalView {
  write(text: string): void;
  /** 새 generation이면 화면을 비운다. 옛 출력·입력을 다시 쓰지 않는다. */
  reset(): void;
  focus(): void;
  /** 지금 표시 영역에 맞춘 PTY 치수. 아직 잴 수 없으면 null이다. */
  fit(): { columns: number; rows: number } | null;
  onData(listener: (text: string) => void): () => void;
  dispose(): void;
}

/** 출력이 바꿔도 동작이 생기지 않게 먹는 OSC 번호. 8은 링크, 52는 clipboard다. */
export const SWALLOWED_OSC = [8, 52] as const;

interface XtermLike {
  readonly cols: number;
  readonly rows: number;
  readonly parser: {
    registerOscHandler(
      ident: number,
      callback: (data: string) => boolean,
    ): { dispose(): void };
  };
  open(element: HTMLElement): void;
  loadAddon(addon: unknown): void;
  write(data: string): void;
  reset(): void;
  focus(): void;
  onData(listener: (data: string) => void): { dispose(): void };
  dispose(): void;
}

interface FitLike {
  fit(): void;
}

export interface XtermParts {
  Terminal: new (options: Record<string, unknown>) => XtermLike;
  FitAddon: new () => FitLike;
}

const REAL: XtermParts = {
  Terminal: Terminal as unknown as XtermParts["Terminal"],
  FitAddon: FitAddon as unknown as XtermParts["FitAddon"],
};

function token(element: HTMLElement, name: string): string | undefined {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return value.length > 0 ? value : undefined;
}

/**
 * shell CSP는 inline style을 막는다. xterm이 넣는 <style>의 글을 constructable
 * stylesheet로 옮기고, setAttribute로 붙인 style 속성은 CSSOM으로 다시 적용한다.
 */
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
  const restyle = (element: Element) => {
    const value = element.getAttribute("style");
    if (value && element instanceof HTMLElement) {
      element.style.cssText = value;
    }
  };
  const visit = (node: Node) => {
    if (node instanceof HTMLStyleElement) adopt(node);
    else if (node instanceof Element) {
      if (node.hasAttribute("style")) restyle(node);
      for (const style of node.querySelectorAll("style")) adopt(style);
      for (const styled of node.querySelectorAll("[style]")) restyle(styled);
    }
  };
  visit(root);
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        restyle(record.target as Element);
        continue;
      }
      const parent = record.target;
      if (parent instanceof HTMLStyleElement) adopt(parent);
      for (const node of record.addedNodes) visit(node);
    }
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["style"],
  });
  return () => {
    observer.disconnect();
    const removed = new Set(sheets.values());
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((sheet) =>
      !removed.has(sheet)
    );
  };
}

/** xterm.js를 host 요소에 연다. parts는 테스트가 바꾼다. */
export function createXtermView(
  host: HTMLElement,
  parts: XtermParts = REAL,
): TerminalView {
  const term = new parts.Terminal({
    // 색·글꼴은 design token을 읽는다. 링크·clipboard 관련 option은 주지 않는다.
    fontFamily: token(host, "--font-mono"),
    fontSize: Number.parseFloat(token(host, "--type-small-size") ?? "") || 13,
    cursorBlink: true,
    scrollback: 10_000,
    theme: {
      background: token(host, "--color-ink-background"),
      foreground: token(host, "--color-ink-text"),
      cursor: token(host, "--color-ink-text"),
      selectionBackground: token(host, "--color-ink-hover"),
    },
  });
  const swallowed = SWALLOWED_OSC.map((ident) =>
    term.parser.registerOscHandler(ident, () => true)
  );
  const fitAddon = new parts.FitAddon();
  term.loadAddon(fitAddon);
  const release = typeof MutationObserver === "function" &&
      typeof CSSStyleSheet === "function" &&
      "adoptedStyleSheets" in host.ownerDocument
    ? adoptInlineStyles(host)
    : () => {};
  term.open(host);
  return {
    write: (text) => term.write(text),
    reset: () => term.reset(),
    focus: () => term.focus(),
    fit() {
      try {
        fitAddon.fit();
      } catch {
        return null;
      }
      return term.cols > 0 && term.rows > 0
        ? { columns: term.cols, rows: term.rows }
        : null;
    },
    onData(listener) {
      const subscription = term.onData(listener);
      return () => subscription.dispose();
    },
    dispose() {
      for (const handler of swallowed) handler.dispose();
      release();
      term.dispose();
    },
  };
}
