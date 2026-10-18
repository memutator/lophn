// xterm.js 표시. 출력은 제목·색·커서 같은 표시로만 해석한다. clipboard(OSC 52)·자동 링크
// (OSC 8)·파일·앱·플랫폼 동작 handler는 등록하지 않고, 그 escape는 parser에서 먹어 xterm
// 기본 동작(링크 열기 확인 창)도 생기지 않게 한다. 화면에 보이는 http/https 글자만 Ctrl/Cmd-click
// 하면 `onLink`로 알리고, 여는 것은 듣는 쪽이 한다.
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
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
  /** 보이는 http/https 링크를 Ctrl/Cmd-click했다. 그냥 click은 알리지 않는다. */
  onLink(listener: (url: string) => void): () => void;
  dispose(): void;
}

/** 출력이 바꿔도 동작이 생기지 않게 먹는 OSC 번호. 8은 링크, 52는 clipboard다. */
const SWALLOWED_OSC = [8, 52] as const;

interface XtermLike {
  readonly cols: number;
  options: { theme?: Record<string, string | undefined> };
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

interface XtermParts {
  Terminal: new (options: Record<string, unknown>) => XtermLike;
  FitAddon: new () => FitLike;
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
};

function token(element: HTMLElement, name: string): string | undefined {
  const value = getComputedStyle(element).getPropertyValue(name).trim();
  return value.length > 0 ? value : undefined;
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
  // CSSOM으로 다시 쓰면 style 속성도 바뀌어 observer가 다시 부른다. 이미 적용한
  // 값이면 건너뛰어 되먹임을 끊는다.
  const applied = new WeakMap<Element, string>();
  const restyle = (element: Element) => {
    const value = element.getAttribute("style");
    if (!value || !(element instanceof HTMLElement)) return;
    if (applied.get(element) === value) return;
    element.style.cssText = value;
    applied.set(element, element.getAttribute("style") ?? value);
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
    // 색·글꼴은 design token을 읽는다. clipboard 관련 option은 주지 않는다.
    fontFamily: token(host, "--font-mono"),
    fontSize: Number.parseFloat(token(host, "--type-small-size") ?? "") || 13,
    cursorBlink: true,
    scrollback: 10_000,
    theme: themeOf(host),
  });
  let shown = JSON.stringify(term.options.theme);
  const retheme = () => {
    const next = themeOf(host);
    const key = JSON.stringify(next);
    if (key === shown) return;
    shown = key;
    term.options.theme = next;
  };
  const swallowed = SWALLOWED_OSC.map((ident) =>
    term.parser.registerOscHandler(ident, () => true)
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
  const release = typeof MutationObserver === "function" &&
      typeof CSSStyleSheet === "function" &&
      "adoptedStyleSheets" in host.ownerDocument
    ? adoptInlineStyles(host)
    : () => {};
  term.open(host);
  const unwatch = typeof getComputedStyle === "function"
    ? watchTokens(host, retheme)
    : () => {};
  return {
    write: (text) => term.write(text),
    reset: () => term.reset(),
    focus: () => term.focus(),
    fit() {
      retheme();
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
    onLink(listener) {
      linkListeners.add(listener);
      return () => linkListeners.delete(listener);
    },
    dispose() {
      for (const handler of swallowed) handler.dispose();
      unwatch();
      release();
      term.dispose();
    },
  };
}
