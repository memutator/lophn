// browser 탭의 native view 목록. view 하나는 contents 하나와 그 위치(placement)다. 앱 view
// registry(app-frame/registry.ts)는 앱 연결에 묶여 있어 여기 넣지 않고, 위치·숨김만 같은
// createPlacement를 쓴다. 규칙(navigation·활동·주소 정리)은 이 폴더의 순수 모듈이 정한다.
import type {
  BrowserEvent,
  BrowserViewState,
  PopupPlacement,
} from "../../ipc/browser.ts";
import { failure, type Outcome } from "../app-frame/app-connection.ts";
import {
  nextHealth,
  reopenable,
  type ViewHealth,
  type ViewHealthSignal,
} from "../app-frame/crash.ts";
import { createPlacement, type Placed } from "../app-frame/placement.ts";
import type {
  AppViewContents,
  AppViewHost,
  ViewBounds,
} from "../app-frame/view-model.ts";
import { normalizeAddress } from "./address.ts";
import { decideNavigation } from "./navigation.ts";

// ipc/browser.ts의 title 상한. 넘으면 renderer의 schema가 push를 버린다.
const TITLE_MAX = 1024;

export interface BrowserPage {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

export interface BrowserContents extends AppViewContents {
  page(): BrowserPage;
  back(): void;
  forward(): void;
  reload(): void;
  inspect(): void;
  /** 첫 load가 끝나면(실패도) 풀린다. Electron이 load를 시작한 popup contents에 쓴다. */
  firstLoad(): Promise<void>;
}

/** contents에 거는 hook이 부르는 것. popup으로 생긴 contents에도 같은 모양을 쓴다. */
export interface BrowserHooks {
  activation: {
    mark(contentsId: number): void;
    fresh(contentsId: number): boolean;
    forget(contentsId: number): void;
  };
  /** OS 기본 앱으로 넘긴다(mailto, tel). */
  openExternal(url: string): void;
  /** page 상태(주소·제목·loading·history)가 바뀌었다. */
  onChange(): void;
  onHealth(signal: ViewHealthSignal): void;
  onBookmarkKey(): void;
  /** page가 window.close()를 불렀다. contents는 Electron이 곧 부순다. */
  onClose(): void;
  popup: {
    /** 사용자 입력 없이 열려던 popup을 거절했다. */
    blocked(): void;
    /** popup을 새 view로 등록한다. make가 만든 contents가 그 view의 것이다. */
    open(
      placement: PopupPlacement,
      make: (hooks: BrowserHooks) => BrowserContents,
    ): void;
  };
}

export interface BrowserViewHost extends
  Pick<
    AppViewHost,
    "hasWindow" | "attach" | "detach" | "focused" | "focusShell"
  > {
  create(hooks: BrowserHooks): BrowserContents;
}

interface BrowserViewsDeps {
  host: BrowserViewHost;
  activation: BrowserHooks["activation"];
  openExternal(url: string): void;
  ids: { viewSession(): string };
  /** 그 창의 renderer로 상태를 민다. */
  pushState(window: string, state: BrowserViewState): void;
  pushEvent(window: string, event: BrowserEvent): void;
}

interface Entry extends Placed {
  view_session: string;
  contents: BrowserContents;
  // popup으로 생긴 view는 renderer가 탭을 만들어 가져가기(adopt) 전까지 false다.
  adopted: boolean;
  health: ViewHealth;
  // crash한 contents를 다시 열 주소. 읽을 때마다 비어 있지 않은 마지막 값을 남긴다.
  lastUrl: string;
}

const notOpen = () => failure("invalid_input", "view is not open");

export function createBrowserViews(deps: BrowserViewsDeps) {
  const entries = new Map<string, Entry>();
  const placement = createPlacement<Entry>({
    views: deps.host,
    record: () => {},
  });

  function state(entry: Entry): BrowserViewState {
    const page = entry.contents.page();
    if (page.url !== "") entry.lastUrl = page.url;
    return {
      view_session: entry.view_session,
      url: page.url,
      title: page.title.slice(0, TITLE_MAX),
      loading: page.loading,
      canGoBack: page.canGoBack,
      canGoForward: page.canGoForward,
      health: entry.health,
    };
  }

  // adopt 전 popup은 renderer에 탭이 없다. adopt가 지금 state로 답한다.
  function push(entry: Entry): void {
    if (entry.adopted) deps.pushState(entry.window, state(entry));
  }

  // 교체·폐기된 contents가 늦게 보낸 신호는 지금 view의 것이 아니다.
  function spawn(
    view_session: string,
    make: (hooks: BrowserHooks) => BrowserContents = (hooks) =>
      deps.host.create(hooks),
  ): BrowserContents {
    const live = () => {
      const entry = entries.get(view_session);
      return entry?.contents === contents ? entry : undefined;
    };
    const contents: BrowserContents = make({
      activation: deps.activation,
      openExternal: deps.openExternal,
      onChange() {
        const entry = live();
        if (entry !== undefined) push(entry);
      },
      onHealth(signal) {
        const entry = live();
        if (entry === undefined) return;
        entry.health = nextHealth(entry.health, signal);
        push(entry);
      },
      onBookmarkKey() {
        const entry = live();
        if (entry !== undefined) {
          deps.pushEvent(entry.window, { kind: "bookmark-key", view_session });
        }
      },
      onClose() {
        const entry = live();
        if (entry !== undefined) {
          deps.pushEvent(entry.window, { kind: "close", view_session });
        }
      },
      popup: {
        blocked() {
          const entry = live();
          if (entry !== undefined) {
            deps.pushEvent(entry.window, {
              kind: "popup-blocked",
              view_session,
            });
          }
        },
        open(where, make) {
          const opener = live();
          if (opener !== undefined) openPopup(opener, where, make);
        },
      },
    });
    return contents;
  }

  // 첫 load가 끝나면(실패도) 붙일 수 있다. 빈 주소 칸으로 연 view는 첫 navigate가 첫 load다.
  function load(entry: Entry, url: string): void {
    firstLoaded(entry, entry.contents.load(url));
  }

  function firstLoaded(entry: Entry, loaded: Promise<void>): void {
    const contents = entry.contents;
    void loaded.catch(() => {}).then(() => {
      if (entries.get(entry.view_session) !== entry) return;
      if (entry.contents !== contents || entry.ready) return;
      placement.loaded(entry);
    });
  }

  // 소유 창은 opener의 창이다. renderer가 adopt하지 않은 view는 그 창이 닫힐 때까지 남는다.
  function openPopup(
    opener: Entry,
    where: PopupPlacement,
    make: (hooks: BrowserHooks) => BrowserContents,
  ): void {
    const view_session = deps.ids.viewSession();
    const entry: Entry = {
      view_session,
      window: opener.window,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      contents: spawn(view_session, make),
      generation: 0,
      shown: false,
      ready: false,
      placed: false,
      attached: false,
      adopted: false,
      health: "ok",
      lastUrl: "",
    };
    entries.set(view_session, entry);
    placement.mounted(entry);
    firstLoaded(entry, entry.contents.firstLoad());
    deps.pushEvent(opener.window, {
      kind: "popup",
      opener: opener.view_session,
      view_session,
      placement: where,
    });
  }

  function dispose(entry: Entry): void {
    entries.delete(entry.view_session);
    placement.unmounted(entry);
    entry.contents.destroy();
  }

  function ownedEntry(window: string, view_session: string): Entry | undefined {
    const entry = entries.get(view_session);
    return entry?.window === window ? entry : undefined;
  }

  return {
    open(window: string, url: string): Promise<Outcome<BrowserViewState>> {
      if (!deps.host.hasWindow(window)) {
        return Promise.resolve(failure("invalid_input", "window is not open"));
      }
      const view_session = deps.ids.viewSession();
      const entry: Entry = {
        view_session,
        window,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        contents: spawn(view_session),
        generation: 0,
        shown: false,
        ready: false,
        placed: false,
        attached: false,
        adopted: true,
        health: "ok",
        lastUrl: "",
      };
      entries.set(view_session, entry);
      placement.mounted(entry);
      const address = normalizeAddress(url);
      if (
        address !== null &&
        decideNavigation({ url: address, isMainFrame: true }).allow
      ) {
        load(entry, address);
      }
      return Promise.resolve({ ok: true, value: state(entry) });
    },

    /** renderer가 popup으로 생긴 view에 탭을 만들었다. 그 창이 아직 가져가지 않은 view만 된다. */
    adopt(window: string, view_session: string): Outcome<BrowserViewState> {
      const entry = ownedEntry(window, view_session);
      if (entry === undefined) return notOpen();
      if (entry.adopted) return failure("forbidden", "view is already adopted");
      entry.adopted = true;
      return { ok: true, value: state(entry) };
    },

    navigate(
      window: string,
      view_session: string,
      input: string,
    ): Outcome<BrowserViewState> {
      const entry = ownedEntry(window, view_session);
      if (entry === undefined) return notOpen();
      const address = normalizeAddress(input);
      if (address === null) return failure("invalid_input", "address is empty");
      const decision = decideNavigation({ url: address, isMainFrame: true });
      if (!decision.allow) {
        if (
          decision.external && deps.activation.fresh(entry.contents.id)
        ) {
          deps.openExternal(address);
          return { ok: true, value: state(entry) };
        }
        return failure("invalid_input", "address is not allowed");
      }
      load(entry, address);
      return { ok: true, value: state(entry) };
    },

    command(
      window: string,
      view_session: string,
      command: "back" | "forward" | "reload" | "inspect",
    ): Outcome<null> {
      const entry = ownedEntry(window, view_session);
      if (entry === undefined) return notOpen();
      if (command === "reload" && reopenable(entry.health)) {
        // 깨진 contents는 reload로 살아나지 않는다. 같은 view_session에 새 contents를 만든다.
        placement.unmounted(entry);
        entry.contents.destroy();
        entry.contents = spawn(view_session);
        entry.health = "ok";
        placement.mounted(entry);
        if (entry.lastUrl !== "") load(entry, entry.lastUrl);
        push(entry);
      } else if (command === "back") entry.contents.back();
      else if (command === "forward") entry.contents.forward();
      else if (command === "reload") entry.contents.reload();
      else entry.contents.inspect();
      return { ok: true, value: null };
    },

    has: (view_session: string) => entries.has(view_session),

    owner: (view_session: string) => entries.get(view_session)?.window,

    setBounds(view_session: string, bounds: ViewBounds) {
      const entry = entries.get(view_session);
      return entry === undefined
        ? notOpen()
        : placement.setBounds(entry, bounds);
    },

    hide(view_session: string) {
      const entry = entries.get(view_session);
      return entry === undefined ? notOpen() : placement.hide(entry);
    },

    close(view_session: string): void {
      const entry = entries.get(view_session);
      if (entry !== undefined) dispose(entry);
    },

    /** Clear browsing data 뒤. 빈 주소 칸과 crash한 view는 건드리지 않는다. */
    reloadAll(): void {
      for (const entry of entries.values()) {
        if (entry.health === "crashed" || entry.contents.page().url === "") {
          continue;
        }
        entry.contents.reload();
      }
    },

    closeWindow(window: string): void {
      for (const entry of [...entries.values()]) {
        if (entry.window === window) dispose(entry);
      }
    },

    dispose(): void {
      for (const entry of [...entries.values()]) dispose(entry);
    },
  };
}

export type BrowserViews = ReturnType<typeof createBrowserViews>;
