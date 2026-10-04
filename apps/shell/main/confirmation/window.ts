// 보호 창은 요청한 shell 창의 child modal이다. 앱 view는 부모 contentView 안에만
// 있으므로 다른 BrowserWindow를 덮지 못한다. 그래서 native view를 숨기거나 떼지 않는다.
import { type WebPreferences, webPreferences } from "../desktop/security.ts";

export const CONFIRMATION_URL = "lophn-shell://confirmation/index.html";

/** 표시 최대폭. 좁은 부모는 창 안에 맞춘다(confirmation-window#R2). */
export const CONFIRMATION_MAX_WIDTH = 640;
export const CONFIRMATION_HEIGHT = 560;
const CHROME = 48;

export interface ConfirmationWindowConfig {
  parent: ParentWindow;
  modal: true;
  width: number;
  height: number;
  show: false;
  frame: false;
  autoHideMenuBar: true;
  webPreferences: WebPreferences & {
    preload: string;
    partition: string;
  };
}

export interface ParentWindow {
  readonly id: string;
  /** 앱 전용 창이어도 보호 창을 앞으로 가져오기 위해 부모를 먼저 올린다. */
  focus(): void;
  getContentSize(): { width: number; height: number };
}

export interface ConfirmationContents {
  readonly id: number;
  loadURL(url: string): Promise<void>;
  send(channel: string, payload: unknown): void;
  isDestroyed(): boolean;
  on(
    event: "before-input-event" | "will-navigate" | "will-attach-webview",
    listener: (event: { preventDefault(): void }, ...args: unknown[]) => void,
  ): void;
  setWindowOpenHandler(handler: () => { action: "deny" }): void;
  close(): void;
}

export interface ConfirmationBrowserWindow {
  readonly webContents: ConfirmationContents;
  loadURL(url: string): Promise<void>;
  show(): void;
  focus(): void;
  close(): void;
  isDestroyed(): boolean;
  on(event: "closed" | "unresponsive", listener: () => void): void;
}

export interface ConfirmationSession {
  readonly partition: string;
  /** 권한 요청은 기본 거절. */
  setPermissionRequestHandler(
    handler: () => void,
  ): void;
  /** download를 막는다. */
  on(
    event: "will-download",
    listener: (event: { preventDefault(): void }) => void,
  ): void;
  /** 보호 창은 network를 쓰지 않는다. */
  webRequest: {
    onBeforeRequest(
      filter: { urls: string[] },
      listener: (
        details: { url: string },
        callback: (response: { cancel: boolean }) => void,
      ) => void,
    ): void;
  };
}

export interface ConfirmationHost {
  create(config: ConfirmationWindowConfig): ConfirmationBrowserWindow;
  sessionFor(partition: string): ConfirmationSession;
  /** 부모 창의 앱 webContents. 열린 동안 키 입력을 막는다. */
  appContents(parentId: string): readonly AppContents[];
}

export interface AppContents {
  readonly id: number;
  isDestroyed(): boolean;
  /** 보이기는 그대로 둔다. 입력만 막는다. */
  on(
    event: "before-input-event",
    listener: (event: { preventDefault(): void }) => void,
  ): void;
  off(
    event: "before-input-event",
    listener: (event: { preventDefault(): void }) => void,
  ): void;
  /** 앱이 새 창을 띄워 보호 창 위로 올라오지 못하게 한다. */
  setWindowOpenHandler(handler: () => { action: "deny" }): void;
}

export interface OpenedConfirmation {
  readonly windowId: string;
  readonly partition: string;
  readonly window: ConfirmationBrowserWindow;
  /** 앱 webContents에 건 입력 차단을 푼다. view는 숨기지 않았다. */
  releaseInputBlock(): void;
}

let serial = 0;

/** 부모보다 넓지 않게, 최대 640px. */
export function confirmationSize(
  parent: { width: number; height: number },
): { width: number; height: number } {
  const width = Math.max(
    320,
    Math.min(CONFIRMATION_MAX_WIDTH, parent.width - CHROME),
  );
  const height = Math.max(
    240,
    Math.min(CONFIRMATION_HEIGHT, parent.height - CHROME),
  );
  return { width, height };
}

export function confirmationConfig(input: {
  parent: ParentWindow;
  preload: string;
  packaged: boolean;
  partition: string;
}): ConfirmationWindowConfig {
  const size = confirmationSize(input.parent.getContentSize());
  return {
    parent: input.parent,
    modal: true,
    width: size.width,
    height: size.height,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    webPreferences: {
      ...webPreferences(input.packaged),
      preload: input.preload,
      partition: input.partition,
    },
  };
}

/**
 * 보호 창을 연다. 세션은 창마다 메모리 partition이고, 설치 페이지만 연다.
 * 탐색·새 창·download·network는 막는다. 부모 앱 view는 그대로 두고 입력만 막는다.
 */
export function openConfirmationWindow(input: {
  host: ConfirmationHost;
  parent: ParentWindow;
  preload: string;
  packaged: boolean;
  onClosed: () => void;
  onCrashed: () => void;
}): OpenedConfirmation {
  const windowId = `cfw_${++serial}`;
  const partition = `confirmation-${windowId}`;
  const session = input.host.sessionFor(partition);
  hardenSession(session);
  const window = input.host.create(confirmationConfig({
    parent: input.parent,
    preload: input.preload,
    packaged: input.packaged,
    partition,
  }));
  hardenContents(window.webContents, input.onCrashed);
  const release = blockAppInput(input.host.appContents(input.parent.id));
  window.on("closed", () => {
    release();
    input.onClosed();
  });
  window.on("unresponsive", input.onCrashed);
  // 앱 전용 창에서 요청해도 보호 창을 앞으로 가져온다.
  input.parent.focus();
  void window.loadURL(CONFIRMATION_URL).then(() => {
    if (!window.isDestroyed()) {
      window.show();
      window.focus();
    }
  });
  return { windowId, partition, window, releaseInputBlock: release };
}

function hardenSession(session: ConfirmationSession): void {
  session.setPermissionRequestHandler(() => {});
  session.on("will-download", (event) => event.preventDefault());
  session.webRequest.onBeforeRequest(
    { urls: ["*://*/*"] },
    (details, callback) => {
      const allowed = details.url.startsWith("lophn-shell://confirmation/");
      callback({ cancel: !allowed });
    },
  );
}

function hardenContents(
  contents: ConfirmationContents,
  onCrashed: () => void,
): void {
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event) => event.preventDefault());
  contents.on("will-attach-webview", (event) => event.preventDefault());
  contents.on("before-input-event", () => {});
  contents.on("render-process-gone" as "before-input-event", () => onCrashed());
}

function blockAppInput(contents: readonly AppContents[]): () => void {
  const listeners = new Map<
    AppContents,
    (event: { preventDefault(): void }) => void
  >();
  for (const one of contents) {
    if (one.isDestroyed()) continue;
    const block = (event: { preventDefault(): void }) => event.preventDefault();
    one.setWindowOpenHandler(() => ({ action: "deny" }));
    one.on("before-input-event", block);
    listeners.set(one, block);
  }
  return () => {
    for (const [one, block] of listeners) {
      if (!one.isDestroyed()) one.off("before-input-event", block);
    }
  };
}
