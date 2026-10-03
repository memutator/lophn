// 창 하나의 모양. 시스템 제목 표시줄 없이 상단 바를 쓰고, 제목은 main이
// 검증한 공간 이름에만 붙인다.
import { type WebPreferences, webPreferences } from "./security.ts";

export const MIN_WINDOW_WIDTH = 960;
export const MIN_WINDOW_HEIGHT = 600;

/** macOS 신호등 자리. 이 폭만큼 상단 바 왼쪽을 비운다. */
export const TRAFFIC_LIGHT_WIDTH = 80;
/** Windows·Linux 창 버튼 자리. */
export const WINDOW_CONTROLS_WIDTH = 138;
/** 상단 바 높이. titleBarOverlay가 창 버튼 자리를 이 높이로 남긴다. */
export const TOP_BAR_HEIGHT = 48;

const TITLE_SUFFIX = " — lophn";

/** renderer가 보낸 문자열이 아니라 main이 아는 공간 이름만 받는다. */
export function windowTitle(spaceName: string): string {
  return `${spaceName}${TITLE_SUFFIX}`;
}

export interface WindowOptions {
  platform: NodeJS.Platform;
  packaged: boolean;
  /** main이 검증한 공간 이름. */
  spaceName: string;
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
  titleBarOverlay?: { height: number };
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
    ...(mac
      ? { trafficLightPosition: { x: 16, y: 16 } }
      : { titleBarOverlay: { height: TOP_BAR_HEIGHT } }),
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
