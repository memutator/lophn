// 앱 view registry. `appFrame.open/replace/close`의 main service다. view가 보는 앱 process는
// main이 core 읽기로 알아 view에 묶으며, 페이지가 주장한 앱·release·actor는 받을 자리가 없다.
// 실제 붙이기·숨기기·폐기는 이 모듈과 placement.ts만 하고 같은
// view_session과 generation으로 진단을 남긴다. view가 있다는 것만으로 권한이 생기지
// 않는다: view는 자기 대상의 화면 byte만 받는다. app-api는 `app:call`(app-call.ts)이 이 view의
// 신원으로만 부른다.
import {
  appEntryUrl,
  type ProtocolView,
  type ScreenTarget,
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
import { nextHealth, reopenable, type ViewHealth } from "./crash.ts";
import { navigationAllowed } from "./network-policy.ts";
import { createPlacement, type Placed } from "./placement.ts";
import type { AnnotateViewPort } from "../../ipc/annotation.ts";
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
  type CardDisplay,
  checkOpen,
  type ConnectionState,
  type FeedbackViewSnapshot,
  sameConnection,
  stateOf as state,
  targetOf,
  type ViewBounds,
  type ViewListing,
} from "./view-model.ts";

export type {
  AppFrameViewState,
  AppViewContents,
  AppViewHost,
  BoundView,
  CardDisplay,
  ConnectionState,
  FeedbackViewSnapshot,
  ViewBounds,
  ViewListing,
} from "./view-model.ts";
export { checkOpen } from "./view-model.ts";

interface AppFrameDeps {
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
}

interface Entry extends Bound, Placed {
  view_session: string;
  token: string;
  connectionState: ConnectionState;
  /** 화면 process 상태(crash.ts). 새 contents마다 ok로 시작한다. */
  viewHealth: ViewHealth;
  refreshing: Promise<void> | undefined;
  /** 세션 카드가 묶인 message·block. 카드가 아니면 null이다. */
  card: CardDisplay | null;
}

