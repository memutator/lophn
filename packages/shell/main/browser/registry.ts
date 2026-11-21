// browser 탭의 page 목록. 보통 탭은 shell renderer의 <webview> guest(위치·숨김은 renderer CSS)이고,
// 크기 준 popup만 native view(contents 하나와 그 위치 placement)다. 앱 view registry
// (app-frame/registry.ts)는 앱 연결에 묶여 있어 여기 넣지 않고, native popup의 위치·숨김만
// native-view.ts의 createPlacement를 쓴다. 규칙(navigation·활동·주소 정리)은 이 폴더의 순수
// 모듈이 정한다.
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
import {
  createPlacement,
  type NativeViewContents,
  type NativeViewHost,
  type Placed,
  type ViewBounds,
} from "./native-view.ts";
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
  /** page favicon의 data URL. 없으면 빠진다. */
  favicon?: string;
}

export interface BrowserContents extends NativeViewContents {
  page(): BrowserPage;
  back(): void;
  forward(): void;
  reload(): void;
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
    /** 크기 준 popup을 native view로 등록한다. make가 만든 contents가 그 view의 것이다. */
    open(
      placement: PopupPlacement,
      make: (hooks: BrowserHooks) => BrowserContents,
    ): void;
    /** 크기 없는 popup을 거절했다. renderer가 연 탭 뒤에 그 url로 새 탭을 연다. */
    tab(url: string): void;
  };
}

/** page에 붙인 DevTools view. project 창과 따로 뜬 OS 창 사이를 연결을 끊지 않고 옮긴다. */
export interface DevtoolsContents extends NativeViewContents {
  toWindow(on: boolean, title: string): void;
}

