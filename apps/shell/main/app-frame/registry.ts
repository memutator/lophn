// 앱 view registry. `appFrame.open/replace/close`(contracts#T38)의 main service다. 연결은
// 앱 통로로 main이 얻고 view에 묶으며, 페이지가 주장한 앱·release·actor는 받을 자리가 없다
// (shell/app-frame#R12, R19). 실제 붙이기·숨기기·폐기는 이 모듈과 placement.ts만 하고 같은
// view_session과 generation으로 진단을 남긴다(R22). view가 있다는 것만으로 권한이 생기지
// 않는다(R20): view는 main이 얻은 연결의 screen·size 안에서만 화면을 받고 command 범위는
// 없다. command는 `app:call`(app-call.ts)이 이 view의 신원으로 따로 얻은 연결로만 부른다.
import {
  appEntryUrl,
  type ProtocolView,
  type Upstream,
} from "./app-protocol.ts";
import {
  type AppConnector,
  type ConnectTarget,
  failure,
  type Outcome,
} from "./app-connection.ts";
import type { ViewDiagnostics, ViewEvent } from "./diagnostics.ts";
import { bindTarget } from "./binding.ts";
import { navigationAllowed } from "./network-policy.ts";
import { createPlacement, type Placed } from "./placement.ts";
import {
  appHostLabel,
  type AppSessionHandle,
  createAppSessions,
} from "./session-policy.ts";
import {
  type AppFrameViewState,
  type AppViewHost,
  type Bound,
  boundsEmpty,
  boundsValid,
  type BoundView,
  boundViewOf,
  checkOpen,
  closedOf,
  type ClosedView,
  type ConnectionState,
  type FeedbackViewSnapshot,
  sameConnection,
  stateOf as state,
  targetOf,
  type ViewBounds,
} from "./view-model.ts";

export type {
  AppFrameOpen,
  AppFrameViewState,
  AppViewContents,
  AppViewHost,
  BoundView,
  ClosedView,
  ConnectionState,
  FeedbackViewSnapshot,
  ViewBounds,
} from "./view-model.ts";
export { checkOpen } from "./view-model.ts";

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

// 만료 이만큼 전에 연결을 다시 얻는다.
export const CONNECTION_RENEW_MS = 30_000;

interface Entry extends Bound, Placed {
  view_session: string;
  token: string;
  connectionState: ConnectionState;
  refreshing: Promise<void> | undefined;
  renewedFor: number | undefined;
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

  const bind = (target: ConnectTarget, followRelease: boolean) =>
    bindTarget(deps.connector, target, followRelease);

  function pushState(entry: Entry): void {
    deps.onState?.(entry.window, state(entry));
  }

  // 붙이기·떼기·숨기기는 placement만 한다.
  const placement = createPlacement<Entry>({ views: deps.views, record });

