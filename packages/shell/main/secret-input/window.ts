// 보호 창은 요청한 shell 창의 child modal이다. 앱 view는 부모 contentView 안에만
// 있으므로 다른 BrowserWindow를 덮지 못한다. 그래서 native view를 숨기거나 떼지 않는다.
import { type WebPreferences, webPreferences } from "../desktop/security.ts";
import {
  focusSurface,
  type HeadlessMode,
  reveal,
  SHELL_OFF,
  surfaceOptions,
} from "../desktop/headless.ts";

const SECRET_INPUT_URL = "lophn-shell://secret-input/index.html";

/** 표시 최대폭. 좁은 부모는 창 안에 맞춘다. */
const SECRET_INPUT_MAX_WIDTH = 480;
const SECRET_INPUT_HEIGHT = 360;
const CHROME = 48;

interface SecretInputWindowConfig {
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

interface SecretInputContents {
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

export interface SecretInputBrowserWindow {
  readonly webContents: SecretInputContents;
  loadURL(url: string): Promise<void>;
  show(): void;
  focus(): void;
  close(): void;
  isDestroyed(): boolean;
  on(event: "closed" | "unresponsive", listener: () => void): void;
}

interface SecretInputSession {
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

export interface SecretInputHost {
  create(config: SecretInputWindowConfig): SecretInputBrowserWindow;
  sessionFor(partition: string): SecretInputSession;
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

export interface OpenedSecretInput {
  readonly windowId: string;
  readonly partition: string;
  readonly window: SecretInputBrowserWindow;
  /** 앱 webContents에 건 입력 차단을 푼다. view는 숨기지 않았다. */
  releaseInputBlock(): void;
}

let serial = 0;

/** 부모보다 넓지 않게, 최대 480px. */
function secretInputSize(
  parent: { width: number; height: number },
): { width: number; height: number } {
  const width = Math.max(
    320,
    Math.min(SECRET_INPUT_MAX_WIDTH, parent.width - CHROME),
  );
  const height = Math.max(
    240,
    Math.min(SECRET_INPUT_HEIGHT, parent.height - CHROME),
  );
  return { width, height };
}

function secretInputConfig(input: {
  parent: ParentWindow;
  preload: string;
  packaged: boolean;
  partition: string;
  headless?: HeadlessMode;
}): SecretInputWindowConfig {
  const size = secretInputSize(input.parent.getContentSize());
  return surfaceOptions({
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
  }, input.headless ?? SHELL_OFF);
}

/**
 * 보호 창을 연다. 세션은 창마다 메모리 partition이고, 설치 페이지만 연다.
 * 탐색·새 창·download·network는 막는다. 부모 앱 view는 그대로 두고 입력만 막는다.
 */
export function openSecretInputWindow(input: {
  host: SecretInputHost;
  parent: ParentWindow;
  preload: string;
  packaged: boolean;
  /** 개발 확인 전용 headless. 켜지면 offscreen으로 만들고 앞에 띄우지 않는다. */
  headless?: HeadlessMode;
  onClosed: () => void;
  onCrashed: () => void;
}): OpenedSecretInput {
  const windowId = `sip_${++serial}`;
  const headless = input.headless ?? SHELL_OFF;
  const partition = `secret-input-${windowId}`;
  const session = input.host.sessionFor(partition);
  hardenSession(session);
  const window = input.host.create(secretInputConfig({
    parent: input.parent,
    preload: input.preload,
    packaged: input.packaged,
    partition,
    headless,
  }));
  hardenContents(window.webContents, input.onCrashed);
  const release = blockAppInput(input.host.appContents(input.parent.id));
  window.on("closed", () => {
    release();
    input.onClosed();
  });
  window.on("unresponsive", input.onCrashed);
  // 앱 전용 창에서 요청해도 보호 창을 앞으로 가져온다.
  focusSurface(input.parent, headless);
  void window.loadURL(SECRET_INPUT_URL).then(() => {
    if (!window.isDestroyed()) {
      reveal(window, headless);
    }
  });
  return { windowId, partition, window, releaseInputBlock: release };
}

function hardenSession(session: SecretInputSession): void {
  session.setPermissionRequestHandler(() => {});
  session.on("will-download", (event) => event.preventDefault());
  session.webRequest.onBeforeRequest(
    { urls: ["*://*/*"] },
    (details, callback) => {
      const allowed = details.url.startsWith("lophn-shell://secret-input/");
      callback({ cancel: !allowed });
    },
  );
}

function hardenContents(
  contents: SecretInputContents,
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
