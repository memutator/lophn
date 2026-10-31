// 앱 view registry의 값과 순수 검사. 입력 모양 검사와 같은 연결
// 판정은 IO 없이 여기 둔다. 상태와 guest 붙이기·폐기는 registry.ts가 맡는다.
import type {
  AppBinding,
  ConnectTarget,
  ScreenSize,
  ViewMode,
} from "./app-connection.ts";
import type { ViewHealth, ViewHealthSignal } from "./crash.ts";
import type { FetchHost } from "./network-policy.ts";

interface AppFrameOpen {
  app: string;
  mode: ViewMode;
  release: string | null;
  screen: string;
  size: ScreenSize;
}

export type ConnectionState =
  | "preparing"
  | "stopped"
  | "running"
  | "unavailable";

/** IPC를 보낸 view. main이 sender view에서 정한 신원과 묶음이다. */
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
  /** renderer가 `<webview src>`에 그대로 넣는 주소. main이 화면을 새로 붙일 때마다 새로 낸다. */
  src: string;
  connectionState: ConnectionState;
  /** 그 view 화면 process의 상태(crash.ts). 연결 상태와 따로 본다. */
  viewHealth: ViewHealth;
}

/** shell renderer 안의 `<webview>` guest 하나. 신원은 contents id다. */
export interface AppViewContents {
  readonly id: number;
  /** 그 guest만 PNG로 캡처한다(긴 변 1,600px 이하로 줄인 것). 다른 view·창·overlay는 담지 않는다. */
  capture(): Promise<Uint8Array>;
  /** 그 guest의 지금 주소. 없으면 null이다. */
  pageUrl(): string | null;
  /** 그 guest의 페이지로 보낸다(`webContents.send`). */
  send(channel: string, payload: unknown): void;
}

/** 붙은 guest의 webContents. registry는 Electron을 모르고 id만 쓴다. */
export interface GuestContents {
  readonly id: number;
}

/** 창과 guest를 다루는 adapter. 앱 UI 코드는 shell renderer로 오지 않는다. */
export interface AppViewHost {
  hasWindow(window: string): boolean;
  /**
   * 붙은 guest에 탐색 규칙·새 창 거절·건강 감시·캡처를 건다. allowNavigation은 그 view의
   * 규칙이고, onDestroyed는 renderer가 `<webview>`를 지워 guest가 사라졌을 때 부른다.
   */
  guest(
    contents: GuestContents,
    input: {
      allowNavigation(url: string): boolean;
      /** 화면 process가 사라지거나 응답이 없거나 돌아왔다(crash.ts). */
      onHealth?(signal: ViewHealthSignal): void;
      onDestroyed(): void;
    },
  ): AppViewContents;
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

const APP_ID = /^app_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const RELEASE_ID = /^rel_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const SIZES: readonly string[] = ["full", "panel", "card"];
const MODES: readonly string[] = ["live", "preview"];
const SAFE_TEXT = (value: unknown): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  !/\p{Cc}/u.test(value);

const OPEN_KEYS: Record<string, true> = {
  app: true,
  card: true,
  mode: true,
  release: true,
  screen: true,
  size: true,
};
const OPEN_KEY_COUNT = Object.keys(OPEN_KEYS).length;

/** 모르는 field도 거절한다. 카드는 있을 때만 센다. */
export function checkOpen(value: unknown): AppFrameOpen | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input);
  if (
    keys.some((key) => OPEN_KEYS[key] === undefined) ||
    keys.length !== OPEN_KEY_COUNT - (input.card === undefined ? 1 : 0)
  ) {
    return undefined;
  }
  if (
    typeof input.app !== "string" ||
    !APP_ID.test(input.app) ||
    !MODES.includes(input.mode as string) ||
    !(
      input.release === null ||
      (typeof input.release === "string" && RELEASE_ID.test(input.release))
    ) ||
    (input.mode === "live" && input.release === null) ||
    !SAFE_TEXT(input.screen) ||
    !SIZES.includes(input.size as string)
  ) {
    return undefined;
  }
  return input as unknown as AppFrameOpen;
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
  return (
    a.length === b.length &&
    b.every((host) => left.has(key(host))) &&
    left.size === new Set(b.map(key)).size
  );
}

// release·프로세스·bundle·host가 같으면 같은 묶음이다.
export function sameConnection(entry: Bound, next: Bound): boolean {
  return (
    entry.partition === next.partition &&
    entry.binding.release === next.binding.release &&
    entry.binding.bundleHash === next.binding.bundleHash &&
    entry.binding.processNonce === next.binding.processNonce &&
    sameHosts(entry.hosts, next.hosts)
  );
}

/** registry가 view 하나에 쥐는 것 중 밖으로 보이는 값. */
interface ViewEntry extends Bound {
  view_session: string;
  generation: number;
  src: string;
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
    src: entry.src,
    connectionState: entry.connectionState,
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
  };
}
