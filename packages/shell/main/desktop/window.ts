// 창 하나의 모양. 시스템 제목 표시줄 없이 상단 바를 쓰고, 제목은 main이
// 검증한 공간 이름에만 붙인다. Windows·Linux 창 단추는 OS가 아니라 상단 바가 그린다.
import { type WebPreferences, webPreferences } from "./security.ts";

export const MIN_WINDOW_WIDTH = 960;
export const MIN_WINDOW_HEIGHT = 600;

/** macOS 신호등 자리. 이 폭만큼 상단 바 왼쪽을 비운다. */
export const TRAFFIC_LIGHT_WIDTH = 80;
/** Windows·Linux 창 단추(최소화·최대화·닫기) 자리. 상단 바가 단추 셋을 이 폭으로 그린다. */
export const WINDOW_CONTROLS_WIDTH = 144;
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

export interface WindowOptions {
  platform: NodeJS.Platform;
  packaged: boolean;
  /** main이 검증한 공간 이름. 런처는 없다. */
  spaceName?: string;
  preload: string;
  show?: boolean;
}

export interface WindowConfig {
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

export function windowConfig(options: WindowOptions): WindowConfig {
  const mac = options.platform === "darwin";
  return {
    width: MIN_WINDOW_WIDTH,
    height: MIN_WINDOW_HEIGHT,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    frame: false,
    title: windowTitle(options.spaceName),
    autoHideMenuBar: true,
    ...(mac ? { trafficLightPosition: { x: 16, y: 16 } } : {}),
    webPreferences: {
      ...webPreferences(options.packaged),
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

export interface WindowFactory {
  create(config: WindowConfig): CreatedWindow;
}

export interface OpenWindowOptions extends WindowOptions {
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
