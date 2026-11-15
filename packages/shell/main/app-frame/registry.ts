// 앱 view registry. `appFrame.open/close/reopen`의 main service다. view id는 main이 정해 core의 view 표
// (`app_views/open`)에 열고, 그 view가 보는 앱 process는 core가 정한다. 페이지는 자기가 어느 앱인지 모른다.
// 화면은 shell renderer의 `<webview>` guest다: 이 모듈은 view마다 지금 `src`와 붙은 guest 하나를
// 쥐고, 붙이기 판정(acceptGuest)과 신원 묶기(bindGuest)만 한다. 위치·보임은 renderer CSS다.
// view가 있다는 것만으로 권한이 생기지 않는다: view는 자기 대상의 화면 byte만 받는다.
// operation은 `app:call-operation`(app-call.ts)이 이 view의 id로만 부른다.
import { APP_EVENT_CHANNEL } from "../../ipc/app-events.ts";
import {
  appEntryUrl,
  type ProtocolView,
  type ScreenTarget,
  type Upstream,
} from "./app-protocol.ts";
import {
  type AppConnector,
  type CoreCaller,
  failure,
  type Outcome,
} from "./app-connection.ts";
import type { ViewDiagnostics, ViewEvent } from "./diagnostics.ts";
import { bindView, type OpenRequest } from "./binding.ts";
import { nextHealth, reopenable, type ViewHealth } from "./crash.ts";
import { navigationAllowed } from "./network-policy.ts";
import type { AnnotateViewPort } from "../../ipc/annotation.ts";
import {
  appHostLabel,
  type AppSessionHandle,
  createAppSessions,
} from "./session-policy.ts";
import {
  type AppFrameViewState,
  type AppViewContents,
  type AppViewHost,
  type Bound,
  type BoundView,
  boundViewOf,
  type CardDisplay,
  checkOpen,
  type ConnectionState,
  type GuestContents,
  sameConnection,
  stateOf as state,
  type ViewListing,
} from "./view-model.ts";

export type {
  AppFrameViewState,
  AppViewContents,
  AppViewHost,
  BoundView,
  CardDisplay,
  ConnectionState,
  GuestContents,
  ViewListing,
} from "./view-model.ts";
export { checkOpen } from "./view-model.ts";

/**
 * core의 `AppViewEvent` payload 중 registry가 쓰는 것. main tsc가 protocol을 읽지 못해 구조로 받는다. core가 owner로
 * 걸러 이 shell이 연 view의 것만 온다.
 */
export type AppViewSignal =
  | {
      view: string;
      kind: "event";
      source: string;
      event: string;
      payload: unknown;
    }
  | { view: string; kind: "rebound" | "lost" };

