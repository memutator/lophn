// 앱 view registry. `appFrame.open/replace/close`(contracts#T38)의 main service다. 연결은
// 앱 통로로 main이 얻고 view에 묶으며, 페이지가 주장한 앱·release·actor는 받을 자리가 없다
// (shell/app-frame#R12, R19). 실제 붙이기·숨기기·폐기는 이 모듈만 하고 같은 view_session과
// generation으로 진단을 남긴다(R22). view가 있다는 것만으로 권한이 생기지 않는다(R20): view는
// main이 얻은 연결의 screen·size 안에서만 화면을 받고 command 범위는 없다. command는
// `app:call`(app-call.ts)이 이 view의 신원으로 따로 얻은 연결로만 부른다.
import {
  appEntryUrl,
  type ProtocolView,
  type Upstream,
} from "./app-protocol.ts";
import {
  type AppBinding,
  type AppConnector,
  type ConnectTarget,
  failure,
  type Outcome,
  type ScreenSize,
  type ViewMode,
} from "./app-connection.ts";
import type { ViewDiagnostics, ViewEvent } from "./diagnostics.ts";
import { type FetchHost, navigationAllowed } from "./network-policy.ts";
import {
  appHostLabel,
  appPartition,
  type AppSessionHandle,
  createAppSessions,
} from "./session-policy.ts";

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
  parentWindow: string;
  bounds: ViewBounds;
}

export type ConnectionState =
  | "preparing"
  | "stopped"
  | "running"
  | "unavailable";

/** IPC를 보낸 view. main이 정한 신원과 연결만 싣고 페이지 주장은 없다(R12). */
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
}

// 만료 이만큼 전에 연결을 다시 얻는다.
export const CONNECTION_RENEW_MS = 30_000;

const APP_ID = /^app_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const RELEASE_ID = /^rel_[0-7][0-9a-hjkmnp-tv-z]{25}$/;
const SIZES: readonly string[] = ["full", "panel", "card"];
const MODES: readonly string[] = ["live", "preview"];
const SAFE_TEXT = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0 &&
  !/\p{Cc}/u.test(value);

function boundsValid(value: unknown): value is ViewBounds {
  if (typeof value !== "object" || value === null) return false;
  const bounds = value as Record<string, unknown>;
  const keys = Object.keys(bounds).sort().join(",");
  return keys === "height,width,x,y" &&
    [bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isInteger) &&
    (bounds.width as number) >= 0 && (bounds.height as number) >= 0;
}

/** contracts#T38 appFrameOpenSchema와 같은 검사. 모르는 field도 거절한다. */
export function checkOpen(value: unknown): AppFrameOpen | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort().join(",");
  if (keys !== "app,bounds,mode,parentWindow,release,screen,size") return;
  if (
    typeof input.app !== "string" || !APP_ID.test(input.app) ||
    !MODES.includes(input.mode as string) ||
    !(input.release === null ||
      (typeof input.release === "string" && RELEASE_ID.test(input.release))) ||
    (input.mode === "live" && input.release === null) ||
    !SAFE_TEXT(input.screen) || !SIZES.includes(input.size as string) ||
    !SAFE_TEXT(input.parentWindow) || !boundsValid(input.bounds)
  ) {
    return undefined;
  }
  return input as unknown as AppFrameOpen;
}

interface Bound {
  target: ConnectTarget;
  binding: AppBinding;
  hosts: FetchHost[];
  partition: string;
}

interface Entry extends Bound {
  view_session: string;
  token: string;
  generation: number;
  window: string;
  bounds: ViewBounds;
  attached: boolean;
  contents: AppViewContents;
  connectionState: ConnectionState;
  refreshing: Promise<void> | undefined;
  renewedFor: number | undefined;
}

function sameHosts(a: readonly FetchHost[], b: readonly FetchHost[]): boolean {
  const key = (host: FetchHost) => `${host.host} ${host.port}`;
  const left = new Set(a.map(key));
  return a.length === b.length && b.every((host) => left.has(key(host))) &&
    left.size === new Set(b.map(key)).size;
}

// release·프로세스·bundle·endpoint·host가 같으면 같은 연결이다. 만료만 다르면 새 서명만 쓴다.
function sameConnection(entry: Entry, next: Bound): boolean {
  return entry.partition === next.partition &&
    entry.binding.release === next.binding.release &&
    entry.binding.bundleHash === next.binding.bundleHash &&
    entry.binding.processNonce === next.binding.processNonce &&
    entry.binding.endpoint === next.binding.endpoint &&
    sameHosts(entry.hosts, next.hosts);
}

