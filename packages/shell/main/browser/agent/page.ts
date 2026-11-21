// driver가 한 탭의 page(webContents)에 대해 아는 것. Electron을 모르는 port라 driver를 가짜 page로 본다.
// 실제 구현은 electron-page.ts다.
import type { KeyEvent } from "./keys.ts";

export interface PageEvents {
  /** CDP event. */
  cdp(method: string, params: Record<string, unknown>): void;
  /** debugger가 떨어졌다(우리가 뗐거나 page가 닫혔다). */
  detached(): void;
  /** 사람이 DevTools를 열었다. */
  devtoolsOpened(): void;
}

export type DebuggerOwner = "driver" | "emulation" | "stream";

export interface Page {
  /** webContents id. 같은 page인지는 이것으로 본다. */
  readonly id: number;
  /** browser 탭 page의 browser profile(null은 기본). browser 탭이 아닌 page도 null이다. */
  readonly profile: string | null;
  isDestroyed(): boolean;
  isDevToolsOpened(): boolean;
  isLoading(): boolean;
  url(): string;
  title(): string;
  /**
   * webContents 하나에 debugger 하나라 driver, emulation, stream(멀리서 보기)이 같이 쓴다. 이미 붙어 있어도(owner가 다르면) 같이 쓰고,
   * 우리 것이 아닌 debugger가 붙어 있으면 던진다. 마지막 owner가 detach할 때만 실제로 뗀다.
   */
  attach(owner: DebuggerOwner): void;
  detach(owner: DebuggerOwner): void;
  /** 기기 emulation이 걸려 있다. */
  emulated(): boolean;
  send<T = Record<string, never>>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
  /** key event 하나를 이 page에만 넣는다. page가 받지 않았으면(그릴 view가 없다) false다. */
  sendKey(event: KeyEvent): boolean;
  subscribe(events: PageEvents): void;
}

/** bind가 가리킨 view_session에서 page를 찾는 곳. */
export interface PageLookup {
  /** browser 탭의 `<webview>` guest. 다른 종류(앱 view 등)면 undefined다. */
  guest(view_session: string): Page | undefined;
  /** 앱 view와 그 mode. 없으면 undefined다. */
  app(
    view_session: string,
  ): { mode: "live" | "preview"; page: Page } | undefined;
  /** artifact view(봉한 `lophn-artifact:` guest). 없으면 undefined다. */
  artifact(view_session: string): Page | undefined;
}

/** 앱 live 화면은 어떤 경우에도 고르지 않는다. */
export function pageOf(
  lookup: PageLookup,
  view: "browser" | "preview" | "artifact",
  view_session: string,
): Page | undefined {
  if (view === "browser") return lookup.guest(view_session);
  if (view === "artifact") return lookup.artifact(view_session);
  const found = lookup.app(view_session);
  return found?.mode === "preview" ? found.page : undefined;
}
