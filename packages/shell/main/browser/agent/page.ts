// driver가 한 탭의 page(webContents)에 대해 아는 것. Electron을 모르는 port라 driver를 가짜 page로 본다.
// 실제 구현은 electron-page.ts다.
export interface PageEvents {
  /** CDP event. */
  cdp(method: string, params: Record<string, unknown>): void;
  /** debugger가 떨어졌다(우리가 뗐거나 page가 닫혔다). */
  detached(): void;
  /** 사람이 DevTools를 열었다. */
  devtoolsOpened(): void;
}

export interface Page {
  /** webContents id. 같은 page인지는 이것으로 본다. */
  readonly id: number;
  isDestroyed(): boolean;
  isDevToolsOpened(): boolean;
  isLoading(): boolean;
  url(): string;
  title(): string;
  /** 이미 다른 debugger가 붙어 있으면 던진다. */
  attach(): void;
  detach(): void;
  send<T = Record<string, never>>(
    method: string,
    params?: Record<string, unknown>,
  ): Promise<T>;
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
}

/** 앱 live 화면은 어떤 경우에도 고르지 않는다. */
export function pageOf(
  lookup: PageLookup,
  view: "browser" | "preview",
  view_session: string,
): Page | undefined {
  if (view === "browser") return lookup.guest(view_session);
  const found = lookup.app(view_session);
  return found?.mode === "preview" ? found.page : undefined;
}