interface AppFrameDeps {
  /** core 통로. view 표(`app_views/open|close`)를 부른다. */
  call: CoreCaller;
  connector: Pick<AppConnector, "hosts">;
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

interface Entry extends Bound {
  view_session: string;
  /** core `app_views/open`에 처음 보낸 요청 그대로. 다시 묶기(resume)는 이것으로 보낸다. */
  request: OpenRequest;
  /** 화면 세대. mount마다 오르고 진단 기록·sender 신원에 쓴다. */
  generation: number;
  token: string;
  window: string;
  /** 지금 화면을 열 guest의 주소. mount마다 새로 낸다. */
  src: string;
  /** 그 src를 붙이기로 이미 받았는가. 한 src는 1회만 받는다. */
  srcUsed: boolean;
  /** 지금 붙은 guest. renderer가 아직 안 붙였거나 지웠으면 undefined다. */
  contents: AppViewContents | undefined;
  /** 붙이기로 받았지만 아직 did-attach가 오지 않은 guest. */
  accepted: AcceptedAppGuest | undefined;
  connectionState: ConnectionState;
  /** 화면 process 상태(crash.ts). 새 guest를 받을 때마다 ok로 시작한다. */
  viewHealth: ViewHealth;
  refreshing: Promise<void> | undefined;
  /** 세션 카드가 묶인 message·block. 카드가 아니면 null이다. */
  card: CardDisplay | null;
}

/** `will-attach-webview`가 받은 이 view의 붙이기 하나. src 하나에 한 번만 준다. */
export interface AcceptedAppGuest {
  readonly src: string;
  readonly partition: string;
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

// view 하나가 새 화면을 열 때의 주소. `mount`가 바뀔 때마다 renderer가 guest를 새로 만든다.
function entryUrl(label: string, entry: Entry, mount: number): string {
  const { screen, place, params, workspace } = entry.target;
  return `${appEntryUrl(label, screen, entry.view_session, {
    place,
    params,
    workspace,
  })}&mount=${mount}`;
}

export function createAppFrame(deps: AppFrameDeps) {
  const entries = new Map<string, Entry>();
  const byContents = new Map<number, Entry>();
  const byToken = new Map<string, Entry>();
  const pending = new Map<AcceptedAppGuest, Entry>();

  function record(entry: Entry, event: ViewEvent): void {
    deps.diagnostics.record(
      {
        view_session: entry.view_session,
        generation: entry.generation,
        app: entry.target.app,
        release: entry.target.release,
        mode: entry.target.mode,
      },
      event,
    );
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
          entry === undefined ||
          appHostLabel(entry.target.app) !== appLabel
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
      stale: resume,
    },
  });

  function pushState(entry: Entry): void {
    deps.onState?.(entry.window, state(entry));
  }

  // 화면을 새로 연다. 새 세대·새 token·새 src를 내고, 옛 guest 묶음은 즉시 버린다(그 뒤 그 guest의
  // 요청은 session 정책이 막는다). load는 renderer의 `<webview>`가 src로 한다.
  function mount(entry: Entry): void {
    const label = appHostLabel(entry.target.app);
    sessions.ensure(entry.partition, label);
    unmount(entry);
    entry.generation += 1;
    entry.token = deps.ids.token();
    entry.src = entryUrl(label, entry, entry.generation);
    entry.srcUsed = false;
    entry.viewHealth = "ok";
    byToken.set(entry.token, entry);
    record(entry, "created");
  }

  // 이 view의 guest 묶음과 token을 버린다. guest 자체는 renderer가 `<webview>`를 지우며 사라진다.
  function unmount(entry: Entry): void {
    if (entry.contents !== undefined) byContents.delete(entry.contents.id);
    entry.contents = undefined;
    if (entry.accepted !== undefined) pending.delete(entry.accepted);
    entry.accepted = undefined;
    byToken.delete(entry.token);
  }

