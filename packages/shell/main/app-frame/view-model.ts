// 앱 view registry의 값과 순수 검사. 입력 모양 검사(appFrameOpen)와 같은 연결
// 판정은 IO 없이 여기 둔다. 상태와 붙이기·숨기기·폐기는 registry.ts가 맡는다.
import type {
  AppBinding,
  ConnectTarget,
  ScreenSize,
  ViewMode,
} from "./app-connection.ts";
import type { ViewHealth, ViewHealthSignal } from "./crash.ts";
import type { FetchHost } from "./network-policy.ts";

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AppFrameOpen {
  app: string;
  mode: ViewMode;
  release: string | null;
  screen: string;
  size: ScreenSize;
  /** 앱 화면이 처음부터 묶인 project. 없으면 null이다. */
  project: string | null;
  parentWindow: string;
  bounds: ViewBounds;
}

export type ConnectionState =
  | "preparing"
  | "stopped"
  | "running"
  | "unavailable";

/** IPC를 보낸 view. main이 정한 신원과 묶음만 싣고 페이지 주장은 없다. */
export interface BoundView {
  view_session: string;
  generation: number;
  target: ConnectTarget;
  binding: AppBinding;
}

export interface AppFrameViewState {
  view_session: string;
  app: string;
  release: string | null;
  mode: ViewMode;
  screen: string;
  size: ScreenSize;
  connectionState: ConnectionState;
  /** 앱 화면이 고른 project. 고르지 않았으면 null이다. */
  project: string | null;
  /** 그 view 화면 process의 상태(crash.ts). 연결 상태와 따로 본다. */
  viewHealth: ViewHealth;
}

/** Electron WebContentsView 하나. */
export interface AppViewContents {
  readonly id: number;
  load(url: string): Promise<void>;
  destroy(): void;
}

/** 창과 native view를 다루는 adapter. 앱 UI 코드는 shell renderer로 오지 않는다. */
export interface AppViewHost {
  hasWindow(window: string): boolean;
  /** partition의 sandbox view를 만든다. main frame 탐색은 allowNavigation이 true일 때만 둔다. */
  create(input: {
    partition: string;
    allowNavigation(url: string): boolean;
    /** 화면 process가 사라지거나 응답이 없거나 돌아왔다(crash.ts). */
    onHealth?(signal: ViewHealthSignal): void;
  }): AppViewContents;
  /** 창 본문에 붙이거나 bounds를 옮긴다. 창이 없으면 false다. */
  attach(window: string, view: AppViewContents, bounds: ViewBounds): boolean;
  detach(window: string, view: AppViewContents): void;
  /** 이 view가 지금 키보드 focus를 가졌는가. */
  focused?(view: AppViewContents): boolean;
  /**
   * 그 view만 PNG로 캡처한다(긴 변 1,600px 이하로 줄인 것). 다른 view·창·overlay는 담지
   * 않는다. view가 crash했거나 없으면 거절한다.
   */
  capture?(view: AppViewContents): Promise<Uint8Array>;
  /** 그 view의 지금 주소. 없으면 null이다. */
  pageUrl?(view: AppViewContents): string | null;
  /** 키보드 focus를 그 창의 shell renderer로 돌린다. */
  focusShell?(window: string): void;
  /** 그 view의 페이지로 보낸다(`webContents.send`). */
  send?(view: AppViewContents, channel: string, payload: unknown): void;
}

/** 세션 앱 카드가 묶인 답의 표시 참조. 카드 입력은 싣지 않는다. */
export interface CardDisplay {
  message: string;
  block: string;
}

/** 창에 열린 view 하나의 참조. 화면 내용·DOM·캡처는 없다. */
export interface ViewListing {
  view_session: string;
  generation: number;
  app: string;
  release: string | null;
  mode: ViewMode;
  screen: string;
  size: ScreenSize;
  card: CardDisplay | null;
}

/** [Report a problem]이 버튼 시점에 고정하는 view. */
export interface FeedbackViewSnapshot {
  view_session: string;
  window: string;
  generation: number;
  app: string;
  release: string | null;
  mode: ViewMode;
  screen: string;
  bundleHash: string;
  processNonce: string;
}