export function createAppFrame(deps: AppFrameDeps) {
  const entries = new Map<string, Entry>();
  const byContents = new Map<number, Entry>();
  const byToken = new Map<string, Entry>();

  function record(entry: Entry, event: ViewEvent): void {
    deps.diagnostics.record({
      view_session: entry.view_session,
      generation: entry.generation,
      app: entry.target.app,
      release: entry.target.release,
      mode: entry.target.mode,
    }, event);
  }

  // 같은 만료 시각으로는 한 번만 다시 얻는다. credential 기한이 가까워 core가 같은 만료를
  // 다시 주어도 화면 요청마다 연결을 새로 얻지 않는다.
  function renewIfDue(entry: Entry): void {
    const expires = entry.binding.expiresAtMs;
    if (
      expires !== null && entry.renewedFor !== expires &&
      expires - deps.clock.nowMs() <= CONNECTION_RENEW_MS
    ) {
      entry.renewedFor = expires;
      void refreshEntry(entry);
    }
  }

  const sessions = createAppSessions({
    handle: deps.sessionHandle,
    viewOf(contentsId) {
      if (contentsId === undefined) return undefined;
      const entry = byContents.get(contentsId);
      if (entry === undefined) return undefined;
      return {
        token: entry.token,
        appLabel: appHostLabel(entry.target.app),
        hosts: entry.hosts,
      };
    },
    platformPorts: deps.platformPorts,
    protocol: {
      viewFor(token, appLabel): ProtocolView | undefined {
        const entry = token === null ? undefined : byToken.get(token);
        if (
          entry === undefined || appHostLabel(entry.target.app) !== appLabel
        ) {
          return undefined;
        }
        renewIfDue(entry);
        return {
          view_session: entry.view_session,
          appLabel,
          screen: entry.target.screen,
          size: entry.target.size,
          endpoint: entry.binding.endpoint,
          authorization: entry.binding.authorization,
          hosts: entry.hosts,
        };
      },
      upstream: deps.upstream,
      stale(view_session) {
        const entry = entries.get(view_session);
        if (entry !== undefined) void refreshEntry(entry);
      },
    },
  });

  async function bind(
    target: ConnectTarget,
    followRelease: boolean,
  ): Promise<Outcome<Bound>> {
    const binding = await deps.connector.connect(target, followRelease);
    if (!binding.ok) return binding;
    const hosts = await deps.connector.hosts(
      target.app,
      binding.value.release,
    );
    if (!hosts.ok) return hosts;
    return {
      ok: true,
      value: {
        target: { ...target, release: binding.value.release },
        binding: binding.value,
        hosts: hosts.value,
        partition: appPartition(
          target.app,
          target.mode,
          binding.value.bundleHash,
        ),
      },
    };
  }

  function state(entry: Entry): AppFrameViewState {
    return {
      view_session: entry.view_session,
      app: entry.target.app,
      release: entry.target.release,
      mode: entry.target.mode,
      screen: entry.target.screen,
      size: entry.target.size,
      connectionState: entry.connectionState,
    };
  }

  // 새 contents를 만들어 등록하고 붙인 뒤 화면을 연다. 첫 load 실패는 view 실패 경로가 다룬다.
  function mount(entry: Entry): void {
    const label = appHostLabel(entry.target.app);
    sessions.ensure(entry.partition, label);
    const screen = entry.target.screen;
    entry.contents = deps.views.create({
      partition: entry.partition,
      allowNavigation: (url) => navigationAllowed(url, label, screen),
    });
    entry.token = deps.ids.token();
    byContents.set(entry.contents.id, entry);
    byToken.set(entry.token, entry);
    record(entry, "created");
    if (deps.views.attach(entry.window, entry.contents, entry.bounds)) {
      entry.attached = true;
      record(entry, "attached");
    }
    void entry.contents.load(appEntryUrl(label, screen)).catch(() => {});
  }

  // contents를 떼고 부순다. 이 뒤 그 contents의 요청은 어느 view에도 묶이지 않아 막힌다.
  function unmount(entry: Entry): void {
    byContents.delete(entry.contents.id);
    byToken.delete(entry.token);
    if (entry.attached) deps.views.detach(entry.window, entry.contents);
    entry.attached = false;
    entry.contents.destroy();
  }

  // release·연결·권한이 바뀌었다. 옛 view와 연결을 버리고 cache를 지운 뒤 다시 연다.
  async function remount(
    entry: Entry,
    next: Bound,
    place?: { window: string; bounds: ViewBounds },
  ): Promise<void> {
    const previous = entry.partition;
    unmount(entry);
    entry.generation += 1;
    record(entry, "replaced");
    Object.assign(entry, next, place ?? {});
    entry.connectionState = "running";
    await sessions.clearCache(previous);
    if (next.partition !== previous) await sessions.clearCache(next.partition);
    if (entries.get(entry.view_session) !== entry) return;
    mount(entry);
  }

  function refreshEntry(entry: Entry): Promise<void> {
    if (entry.refreshing !== undefined) return entry.refreshing;
    const generation = entry.generation;
    entry.refreshing = (async () => {
      const next = await bind(entry.target, true);
      // 그 사이 닫히거나 교체됐으면 늦은 결과를 붙이지 않는다.
      if (
        entries.get(entry.view_session) !== entry ||
        entry.generation !== generation
      ) {
        return;
      }
      if (!next.ok) {
        entry.connectionState = "unavailable";
        return;
      }
      if (sameConnection(entry, next.value)) {
        entry.binding = next.value.binding;
        entry.connectionState = "running";
        return;
      }
      await remount(entry, next.value);
    })().finally(() => {
      entry.refreshing = undefined;
    });
    return entry.refreshing;
  }

  /** view를 폐기한다. 없는 view는 아무것도 하지 않는다. persist partition의 앱 저장은 남는다. */
  function close(view_session: string): void {
    const entry = entries.get(view_session);
    if (entry === undefined) return;
    entries.delete(view_session);
    unmount(entry);
    entry.generation += 1;
    record(entry, "disposed");
  }

  function targetOf(input: AppFrameOpen): ConnectTarget {
    return {
      app: input.app,
      mode: input.mode,
      release: input.release,
      screen: input.screen,
      size: input.size,
    };
  }

  return {
    /** 연결을 얻어 view에 묶고 창 본문에 붙인다. */
    async open(value: unknown): Promise<Outcome<AppFrameViewState>> {
      const input = checkOpen(value);
      if (input === undefined) {
        return failure("invalid_input", "view request is invalid");
      }
      if (!deps.views.hasWindow(input.parentWindow)) {
        return failure("invalid_input", "window is not open");
      }
      const bound = await bind(targetOf(input), false);
      if (!bound.ok) return bound;
      if (!deps.views.hasWindow(input.parentWindow)) {
        return failure("invalid_input", "window is not open");
      }
      const entry = {
        ...bound.value,
        view_session: deps.ids.viewSession(),
        token: "",
        generation: 1,
        window: input.parentWindow,
        bounds: input.bounds,
        attached: false,
        connectionState: "running",
        refreshing: undefined,
        renewedFor: undefined,
      } as Entry;
      entries.set(entry.view_session, entry);
      mount(entry);
      return { ok: true, value: state(entry) };
    },

    /** 같은 view_session을 새 대상으로 다시 연다. 실패하면 옛 view를 그대로 둔다. */
    async replace(
      view_session: string,
      value: unknown,
    ): Promise<Outcome<AppFrameViewState>> {
      const entry = entries.get(view_session);
      const input = checkOpen(value);
      if (entry === undefined || input === undefined) {
        return failure("invalid_input", "view request is invalid");
      }
      if (!deps.views.hasWindow(input.parentWindow)) {
        return failure("invalid_input", "window is not open");
      }
      const generation = entry.generation;
      const next = await bind(targetOf(input), false);
      if (!next.ok) return next;
      if (
        entries.get(view_session) !== entry || entry.generation !== generation
      ) {
        return failure("conflict", "view changed while replacing");
      }
      await remount(entry, next.value, {
        window: input.parentWindow,
        bounds: input.bounds,
      });
      return { ok: true, value: state(entry) };
    },

    close,

    /** 붙이거나 bounds를 옮긴다. 실제 attach로 바뀔 때만 generation이 오른다. */
    setBounds(
      view_session: string,
      bounds: unknown,
    ): Outcome<{ generation: number }> {
      const entry = entries.get(view_session);
      if (entry === undefined || !boundsValid(bounds)) {
        return failure("invalid_input", "view bounds are invalid");
      }
      if (!deps.views.attach(entry.window, entry.contents, bounds)) {
        return failure("unavailable", "window is not open");
      }
      entry.bounds = bounds;
      if (!entry.attached) {
        entry.attached = true;
        entry.generation += 1;
        record(entry, "attached");
      }
      return { ok: true, value: { generation: entry.generation } };
    },

    /** 떼어 숨긴다. view와 연결은 남는다. */
    hide(view_session: string): Outcome<{ generation: number }> {
      const entry = entries.get(view_session);
      if (entry === undefined) {
        return failure("invalid_input", "view is not open");
      }
      if (entry.attached) {
        deps.views.detach(entry.window, entry.contents);
        entry.attached = false;
        entry.generation += 1;
        record(entry, "hidden");
      }
      return { ok: true, value: { generation: entry.generation } };
    },

    /**
     * 연결과 grant를 다시 읽는다. release·프로세스·bundle·host가 바뀐 view는 다시 연다.
     * app을 주지 않으면 모든 view다(앱을 싣지 않는 event).
     */
    async refresh(app?: string): Promise<void> {
      await Promise.all(
        [...entries.values()]
          .filter((entry) => app === undefined || entry.target.app === app)
          .map(refreshEntry),
      );
    },

    /** webContents id로 지금 살아 있는 view를 찾는다. 폐기·교체된 contents는 없다. */
    senderView(contentsId: number): BoundView | undefined {
      const entry = byContents.get(contentsId);
      if (entry === undefined || entries.get(entry.view_session) !== entry) {
        return undefined;
      }
      return {
        view_session: entry.view_session,
        generation: entry.generation,
        target: { ...entry.target },
        binding: entry.binding,
      };
    },

    state(view_session: string): AppFrameViewState | undefined {
      const entry = entries.get(view_session);
      return entry === undefined ? undefined : state(entry);
    },

    /** 닫힌 창의 view를 모두 폐기한다. */
    closeWindow(window: string): void {
      for (const entry of [...entries.values()]) {
        if (entry.window === window) close(entry.view_session);
      }
    },

    dispose(): void {
      for (const entry of [...entries.values()]) close(entry.view_session);
    },
  };
}

export type AppFrameService = ReturnType<typeof createAppFrame>;