// core가 화면 byte를 낼 대상. 묶인 release·preview process다.
function screenTargetOf(entry: Entry): ScreenTarget {
  return entry.target.mode === "live"
    ? { mode: "live", app: entry.target.app, release: entry.binding.release }
    : {
      mode: "preview",
      app: entry.target.app,
      process_nonce: entry.binding.processNonce,
    };
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
        return {
          view_session: entry.view_session,
          appLabel,
          screen: entry.target.screen,
          target: screenTargetOf(entry),
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
    // 바뀐 뒤 옛 contents가 늦게 보낸 신호는 새 view 상태가 아니다.
    const contents = deps.views.create({
      partition: entry.partition,
      allowNavigation: (url) => navigationAllowed(url, label, screen),
      onHealth: (signal) => {
        if (entries.get(entry.view_session) !== entry) return;
        if (entry.contents !== contents) return;
        setHealth(entry, nextHealth(entry.viewHealth, signal));
      },
    });
    entry.contents = contents;
    entry.viewHealth = "ok";
    entry.token = deps.ids.token();
    byContents.set(entry.contents.id, entry);
    byToken.set(entry.token, entry);
    record(entry, "created");
    placement.mounted(entry);
    void contents.load(appEntryUrl(label, screen, entry.view_session)).catch(
      () => {},
    ).then(() => {
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

  function setHealth(entry: Entry, next: ViewHealth): void {
    if (entry.viewHealth === next) return;
    entry.viewHealth = next;
    pushState(entry);
  }

  /**
   * 깨진 view에 지금 묶음(같은 binding·partition)으로 새 contents를 연다. 묶음을 다시 읽거나
   * 앱을 다시 부르지 않는다. 건강한 view는 conflict다(crash.ts).
   */
  function reopen(view_session: string): Outcome<AppFrameViewState> {
    const entry = entries.get(view_session);
    if (entry === undefined) {
      return failure("invalid_input", "view is not open");
    }
    if (!reopenable(entry.viewHealth)) {
      return failure("conflict", "view is not broken");
    }
    unmount(entry);
    entry.generation += 1;
    record(entry, "replaced");
    mount(entry);
    pushState(entry);
    return { ok: true, value: state(entry) };
  }

  function refreshEntry(entry: Entry): Promise<void> {
    if (entry.refreshing !== undefined) return entry.refreshing;
    const generation = entry.generation;
    entry.refreshing = (async () => {
      // 세션 카드는 만든 때의 release에 고정된다. 다른 release로 바꿔 열지 않고 묶음을 잃는다.
      // 다른 크기는 지금 채택된 release를 따른다.
      const next = await bind(entry.target, entry.target.size !== "card");
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
      // 읽는 사이 project가 바뀌었을 수 있다. project는 묶음이 아니라 view의 것이다.
      next.value.target.project = entry.target.project;
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
  }

  // 만든 때의 contents·generation을 고정한다. 그 사이 교체·폐기되면 `current()`가 false다.
  function annotatePort(entry: Entry): AnnotateViewPort {
    const contents = entry.contents;
    const generation = entry.generation;
    const view_session = entry.view_session;
    const current = () =>
      entries.get(view_session) === entry && entry.contents === contents &&
      entry.generation === generation;
    return {
      view_session,
      app: entry.target.app,
      release: entry.target.release,
      screen: entry.target.screen,
      pageUrl: () => deps.views.pageUrl?.(contents) ?? null,
      current,
      send(channel, payload) {
        if (current()) deps.views.send?.(contents, channel, payload);
      },
      capture() {
        if (!current() || deps.views.capture === undefined) {
          return Promise.reject(new Error("view is not capturable"));
        }
        return deps.views.capture(contents);
      },
    };
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
    async open(
      value: unknown,
      card?: CardDisplay,
    ): Promise<Outcome<AppFrameViewState>> {
      const input = checkOpen(value);
      if (
        input === undefined || (input.size === "card") !== (card !== undefined)
      ) {
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
        viewHealth: "ok",
        refreshing: undefined,
        card: card === undefined
          ? null
          : { message: card.message, block: card.block },
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
      // 카드는 묶인 답 자리 그대로 다른 대상으로 바꾸지 않는다.
      if (
        entry === undefined || input === undefined ||
        entry.card !== null || input.size === "card"
      ) {
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
      entry.shown = !boundsEmpty(input.bounds);
      await remount(entry, next.value, {
        window: input.parentWindow,
        bounds: input.bounds,
      });
      return { ok: true, value: state(entry) };
    },

    close,

    reopen,

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

    /** 앱 화면이 고른 project를 view에 묶는다(null이면 푼다). 바뀌면 state를 push한다. */
    setProject(
      view_session: string,
      project: string | null,
    ): Outcome<AppFrameViewState> {
      const entry = entries.get(view_session);
      if (entry === undefined) {
        return failure("forbidden", "view is not open");
      }
      if (entry.target.project !== project) {
        entry.target.project = project;
        pushState(entry);
      }
      return { ok: true, value: state(entry) };
    },

    /** [Report a problem]의 버튼 시점 view. 없는 view는 undefined다. */
    feedbackView(view_session: string): FeedbackViewSnapshot | undefined {
      const entry = entries.get(view_session);
      if (entry === undefined) return undefined;
      return {
        view_session,
        window: entry.window,
        generation: entry.generation,
        app: entry.target.app,
        release: entry.target.release,
        mode: entry.target.mode,
        screen: entry.target.screen,
        bundleHash: entry.binding.bundleHash,
        processNonce: entry.binding.processNonce,
      };
    },

    /** annotate가 쓰는 view 입구. 없는 view는 undefined다. */
    annotateView(view_session: string): AnnotateViewPort | undefined {
      const entry = entries.get(view_session);
      return entry === undefined ? undefined : annotatePort(entry);
    },

    /** IPC sender webContents의 annotate 입구. 폐기·교체된 contents는 undefined다. */
    senderAnnotateView(contentsId: number): AnnotateViewPort | undefined {
      const entry = byContents.get(contentsId);
      return entry === undefined || entries.get(entry.view_session) !== entry
        ? undefined
        : annotatePort(entry);
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

    /** 그 창에 열린 view의 참조. 앱 화면 내용·DOM·캡처는 싣지 않는다. */
    views(window: string): ViewListing[] {
      return [...entries.values()]
        .filter((entry) => entry.window === window)
        .map((entry) => ({
          view_session: entry.view_session,
          generation: entry.generation,
          app: entry.target.app,
          release: entry.target.release,
          mode: entry.target.mode,
          screen: entry.target.screen,
          size: entry.target.size,
          card: entry.card === null ? null : { ...entry.card },
        }));
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