  // 새 contents를 만들어 등록하고 화면을 연다. 첫 load가 끝나면(실패도) 붙인다. 실패 화면은
  // view 실패 경로가 다룬다.
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
    placement.mounted(entry);
    const contents = entry.contents;
    void contents.load(appEntryUrl(label, screen)).catch(() => {}).then(() => {
      // 그 사이 닫히거나 다른 contents로 바뀌었으면 옛 load 결과로 붙이지 않는다.
      if (entries.get(entry.view_session) !== entry) return;
      if (entry.contents !== contents) return;
      placement.loaded(entry);
    });
  }

  // contents를 떼고 부순다. 이 뒤 그 contents의 요청은 어느 view에도 묶이지 않아 막힌다.
  function unmount(entry: Entry): void {
    byContents.delete(entry.contents.id);
    byToken.delete(entry.token);
    placement.unmounted(entry);
    entry.contents.destroy();
  }

  // release·연결·권한이 바뀌었다. 옛 view와 연결을 버리고 cache를 지운 뒤 다시 연다.
  async function remount(
    entry: Entry,
    next: Bound,
    at?: { window: string; bounds: ViewBounds },
  ): Promise<void> {
    const previous = entry.partition;
    unmount(entry);
    entry.generation += 1;
    record(entry, "replaced");
    Object.assign(entry, next, at ?? {});
    entry.connectionState = "running";
    await sessions.clearCache(previous);
    if (next.partition !== previous) await sessions.clearCache(next.partition);
    if (entries.get(entry.view_session) !== entry) return;
    mount(entry);
  }

  function setConnection(entry: Entry, next: ConnectionState): void {
    if (entry.connectionState === next) return;
    entry.connectionState = next;
    pushState(entry);
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
        setConnection(entry, "unavailable");
        return;
      }
      if (sameConnection(entry, next.value)) {
        entry.binding = next.value.binding;
        setConnection(entry, "running");
        return;
      }
      await remount(entry, next.value);
      if (entries.get(entry.view_session) === entry) pushState(entry);
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
    deps.closed?.(closedOf(entry));
  }

  /** 떼어 숨긴다. view와 연결은 남는다. */
  function hide(view_session: string): Outcome<{ generation: number }> {
    const entry = entries.get(view_session);
    if (entry === undefined) {
      return failure("invalid_input", "view is not open");
    }
    return placement.hide(entry);
  }

  return {
    /** 연결을 얻어 view에 묶는다. bounds가 비어 있지 않으면 준비된 뒤 창 본문에 붙인다. */
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
        shown: !boundsEmpty(input.bounds),
        ready: false,
        placed: false,
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
      const previous = closedOf(entry);
      entry.shown = !boundsEmpty(input.bounds);
      await remount(entry, next.value, {
        window: input.parentWindow,
        bounds: input.bounds,
      });
      // 같은 앱이면 같은 view_session이 그 runtime에서 이어진다. 다른 앱이면 옛 앱에서는 닫혔다.
      if (previous.app !== entry.target.app) deps.closed?.(previous);
      return { ok: true, value: state(entry) };
    },

    close,

    /**
     * 보이게 하고 bounds를 옮긴다. 준비 전이면 마지막 bounds를 기억했다가 준비되면 붙인다.
     * 실제 attach로 바뀔 때만 generation이 오른다. 빈 bounds는 숨김이다.
     */
    setBounds(
      view_session: string,
      bounds: unknown,
    ): Outcome<{ generation: number }> {
      const entry = entries.get(view_session);
      if (entry === undefined || !boundsValid(bounds)) {
        return failure("invalid_input", "view bounds are invalid");
      }
      return placement.setBounds(entry, bounds);
    },

    hide,

    /** webContents id로 지금 살아 있는 view를 찾는다. 폐기·교체된 contents는 없다. */
    senderView(contentsId: number): BoundView | undefined {
      const entry = byContents.get(contentsId);
      if (entry === undefined || entries.get(entry.view_session) !== entry) {
        return undefined;
      }
      return boundViewOf(entry);
    },

    /** [Report a problem]의 버튼 시점 view. 없는 view는 undefined다. */
    feedbackView(view_session: string): FeedbackViewSnapshot | undefined {
      const entry = entries.get(view_session);
      if (entry === undefined) return undefined;
      const contents = entry.contents;
      const generation = entry.generation;
      const current = () =>
        entries.get(view_session) === entry && entry.contents === contents &&
        entry.generation === generation;
      return {
        view_session,
        window: entry.window,
        generation,
        app: entry.target.app,
        release: entry.target.release,
        mode: entry.target.mode,
        screen: entry.target.screen,
        bundleHash: entry.binding.bundleHash,
        processNonce: entry.binding.processNonce,
        visible: entry.attached && entry.shown,
        url: deps.views.pageUrl?.(contents) ?? null,
        capture() {
          if (!current() || deps.views.capture === undefined) {
            return Promise.reject(new Error("view is not capturable"));
          }
          return deps.views.capture(contents);
        },
        current,
      };
    },

    /** 그 view가 붙는 창. 없는 view는 undefined다. */
    owner(view_session: string): string | undefined {
      return entries.get(view_session)?.window;
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
