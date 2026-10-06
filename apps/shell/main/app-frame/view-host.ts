// app-frame registry의 경계 타입. registry와 Electron adapter, visibility가 함께 쓴다.
import type { Upstream } from "./app-protocol.ts";
import type {
  AppConnector,
  ConnectTarget,
  ScreenSize,
  ViewMode,
} from "./app-connection.ts";
import type { ViewDiagnostics } from "./diagnostics.ts";
import type { ViewBounds } from "./open-input.ts";
import type { AppSessionHandle } from "./session-policy.ts";

export type ConnectionState =
  | "preparing"
  | "stopped"
  | "running"
  | "unavailable";

export interface AppFrameViewState {
  view_session: string;
  app: string;
  release: string | null;
  mode: ViewMode;
  screen: string;
  size: ScreenSize;
  connectionState: ConnectionState;
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
  }): AppViewContents;
  /** 창 본문에 붙이거나 bounds를 옮긴다. 창이 없으면 false다. */
  attach(window: string, view: AppViewContents, bounds: ViewBounds): boolean;
  detach(window: string, view: AppViewContents): void;
  /** 이 view가 지금 키보드 focus를 가졌는가. */
  focused?(view: AppViewContents): boolean;
  /** 키보드 focus를 그 창의 shell renderer로 돌린다. */
  focusShell?(window: string): void;
}

/** 폐기되거나 다른 앱으로 교체되어 그 앱에서 닫힌 view. */
export interface ClosedView {
  app: string;
  mode: ViewMode;
  release: string | null;
  view_session: string;
}

export interface AppFrameDeps {
  connector: Pick<AppConnector, "connect" | "hosts">;
  views: AppViewHost;
  sessionHandle(partition: string): AppSessionHandle;
  upstream: Upstream;
  /** loopback에서 막을 플랫폼 port. */
  platformPorts(): readonly number[];
  diagnostics: ViewDiagnostics;
  ids: { viewSession(): string; token(): string };
  clock: { nowMs(): number };
  /** 연결 상태·release가 바뀐 view를 그 창의 shell renderer에 알린다(`shell:view-state`). */
  onState?(window: string, state: AppFrameViewState): void;
  /** view가 그 앱에서 닫혔다. 앱 runtime이 그 view_session을 버리게 한다(apps/agent-context). */
  closed?(view: ClosedView): void;
}

interface ViewFacts {
  view_session: string;
  target: ConnectTarget;
  connectionState: ConnectionState;
}

export function viewState(view: ViewFacts): AppFrameViewState {
  return {
    view_session: view.view_session,
    app: view.target.app,
    release: view.target.release,
    mode: view.target.mode,
    screen: view.target.screen,
    size: view.target.size,
    connectionState: view.connectionState,
  };
}

export function closedOf(view: ViewFacts): ClosedView {
  return {
    app: view.target.app,
    mode: view.target.mode,
    release: view.target.release,
    view_session: view.view_session,
  };
}