  // release·연결·권한이 바뀌었다. 옛 view와 연결을 버리고 cache를 지운 뒤 다시 연다.
  async function remount(entry: Entry, next: Bound): Promise<void> {
    const previous = entry.partition;
    unmount(entry);
    record(entry, "replaced");
    Object.assign(entry, next);
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
   * 깨진 view에 지금 묶음(같은 binding·partition)으로 새 화면을 연다. 묶음을 다시 읽거나
   * 앱을 다시 부르지 않는다. 건강한 view는 conflict다(crash.ts).
   */
  function reopen(
    window: string,
    view_session: string,
  ): Outcome<AppFrameViewState> {
    const entry = entries.get(view_session);
    if (entry === undefined || entry.window !== window) {
      return failure("invalid_input", "view is not open");
    }
    if (!reopenable(entry.viewHealth)) {
      return failure("conflict", "view is not broken");
    }
    mount(entry);
    pushState(entry);
    return { ok: true, value: state(entry) };
  }

  function refreshEntry(entry: Entry): Promise<void> {
    if (entry.refreshing !== undefined) return entry.refreshing;
    const generation = entry.generation;
    entry.refreshing = (async () => {
      // 같은 요청으로 core에 다시 묶는다. 세션 카드와 preview는 처음 release 그대로다(카드는 다른 release면 묶음을 잃는다).
      // 카드가 아닌 live view는 release 없이 보내 core가 view를 잃었어도 지금 채택된 release로 다시 연다.
      const request =
        entry.request.mode === "live" && entry.request.place !== "card"
          ? { ...entry.request, release: null }
          : entry.request;
      const next = await bindView(deps.call, deps.connector, request);
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

  function resume(view_session: string): void {
    const entry = entries.get(view_session);
    if (entry !== undefined) void refreshEntry(entry);
  }

  // core 표의 view를 닫는다. 기다리지 않고 실패도 무시한다(core가 다시 뜨면 표는 어차피 비어 있다).
  function closeCore(view: string): void {
    void deps
      .call("memory", "app_views", "close", { view })
      .catch(() => undefined);
  }

  /** view를 폐기한다. 없는 view는 아무것도 하지 않는다. persist partition의 앱 저장은 남는다. */
  function close(view_session: string): void {
    const entry = entries.get(view_session);
    if (entry === undefined) return;
    entries.delete(view_session);
    unmount(entry);
    record(entry, "disposed");
    closeCore(view_session);
  }

  // 만든 때의 guest·generation을 고정한다. 그 사이 교체·폐기되면 `current()`가 false다.
  function annotatePort(entry: Entry): AnnotateViewPort {
    const view_session = entry.view_session;
    const current = () => entries.get(view_session) === entry;
    return {
      view_session,
      target: {
        kind: "app",
        app: entry.target.app,
        release: entry.target.release,
        // preview view는 release 대신 그 process의 bundle hash를 싣는다.
        preview:
          entry.target.mode === "preview" ? entry.binding.bundleHash : null,
        screen: entry.target.screen,
      },
      pageUrl: () => entry.contents?.pageUrl() ?? null,
      current,
      send(channel, payload) {
        const contents = entry.contents;
        if (contents !== undefined) contents.send(channel, payload);
      },
      async capture() {
        const contents = entry.contents;
        if (contents === undefined) throw new Error("view is not capturable");
        const png = await contents.capture();
        // 캡처하는 사이 guest가 바뀌었으면 그 그림은 이 view의 것이 아니다.
        if (entry.contents !== contents) {
          throw new Error("view changed while capturing");
        }
        return png;
      },
    };
  }

  return {
    /** core에 view를 열어 묶는다. 화면 src는 renderer가 붙인다. */
    async open(
      window: string,
      value: unknown,
      card?: CardDisplay,
    ): Promise<Outcome<AppFrameViewState>> {
      // IPC 입력은 renderer가 보낸 것이라 모양을 한 번 본다. 선언과 params 검사는 core가 한다.
      const input = checkOpen(value);
      if (
        input === undefined ||
        (input.place === "card") !== (card !== undefined)
      ) {
        return failure("invalid_input", "view request is invalid");
      }
      if (!deps.views.hasWindow(window)) {
        return failure("invalid_input", "window is not open");
      }
      const request: OpenRequest = {
        view: deps.ids.viewSession(),
        mode: input.mode,
        app: input.app,
        release: input.release,
        screen: input.screen,
        place: input.place,
        ...(input.params === undefined ? {} : { params: input.params }),
        ...(input.workspace === undefined
          ? {}
          : { workspace: input.workspace }),
      };
      const bound = await bindView(deps.call, deps.connector, request);
      // core에 열렸지만 쓰지 못하는 view(host를 못 읽음, 그 사이 창이 닫힘)는 core 표에서도 닫는다.
      if (!bound.ok || !deps.views.hasWindow(window)) {
        closeCore(request.view);
        return bound.ok
          ? failure("invalid_input", "window is not open")
          : bound;
      }
      const entry: Entry = {
        ...bound.value,
        request,
        view_session: request.view,
        token: "",
        window,
        src: "",
        srcUsed: false,
        contents: undefined,
        accepted: undefined,
        generation: 0,
        connectionState: "running",
        viewHealth: "ok",
        refreshing: undefined,
        card:
          card === undefined
            ? null
            : { message: card.message, block: card.block },
      };
      entries.set(entry.view_session, entry);
      mount(entry);
      return { ok: true, value: state(entry) };
    },

    close,

    reopen,

    /**
     * `<webview>` 붙이기 하나를 받는다. 이 창의 view이고 그 src를 아직 안 붙였을 때만 받는다
     * (1회용). 아니면 undefined다.
     */
    acceptGuest(window: string, src: string): AcceptedAppGuest | undefined {
      for (const entry of entries.values()) {
        if (entry.window !== window || entry.src !== src) continue;
        if (entry.srcUsed || entry.contents !== undefined) return undefined;
        try {
          sessions.ensure(entry.partition, appHostLabel(entry.target.app));
        } catch {
          return undefined;
        }
        entry.srcUsed = true;
        const accepted: AcceptedAppGuest = Object.freeze({
          src: entry.src,
          partition: entry.partition,
        });
        entry.accepted = accepted;
        pending.set(accepted, entry);
        return accepted;
      }
      return undefined;
    },

    /** 받아 두었지만 붙지 못한 붙이기를 버린다(창이 닫히거나 규칙이 뒤에서 거절). */
    dropGuest(accepted: AcceptedAppGuest): void {
      const entry = pending.get(accepted);
      if (entry === undefined || entry.accepted !== accepted) return;
      pending.delete(accepted);
      entry.accepted = undefined;
    },

    /** 받아 둔 붙이기의 guest를 view 신원·건강 감시에 묶는다(did-attach). */
    bindGuest(accepted: AcceptedAppGuest, guest: GuestContents): void {
      const entry = pending.get(accepted);
      if (entry === undefined) return;
      pending.delete(accepted);
      if (entry.accepted !== accepted) return;
      entry.accepted = undefined;
      if (
        entries.get(entry.view_session) !== entry ||
        entry.src !== accepted.src
      ) {
        return;
      }
      let bound: AppViewContents | undefined;
      const contents = deps.views.guest(guest, {
        allowNavigation: (url) =>
          navigationAllowed(
            url,
            appHostLabel(entry.target.app),
            entry.target.screen,
          ),
        onHealth(signal) {
          if (entries.get(entry.view_session) !== entry) return;
          if (bound === undefined || entry.contents !== bound) return;
          setHealth(entry, nextHealth(entry.viewHealth, signal));
        },
        onDestroyed() {
          if (bound === undefined || entry.contents !== bound) return;
          entry.contents = undefined;
          byContents.delete(bound.id);
        },
      });
      bound = contents;
      entry.contents = contents;
      byContents.set(contents.id, entry);
    },

    /** webContents id로 지금 살아 있는 view를 찾는다. 폐기·교체된 contents는 없다. */
    senderView(contentsId: number): BoundView | undefined {
      const entry = byContents.get(contentsId);
      if (entry === undefined || entries.get(entry.view_session) !== entry) {
        return undefined;
      }
      return boundViewOf(entry);
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
     * app을 주지 않으면 모든 view다(core에 다시 붙었을 때).
     */
    async refresh(app?: string): Promise<void> {
      await Promise.all(
        [...entries.values()]
          .filter((entry) => app === undefined || entry.target.app === app)
          .map(refreshEntry),
      );
    },

    /** core에 그 view를 다시 묶는다(core가 그 view를 모를 때). 없는 view는 아무것도 하지 않는다. */
    resume,

    /**
     * core의 `AppViewEvent` 하나. 앱 event는 그 view의 page로 보내고(page가 아직 안 붙었으면 버린다), 다시 묶였거나
     * 묶음을 잃었으면 같은 요청으로 다시 묶어 본다. 모르는 view의 것은 버린다.
     */
    viewEvent(payload: AppViewSignal): void {
      const entry = entries.get(payload.view);
      if (entry === undefined) return;
      if (payload.kind === "event") {
        entry.contents?.send(APP_EVENT_CHANNEL, {
          source: payload.source,
          event: payload.event,
          payload: payload.payload,
        });
        return;
      }
      void refreshEntry(entry);
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
          place: entry.target.place,
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
