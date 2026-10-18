// 창 하나의 모양. 시스템 제목 표시줄 없이 상단 바를 쓰고, 제목은 main이
// 검증한 공간 이름에만 붙인다. Windows·Linux 창 단추는 OS가 아니라 상단 바가 그린다.
import type { WindowBounds } from "../workspace/layout.ts";
import { type WebPreferences, webPreferences } from "./security.ts";

export const MIN_WINDOW_WIDTH = 960;
export const MIN_WINDOW_HEIGHT = 600;

/** 상단 바 높이. */
export const TOP_BAR_HEIGHT = 36;

const TITLE_SUFFIX = " — lophn";

/**
 * renderer가 보낸 문자열이 아니라 main이 아는 공간 이름만 받는다. 런처는 공간이
 * 아니라서 이름 없이 제품 이름만 쓴다.
 */
export function windowTitle(spaceName?: string): string {
  return spaceName ? `${spaceName}${TITLE_SUFFIX}` : "lophn";
}

interface WindowOptions {
  platform: NodeJS.Platform;
  packaged: boolean;
  /** main이 검증한 공간 이름. 런처는 없다. */
  spaceName?: string;
  preload: string;
  show?: boolean;
  /** 이 자리와 크기로 연다(detached 창). 너비·높이는 최소 아래로 내려가지 않는다. */
  bounds?: WindowBounds;
}

export interface WindowConfig {
  x?: number;
  y?: number;
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  frame: false;
  title: string;
  autoHideMenuBar: true;
  trafficLightPosition?: { x: number; y: number };
  webPreferences: WebPreferences & { preload: string };
}

function windowConfig(options: WindowOptions): WindowConfig {
  const mac = options.platform === "darwin";
  return {
    ...(options.bounds ? { x: options.bounds.x, y: options.bounds.y } : {}),
    width: Math.max(options.bounds?.width ?? 0, MIN_WINDOW_WIDTH),
    height: Math.max(options.bounds?.height ?? 0, MIN_WINDOW_HEIGHT),
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    frame: false,
    title: windowTitle(options.spaceName),
    autoHideMenuBar: true,
    ...(mac ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    webPreferences: {
      ...webPreferences(options.packaged),
      // browser 탭의 <webview>. 붙일 때 설정은 browser/webview-guest.ts가 강제한다.
      webviewTag: true,
      preload: options.preload,
    },
  };
}

export interface CreatedWindow {
  setTitle(title: string): void;
  loadURL(url: string): Promise<void>;
  /** 페이지가 document.title로 OS 제목을 바꾸지 못하게 막는다. */
  onPageTitleUpdated(handler: (prevent: () => void) => void): void;
}

interface WindowFactory {
  create(config: WindowConfig): CreatedWindow;
}

interface OpenWindowOptions extends WindowOptions {
  url: string;
  windows: WindowFactory;
}

/** 창을 만들고 제목을 고정한 뒤 url을 연다. */
export function openWindow(options: OpenWindowOptions): CreatedWindow {
  const config = windowConfig(options);
  const window = options.windows.create(config);
  window.onPageTitleUpdated((prevent) => prevent());
  window.setTitle(config.title);
  void window.loadURL(options.url);
  return window;
}