const APP_ID = /^app_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const RELEASE_ID = /^rel_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const PROJECT_ID = /^prj_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const SIZES: readonly string[] = ["full", "panel", "card"];
const MODES: readonly string[] = ["live", "preview"];
const SAFE_TEXT = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 &&
  !/\p{Cc}/u.test(value);

export function boundsValid(value: unknown): value is ViewBounds {
  if (typeof value !== "object" || value === null) return false;
  const bounds = value as Record<string, unknown>;
  const keys = Object.keys(bounds).sort().join(",");
  return keys === "height,width,x,y" &&
    [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isInteger) &&
    (bounds.width as number) >= 0 && (bounds.height as number) >= 0;
}

/** 넓이가 없는 bounds다. 붙일 자리가 없으니 보이지 않는 view로 둔다. */
export function boundsEmpty(bounds: ViewBounds): boolean {
  return bounds.width <= 0 || bounds.height <= 0;
}

const OPEN_KEYS = new Set([
  "app",
  "bounds",
  "mode",
  "parentWindow",
  "project",
  "release",
  "screen",
  "size",
]);

/** appFrameOpenSchema와 같은 검사. 모르는 field도 거절한다. `project`는 없으면 null이다. */
export function checkOpen(value: unknown): AppFrameOpen | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (
    keys.some((key) => !OPEN_KEYS.has(key)) ||
    keys.filter((key) => key !== "project").length !== OPEN_KEYS.size - 1
  ) {
    return undefined;
  }
  const project = input.project ?? null;
  if (
    typeof input.app !== "string" || !APP_ID.test(input.app) ||
    !MODES.includes(input.mode as string) ||
    !(input.release === null ||
      (typeof input.release === "string" && RELEASE_ID.test(input.release))) ||
    (input.mode === "live" && input.release === null) ||
    !SAFE_TEXT(input.screen) || !SIZES.includes(input.size as string) ||
    !(project === null ||
      (typeof project === "string" && PROJECT_ID.test(project))) ||
    !SAFE_TEXT(input.parentWindow) || !boundsValid(input.bounds)
  ) {
    return undefined;
  }
  return { ...input, project } as unknown as AppFrameOpen;
}

export interface Bound {
  target: ConnectTarget;
  binding: AppBinding;
  hosts: FetchHost[];
  partition: string;
}

function sameHosts(a: readonly FetchHost[], b: readonly FetchHost[]): boolean {
  const key = (host: FetchHost) => `${host.host} ${host.port}`;
  const left = new Set(a.map(key));
  return a.length === b.length && b.every((host) => left.has(key(host))) &&
    left.size === new Set(b.map(key)).size;
}

// release·프로세스·bundle·host가 같으면 같은 묶음이다.
export function sameConnection(entry: Bound, next: Bound): boolean {
  return entry.partition === next.partition &&
    entry.binding.release === next.binding.release &&
    entry.binding.bundleHash === next.binding.bundleHash &&
    entry.binding.processNonce === next.binding.processNonce &&
    sameHosts(entry.hosts, next.hosts);
}

/** registry가 view 하나에 쥐는 것 중 밖으로 보이는 값. */
interface ViewEntry extends Bound {
  view_session: string;
  generation: number;
  connectionState: ConnectionState;
  viewHealth: ViewHealth;
}

export function stateOf(entry: ViewEntry): AppFrameViewState {
  return {
    view_session: entry.view_session,
    app: entry.target.app,
    release: entry.target.release,
    mode: entry.target.mode,
    screen: entry.target.screen,
    size: entry.target.size,
    connectionState: entry.connectionState,
    project: entry.target.project,
    viewHealth: entry.viewHealth,
  };
}

/** IPC sender의 view. main이 정한 신원과 연결만 싣는다. */
export function boundViewOf(entry: ViewEntry): BoundView {
  return {
    view_session: entry.view_session,
    generation: entry.generation,
    target: { ...entry.target },
    binding: entry.binding,
  };
}

export function targetOf(input: AppFrameOpen): ConnectTarget {
  return {
    app: input.app,
    mode: input.mode,
    release: input.release,
    screen: input.screen,
    size: input.size,
    project: input.project,
  };
}