export interface BrowserViewHost
  extends Pick<
    NativeViewHost,
    "hasWindow" | "attach" | "detach" | "focused" | "focusShell"
  > {
  /** crash한 native popup을 그 popup이 쓰던 partition(profile)으로 다시 연다. */
  create(hooks: BrowserHooks, partition: string): BrowserContents;
  /** page의 DevTools를 새 view에 연다. page가 이미 없으면 undefined. 연결이 끊기면 gone을 부른다. */
  devtools(
    page: BrowserContents,
    gone: () => void,
  ): DevtoolsContents | undefined;
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

interface Item {
  view_session: string;
  window: string;
  // 이 page의 browser profile partition. popup은 opener의 contents가 만들어 opener와 같다.
  partition: string;
  contents: BrowserContents;
  // popup으로 생긴 view는 renderer가 탭을 만들어 가져가기(adopt) 전까지 false다. guest는 늘 true다.
  adopted: boolean;
  health: ViewHealth;
  // crash한 contents를 다시 열 주소. 읽을 때마다 비어 있지 않은 마지막 값을 남긴다.
  lastUrl: string;
}

// native popup. guest는 위치를 renderer가 정하므로 Item만 갖는다.
interface Entry extends Item, Omit<Placed, "contents"> {}

// page 하나에 DevTools 하나. 따로 뜬 창에 있는 동안(inWindow)은 project 창에 붙이지 않는다.
interface Devtools extends Placed {
  devtools_session: string;
  page: string;
  contents: DevtoolsContents;
  inWindow: boolean;
}

const notOpen = () => failure("invalid_input", "view is not open");

export function createBrowserViews(deps: BrowserViewsDeps) {
  const entries = new Map<string, Entry>();
  const guests = new Map<string, Item>();
  const find = (view_session: string): Item | undefined =>
    entries.get(view_session) ?? guests.get(view_session);
  const placement = createPlacement<Entry>({
    views: deps.host,
    record: () => {},
  });
  const devtools = new Map<string, Devtools>();
  const devPlacement = createPlacement<Devtools>({
    views: deps.host,
    record: () => {},
  });

  // 지도에서 먼저 빼서, 부수는 동안 온 gone이 다시 정리하지 않게 한다.
  function closeDevtools(entry: Devtools, notify: boolean): void {
    if (devtools.get(entry.devtools_session) !== entry) return;
    devtools.delete(entry.devtools_session);
    devPlacement.unmounted(entry);
    entry.contents.destroy();
    if (notify) {
      deps.pushEvent(entry.window, {
        kind: "devtools-closed",
        view_session: entry.page,
        devtools_session: entry.devtools_session,
      });
    }
  }

  function closeDevtoolsOf(page: string, notify: boolean): void {
    for (const entry of [...devtools.values()]) {
      if (entry.page === page) closeDevtools(entry, notify);
    }
  }

  function state(entry: Item): BrowserViewState {
    const page = entry.contents.page();
    if (page.url !== "") entry.lastUrl = page.url;
    return {
      view_session: entry.view_session,
      url: page.url,
      title: page.title.slice(0, TITLE_MAX),
      loading: page.loading,
      canGoBack: page.canGoBack,
      canGoForward: page.canGoForward,
      ...(page.favicon === undefined ? {} : { favicon: page.favicon }),
      health: entry.health,
    };
  }

  // adopt 전 popup은 renderer에 탭이 없다. adopt가 지금 state로 답한다.
  function push(entry: Item): void {
    if (entry.adopted) deps.pushState(entry.window, state(entry));
  }

  // 교체·폐기된 contents가 늦게 보낸 신호는 지금 view의 것이 아니다.
  function spawn(
    view_session: string,
    partition: string,
    make: (hooks: BrowserHooks) => BrowserContents = (hooks) =>
      deps.host.create(hooks, partition),
  ): BrowserContents {
    const live = () => {
      const entry = find(view_session);
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
        tab(url) {
          const opener = live();
          if (opener !== undefined) {
            deps.pushEvent(opener.window, {
              kind: "open-tab",
              opener: view_session,
              url,
            });
          }
        },
      },
    });
    return contents;
  }

  // native popup은 첫 load가 끝나면(실패도) 붙일 수 있다. guest는 붙이는 일이 renderer 몫이다.
  function load(entry: Item, url: string): void {
    const loaded = entry.contents.load(url);
    const native = entries.get(entry.view_session);
    if (native === entry) firstLoaded(native, loaded);
    else void loaded.catch(() => {});
  }

  function firstLoaded(entry: Entry, loaded: Promise<void>): void {
    const contents = entry.contents;
    void loaded
      .catch(() => {})
      .then(() => {
        if (entries.get(entry.view_session) !== entry) return;
        if (entry.contents !== contents || entry.ready) return;
        placement.loaded(entry);
      });
  }

  // 소유 창은 opener의 창이다. renderer가 adopt하지 않은 view는 그 창이 닫힐 때까지 남는다.
  function openPopup(
    opener: Item,
    where: PopupPlacement,
    make: (hooks: BrowserHooks) => BrowserContents,
  ): void {
    const view_session = deps.ids.viewSession();
    const entry: Entry = {
      view_session,
      window: opener.window,
      partition: opener.partition,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
      contents: spawn(view_session, opener.partition, make),
      generation: 0,
      shown: false,
      ready: false,
      placed: false,
      attached: false,
      layer: 0,
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
    closeDevtoolsOf(entry.view_session, true);
    entries.delete(entry.view_session);
    placement.unmounted(entry);
    entry.contents.destroy();
  }

  function ownedEntry(window: string, view_session: string): Item | undefined {
    const entry = find(view_session);
    return entry?.window === window ? entry : undefined;
  }

  return {
    /** shell 창에 붙은 <webview> guest를 등록한다. 위치·숨김은 renderer CSS가 한다. */
    addGuest(
      window: string,
      view_session: string,
      partition: string,
      make: (hooks: BrowserHooks) => BrowserContents,
    ): void {
      const item: Item = {
        view_session,
        window,
        partition,
        contents: spawn(view_session, partition, make),
        adopted: true,
        health: "ok",
        lastUrl: "",
      };
      guests.set(view_session, item);
    },

    /** guest contents가 부서졌다(renderer가 <webview>를 지웠거나 창이 닫혔다). */
    forgetGuest(view_session: string): void {
      closeDevtoolsOf(view_session, true);
      guests.delete(view_session);
    },

    /** page의 DevTools를 page 옆 native view로 연다. page마다 하나다. */
    openDevtools(
      window: string,
      view_session: string,
    ): Outcome<{ devtools_session: string }> {
      const page = ownedEntry(window, view_session);
      if (page === undefined) return notOpen();
      if ([...devtools.values()].some((item) => item.page === view_session)) {
        return failure("conflict", "devtools are already open");
      }
      const devtools_session = `devtools-${page.contents.id}`;
      const contents = deps.host.devtools(page.contents, () => {
        const live = devtools.get(devtools_session);
        if (live !== undefined) closeDevtools(live, true);
      });
      if (contents === undefined) return notOpen();
      const entry: Devtools = {
        devtools_session,
        page: view_session,
        window,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
        layer: 0,
        contents,
        generation: 0,
        shown: false,
        ready: false,
        placed: false,
        attached: false,
        inWindow: false,
      };
      devtools.set(devtools_session, entry);
      devPlacement.mounted(entry);
      devPlacement.loaded(entry);
      return { ok: true, value: { devtools_session } };
    },

    closeDevtools(window: string, devtools_session: string): Outcome<null> {
      const entry = devtools.get(devtools_session);
      if (entry?.window !== window) return notOpen();
      closeDevtools(entry, false);
      return { ok: true, value: null };
    },

    /** DevTools를 따로 뜬 OS 창으로 옮기거나(true) project 창으로 되돌린다(false). */
    devtoolsWindow(
      window: string,
      devtools_session: string,
      on: boolean,
    ): Outcome<null> {
      const entry = devtools.get(devtools_session);
      if (entry?.window !== window) return notOpen();
      if (on === entry.inWindow) return { ok: true, value: null };
      if (on) {
        devPlacement.hide(entry);
        entry.inWindow = true;
        entry.contents.toWindow(
          true,
          find(entry.page)?.contents.page().title ?? "",
        );
      } else {
        entry.contents.toWindow(false, "");
        entry.inWindow = false;
      }
      return { ok: true, value: null };
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
        if (decision.external && deps.activation.fresh(entry.contents.id)) {
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
      command: "back" | "forward" | "reload",
    ): Outcome<null> {
      const entry = ownedEntry(window, view_session);
      if (entry === undefined) return notOpen();
      if (
        command === "reload" &&
        reopenable(entry.health) &&
        guests.has(view_session)
      ) {
        // guest는 <webview>가 contents를 가진다. reload가 page process를 다시 띄운다.
        entry.health = "ok";
        entry.contents.reload();
        push(entry);
      } else if (command === "reload" && reopenable(entry.health)) {
        const native = entry as Entry;
        // 깨진 contents는 reload로 살아나지 않는다. 같은 view_session에 새 contents를 만든다.
        placement.unmounted(native);
        native.contents.destroy();
        native.contents = spawn(view_session, native.partition);
        native.health = "ok";
        placement.mounted(native);
        if (native.lastUrl !== "") load(native, native.lastUrl);
        push(native);
      } else if (command === "back") entry.contents.back();
      else if (command === "forward") entry.contents.forward();
      else entry.contents.reload();
      return { ok: true, value: null };
    },

    // native-bounds 길: native popup과 DevTools view. guest의 위치는 renderer CSS가 한다.
    has: (view_session: string) =>
      entries.has(view_session) || devtools.has(view_session),

    owner: (view_session: string) =>
      (entries.get(view_session) ?? devtools.get(view_session))?.window,

    /**
     * popup과 DevTools view를 닫지 않고 from 창에서 to 창으로 옮긴다. 떼어 숨긴 상태가 되고
     * 새 창 renderer가 bounds를 보내면 붙는다. guest는 옮기지 않는다(renderer가 다시 만든다).
     */
    move(view_session: string, from: string, to: string): Outcome<null> {
      const tool = devtools.get(view_session);
      const entry = tool ?? entries.get(view_session);
      if (entry === undefined || entry.window !== from) return notOpen();
      if (!deps.host.hasWindow(to)) {
        return failure("invalid_input", "window is not open");
      }
      // 떼기는 옛 창 기준이라 소유 창을 바꾸기 전에 한다. 따로 뜬 OS 창의 DevTools는 붙어 있지 않다.
      if (tool !== undefined) {
        if (!tool.inWindow) devPlacement.hide(tool);
      } else placement.hide(entry as Entry);
      entry.window = to;
      return { ok: true, value: null };
    },

    setBounds(view_session: string, bounds: ViewBounds, layer: number) {
      const tool = devtools.get(view_session);
      if (tool !== undefined) {
        // 따로 뜬 창에 있는 동안 project 창의 자리는 쓰지 않는다.
        return tool.inWindow
          ? { ok: true as const, value: { generation: tool.generation } }
          : devPlacement.setBounds(tool, bounds, layer);
      }
      const entry = entries.get(view_session);
      return entry === undefined
        ? notOpen()
        : placement.setBounds(entry, bounds, layer);
    },

    hide(view_session: string) {
      const tool = devtools.get(view_session);
      if (tool !== undefined) {
        return tool.inWindow
          ? { ok: true as const, value: { generation: tool.generation } }
          : devPlacement.hide(tool);
      }
      const entry = entries.get(view_session);
      return entry === undefined ? notOpen() : placement.hide(entry);
    },

    close(view_session: string): void {
      const tool = devtools.get(view_session);
      if (tool !== undefined) closeDevtools(tool, false);
      const entry = entries.get(view_session);
      if (entry !== undefined) dispose(entry);
    },

    /** 그 partition의 데이터를 지운 뒤. 그 profile의 page만 다시 load하고, 빈 주소 칸과 crash한 view는 건드리지 않는다. */
    reloadPartition(partition: string): void {
      for (const entry of [...entries.values(), ...guests.values()]) {
        if (
          entry.partition !== partition ||
          entry.health === "crashed" ||
          entry.contents.page().url === ""
        ) {
          continue;
        }
        entry.contents.reload();
      }
    },

    closeWindow(window: string): void {
      for (const tool of [...devtools.values()]) {
        if (tool.window === window) closeDevtools(tool, false);
      }
      for (const entry of [...entries.values()]) {
        if (entry.window === window) dispose(entry);
      }
      for (const item of [...guests.values()]) {
        if (item.window === window) guests.delete(item.view_session);
      }
    },

    dispose(): void {
      for (const tool of [...devtools.values()]) closeDevtools(tool, false);
      for (const entry of [...entries.values()]) dispose(entry);
      guests.clear();
    },
  };
}

export type BrowserViews = ReturnType<typeof createBrowserViews>;
