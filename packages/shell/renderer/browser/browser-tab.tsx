// browser 탭 본문. 머리(주소 칸·단추, browser-chrome.tsx)는 card 머리 줄에 올라가고 여기는 page region 자리에 page를 그린다. 보통 탭은 <webview>이고(app-frame/webview-host.tsx,
// DOM 안에 그려져 menu·패널이 위에 겹친다), 크기를 준 popup만 opener를 지키려고 main이 native view를
// 붙인다(adopt). native view는 DOM 위에 그려지므로 알림은 region 위 줄에 둔다. 주소가 빈
// 탭은 page 대신 bookmark 목록을 그린다. DevTools는 page 옆(오른쪽·아래)에 붙거나, floated 패널이나 따로 뜬
// 창으로 간다. 그 값은 탭 fields가 들고(Float·Dock으로 다시 mount되어도 남는다), 값이 바뀌면 이 탭이 main에
// 열기·닫기·창 옮기기를 시킨다.
import {
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { ErrorState } from "@lophn/ui/feedback";
import { Toast } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import type {
  BrowserEvent,
  BrowserViewState,
  LophnBrowserApi,
} from "../../ipc/browser.ts";
import type { LophnShellViewsApi } from "../../ipc/app-frame.ts";
import { useAppViews } from "../app-frame/app-views.tsx";
import { useWindowCommands } from "../commands/react.tsx";
import type { Disposable } from "../commands/registry.ts";
import { useViewBounds } from "./native-bounds.ts";
import type { ViewKeeps } from "../app-frame/view-keeps.ts";
import { startPointerDrag } from "../workspace/drag.ts";
import { useAgentControl } from "../workspace/use-surface-requests.ts";
import type {
  DevtoolsPlace,
  DevtoolsState,
} from "../workspace/kinds/browser-devtools.tsx";
import { DevtoolsPane } from "./devtools-pane.tsx";
import { useBrowserApi } from "./browser-api.tsx";
import { useBookmarks } from "./bookmarks.ts";
import { BrowserChrome } from "./browser-chrome.tsx";
import { BlankTabPage } from "./blank-tab-page.tsx";
import { useBrowserPartition } from "./profiles.tsx";
import {
  useWebviewHost,
  useWebviewSlot,
  type WebviewHost,
} from "../app-frame/webview-host.tsx";
import styles from "./browser-tab.module.css";

interface BrowserTabProps {
  /** page를 처음 열 때만 쓴다. 빈 글이면 빈 주소 칸으로 연다. */
  url: string;
  /** 탭의 browser profile(bpf id). 없으면 기본 profile이다. 정해지면 바뀌지 않는다. */
  profile?: string;
  /** 탭의 주인 session. agent가 다루는 동안 머리가 그 agent의 이름을 말한다. 없으면 사람이 연 탭이다. */
  owner: string | undefined;
  /** core 탭 표의 id(agent가 연 탭, 사람이 넘긴 탭). 있으면 page를 main에 알려 agent가 다룬다. 넘기지 않은 사람의 탭은 null이다. */
  hostTab: string | null;
  /** 사람이 넘긴 탭이다. agent가 다루는 동안 머리 줄에 [Take back]이 선다. */
  onTakeBack?: () => void;
  /** false면 page를 남긴 채 숨긴다(다른 탭·다른 공간·접힌 패널). */
  shown: boolean;
  /** floated 탭의 층(floats index + 1). detached 창의 탭은 1, pane 탭은 0이다. */
  layer: number;
  /** 크기를 준 popup으로 생긴 native view 탭. pane으로 오면(dock) <webview> 탭으로 바꾼다. */
  native: boolean;
  /**
   * native popup 탭이 Float·Dock으로 다시 mount해도 view를 이어 쓰는 보관소와 탭 key. unmount하면
   * view를 닫지 않고 여기 숨기며, 닫는 일은 보관소의 주인(Workspace)이 한다.
   */
  keeps: ViewKeeps;
  keepKey: string;
  /** main이 만든 popup view의 session. 있으면 처음 열 때 이 view를 가져온다. */
  adopt?: string;
  /** adopt 응답을 받았다. 부른 쪽이 `adopt`를 지운다. */
  onAdopted(): void;
  /**
   * 탭이 마지막으로 받은 favicon. <webview> element는 favicon을 모르므로 다시 mount할 때 이어 쓴다
   * (접힘·desk 전환·Float·Dock마다 mount되고, main은 바뀔 때만 밀어 준다).
   */
  favicon?: string;
  onState(state: { url: string; title: string; favicon?: string }): void;
  /** 이 탭의 page가 크기를 준 popup을 열었다(native view). */
  onPopup(event: Extract<BrowserEvent, { kind: "popup" }>): void;
  /** 이 탭의 page가 크기 없는 popup을 열려 했다. 그 url로 새 탭을 연다. */
  onOpenTab(url: string): void;
  /** native popup 탭이 pane으로 왔다. 부른 쪽이 native 표시를 지운다. */
  onDocked(): void;
  /** 이 탭의 page가 window.close()를 불렀다. 넘긴 탭(`handed`)이면 부르지 않는다. */
  onCloseRequested(): void;
  /**
   * 사람이 session에 넘긴 탭이다. page의 window.close()(page의 script나 그 page를 다루는 agent의 evaluate)가 탭을 닫지 못한다. Electron은
   * close 뒤 그 guest의 webContents를 부숴 page가 반쯤 죽은 채 남으므로(main이 찾지 못해 agent 호출과 사람의 Reload가 듣지 않는다)
   * 같은 탭 자리에서 마지막 주소로 page를 새로 연다. 탭 key·주인·core 탭 id는 그대로이고 새 view session으로 다시 bind한다.
   */
  handed?: boolean;
  /** 새 탭 화면의 bookmark를 새 탭에서 연다. */
  onOpenInNewTab(url: string): void;
  /** 이 page의 DevTools 자리. null이면 닫혀 있다. */
  devtools: DevtoolsState | null;
  /** DevTools 값을 바꾼다. 경계를 끄는 동안의 잦은 바뀜은 `later`로 모은다. */
  onDevtools(next: DevtoolsState | null, later?: boolean): void;
  /** 사람이 켠 Keep alive. 켜면 다른 workspace에 가도 이 page를 다시 load하지 않고 살려 둔다(workspace-views.tsx). */
  keepAlive: boolean;
  onKeepAlive(on: boolean): void;
}

// 탭 안 DevTools 자리의 처음 크기와 DevTools·page 각자의 가장 작은 크기(CSS px).
const DEVTOOLS_SIZE = 420;
const DEVTOOLS_MIN = 240;
const PAGE_MIN = 240;

export const KEEP_SIGNATURE = "browser";

type PageState = Omit<BrowserViewState, "view_session">;

export function BrowserTab(props: BrowserTabProps) {
  const views = useAppViews()?.views;
  const browser = useBrowserApi();
  const webviews = useWebviewHost();
  if (views === undefined || browser === null || webviews === null) {
    return (
      <ErrorState
        target={t("browser.label.browser")}
        onRetry={() => globalThis.location.reload()}
      />
    );
  }
  // native popup이 pane으로 오면 그 view를 닫고 <webview> 탭으로 바꾼다(정한 것: page를 다시 load한다).
  if (props.native && props.layer === 0) {
    return (
      <DockNative
        keeps={props.keeps}
        keepKey={props.keepKey}
        onDocked={props.onDocked}
      />
    );
  }
  return (
    <OpenTab {...props} views={views} browser={browser} webviews={webviews} />
  );
}

function DockNative(props: {
  keeps: ViewKeeps;
  keepKey: string;
  onDocked(): void;
}) {
  const first = useRef(props);
  useEffect(() => {
    const { keeps, keepKey, onDocked } = first.current;
    keeps.release(keepKey);
    onDocked();
  }, []);
  return null;
}

// guest가 빈 주소 칸을 about:blank로 연다. 주소 칸과 새 탭 화면에는 빈 글로 보인다.
function pageUrl(url: string): string {
  return url === "about:blank" ? "" : url;
}

function sameOrigin(a: string, b: string): boolean {
  if (a === "" || b === "") return false;
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return false;
  }
}

function OpenTab(
  props: BrowserTabProps & {
    views: LophnShellViewsApi;
    browser: LophnBrowserApi;
    webviews: WebviewHost;
  },
) {
  const { views, browser, webviews, shown, native } = props;
  const [viewSession, setViewSession] = useState<string | null>(null);
  const [state, setState] = useState<PageState>({
    url: props.url,
    title: "",
    loading: false,
    canGoBack: false,
    canGoForward: false,
    health: "ok",
    ...(props.favicon === undefined ? {} : { favicon: props.favicon }),
  });
  const [failed, setFailed] = useState(false);
  const agent = useAgentControl(props.hostTab, viewSession);
  // agent가 다루는 동안은 가려져도 그리기를 이어 간다(screenshot과 입력이 되려면 guest가 그려져야 한다).
  const driven = agent !== null;
  useEffect(() => {
    webviews.setDriven(props.keepKey, driven);
    return () => webviews.setDriven(props.keepKey, false);
  }, [webviews, props.keepKey, driven]);
  // 값이 올 때마다 새로 띄우도록 번호를 key로 쓴다. null이면 알림 없음.
  const [notice, setNotice] = useState<{
    n: number;
    text: string;
    error: boolean;
  } | null>(null);
  const [bookmarkKey, setBookmarkKey] = useState(0);
  const bookmarks = useBookmarks();
  // browser page에 focus가 있으면 main이 그 view_session으로 bookmark key를 알린다(위의 구독). 머리에
  // focus가 있을 때는 renderer keydown이 표의 `browser.bookmark` 줄을 보고 이 command를 부른다.
  // 창 하나의 command라 마지막으로 focus를 받은 browser 탭이 그 자리를 맡는다.
  const commands = useWindowCommands();
  const focusBinding = useRef<Disposable[]>([]);
  const bindFocus = () => {
    if (commands === null) return;
    focusBinding.current = [
      commands.focus.set("browser.bookmark", () =>
        setBookmarkKey((count) => count + 1),
      ),
    ];
  };
  useEffect(
    () => () => {
      for (const one of focusBinding.current) one.dispose();
      focusBinding.current = [];
    },
    [],
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const region = useRef<HTMLDivElement | null>(null);
  const body = useRef<HTMLDivElement | null>(null);
  // 경계를 끄는 동안의 크기. null이면 끄는 중이 아니고 값(devtools.size)을 쓴다.
  const [dragSize, setDragSize] = useState<number | null>(null);
  // adopt는 한 번만 한다. 끝나거나 거절되면 비워서, 다시 시도할 때는 빈 page를 연다.
  const adoptId = useRef(props.adopt);
  const reported = useRef<{ url: string; title: string; favicon?: string }>({
    url: props.url,
    title: "",
    favicon: props.favicon,
  });
  const callbacks = useRef(props);
  callbacks.current = props;
  // 보관소에 넘길 native view의 마지막 state. view가 아직 없으면 null.
  const lastNative = useRef<BrowserViewState | null>(null);

  const apply = (next: BrowserViewState) => {
    if (native) {
      lastNative.current = next;
      // mount된 동안에도 Detach가 lookup으로 이 view와 최신 state를 찾게 한다.
      callbacks.current.keeps.track(callbacks.current.keepKey, {
        session: next.view_session,
        signature: KEEP_SIGNATURE,
        state: next,
      });
    }
    const { view_session: _session, ...rest } = next;
    const url = pageUrl(rest.url);
    // 같은 origin을 다시 읽는 중(복원·새로고침)에 main이 아직 favicon을 받기 전이면 이전 favicon을 지우지 않는다.
    const favicon =
      rest.favicon !== undefined
        ? rest.favicon
        : reported.current.favicon !== undefined &&
            sameOrigin(reported.current.url, url)
          ? reported.current.favicon
          : undefined;
    const page = {
      ...rest,
      url,
      ...(favicon === undefined ? {} : { favicon }),
    };
    setState(page);
    if (
      page.url !== reported.current.url ||
      page.title !== reported.current.title ||
      page.favicon !== reported.current.favicon
    ) {
      reported.current = {
        url: page.url,
        title: page.title,
        favicon: page.favicon,
      };
      callbacks.current.onState(reported.current);
    }
  };
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // profile 목록을 읽기 전에는 page를 만들지 않는다(null).
  const partition = useBrowserPartition(props.profile);
  // guest 탭: <webview>가 붙으면 session을 얻는다. 다시 mount되면 지금 page를 element에서 읽는다.
  useWebviewSlot({
    host: webviews,
    kind: "browser",
    enabled: !native && partition !== null,
    key: props.keepKey,
    src: props.url,
    ...(partition === null ? {} : { partition }),
    ref: region,
    shown: !native && shown && state.url !== "" && state.health !== "crashed",
    layer: props.layer,
    onSession(session) {
      if (native) return;
      setViewSession(session);
      // 막 붙은 guest는 아직 about:blank다. 그때는 처음 주소(props.url)를 그대로 보인다.
      const page = webviews.page(props.keepKey);
      if (page !== null && pageUrl(page.url) !== "") {
        applyRef.current({
          view_session: session,
          health: "ok",
          ...page,
          ...(reported.current.favicon === undefined
            ? {}
            : { favicon: reported.current.favicon }),
        });
      }
    },
  });

  // 꺼 둔 채 다른 탭으로 가 mount가 풀려도 host가 값을 쥐고 있다가 workspace를 떠날 때 쓴다.
  const { keepKey, keepAlive } = props;
  useEffect(() => {
    webviews.setUserKeep(keepKey, keepAlive);
  }, [webviews, keepKey, keepAlive]);

  // native popup 탭: 보관 중인 view가 있으면 그대로 쓰고, 없으면 main이 만든 popup view를 가져온다.
  // 여는 동안 이 자리가 사라지면 늦게 온 view를 보관소에 넘긴다(탭이 남았으면 다시 mount가 꺼낸다).
  useEffect(() => {
    if (!native) return;
    let alive = true;
    const { keeps, keepKey } = callbacks.current;
    const dispose = (next: BrowserViewState) =>
      keeps.put(keepKey, {
        session: next.view_session,
        signature: KEEP_SIGNATURE,
        state: next,
      });
    const kept = keeps.take<BrowserViewState>(keepKey, KEEP_SIGNATURE);
    setFailed(false);
    if (kept !== undefined) {
      setViewSession(kept.session);
      applyRef.current(kept.state);
      // 가져오는 응답 전에 다시 mount됐으면 adopt 표시가 남아 있다.
      if (adoptId.current !== undefined) {
        adoptId.current = undefined;
        callbacks.current.onAdopted();
      }
    } else if (adoptId.current !== undefined) {
      const adopting = adoptId.current;
      // adopt는 응답 전에도 이 view의 close가 올 수 있어 처음부터 안다.
      setViewSession(adopting);
      // 답 전에 다시 mount됐으면 옛 mount가 건 adopt를 기다린다(main은 두 번째 adopt를 거절한다).
      // 옛 mount의 답은 dispose로 보관하고, 이 mount의 답은 곧바로 track해 덮으므로 한 번만 보관된다.
      let pending = keeps.opening.get(keepKey) as
        | Promise<BrowserViewState>
        | undefined;
      if (pending === undefined) {
        pending = browser.adopt({ view_session: adopting });
        const started = pending;
        const done = () => {
          if (keeps.opening.get(keepKey) === started) {
            keeps.opening.delete(keepKey);
          }
        };
        keeps.opening.set(keepKey, started);
        started.then(done, done);
      }
      pending.then(
        (next) => {
          adoptId.current = undefined;
          if (!alive) {
            dispose(next);
            return;
          }
          applyRef.current(next);
          callbacks.current.onAdopted();
        },
        () => {
          // 거절된 view는 우리 것이 아니라 닫지 않는다.
          adoptId.current = undefined;
          if (!alive) return;
          setViewSession(null);
          setFailed(true);
        },
      );
    } else {
      setFailed(true);
    }
    return () => {
      alive = false;
      setViewSession(null);
      if (lastNative.current !== null) dispose(lastNative.current);
      lastNative.current = null;
    };
  }, [browser, native]);

  // 두 종류 모두 main이 그 session의 state와 사건을 민다.
  useEffect(() => {
    if (viewSession === null) return;
    const offState = browser.subscribeState((next) => {
      if (next.view_session === viewSession) applyRef.current(next);
    });
    const offEvents = browser.subscribeEvents((event) => {
      if (
        event.kind === "popup-blocked" &&
        event.view_session === viewSession
      ) {
        setNotice((last) => ({
          n: (last?.n ?? 0) + 1,
          text: t("browser.notice.popup-blocked"),
          error: false,
        }));
      } else if (event.kind === "popup" && event.opener === viewSession) {
        callbacks.current.onPopup(event);
      } else if (event.kind === "open-tab" && event.opener === viewSession) {
        callbacks.current.onOpenTab(event.url);
      } else if (event.kind === "close" && event.view_session === viewSession) {
        // 넘긴 탭과 다른 session이 든 agent 탭(준 탭)은 page가 닫아도 탭을 지우지 않는다.
        if (
          (callbacks.current.handed === true ||
            webviews.isGiven(callbacks.current.keepKey)) &&
          !native
        ) {
          webviews.renew(callbacks.current.keepKey);
        } else callbacks.current.onCloseRequested();
      } else if (
        event.kind === "bookmark-key" &&
        event.view_session === viewSession
      ) {
        setBookmarkKey((count) => count + 1);
      }
    });
    return () => {
      offState();
      offEvents();
    };
  }, [browser, viewSession, webviews, native]);

  // native view만 main이 붙인다. 주소가 비거나 깨진 page는 안내가 그 자리를 채우므로 숨긴다.
  useViewBounds({
    views,
    viewSession: native ? viewSession : null,
    shown: shown && !menuOpen && state.url !== "" && state.health !== "crashed",
    ref: region,
  });

  // DevTools 값이 바뀐 것을 main에 옮긴다. 다시 mount되면 처음 값은 바뀜이 아니다. main이 먼저 닫았으면
  // (devtools-closed) 다시 닫지 않는다.
  const devtools = props.devtools;
  const shownDevtools = useRef(devtools);
  const closedByMain = useRef<string | null>(null);
  useEffect(() => {
    const before = shownDevtools.current;
    shownDevtools.current = devtools;
    if (before !== null && before.session !== devtools?.session) {
      if (closedByMain.current !== before.session) {
        void browser.devtools
          .close({ devtools_session: before.session })
          .catch(() => {});
      }
      closedByMain.current = null;
    }
    if (devtools === null) return;
    const wasWindow =
      before?.session === devtools.session && before.place === "window";
    const isWindow = devtools.place === "window";
    if (wasWindow !== isWindow) {
      void browser.devtools
        .window({
          devtools_session: devtools.session,
          window: isWindow,
        })
        .catch(() => {});
    }
  }, [browser, devtools]);

  useEffect(() => {
    if (viewSession === null) return;
    return browser.subscribeEvents((event) => {
      if (
        event.kind === "devtools-closed" &&
        event.view_session === viewSession
      ) {
        closedByMain.current = event.devtools_session;
        callbacks.current.onDevtools(null);
      }
    });
  }, [browser, viewSession]);

  const devtoolsAction = (action: DevtoolsPlace | "open" | "close") => {
    if (action === "close") {
      callbacks.current.onDevtools(null);
      return;
    }
    if (action === "open") {
      if (viewSession === null || devtools !== null) return;
      void browser.devtools.open({ view_session: viewSession }).then(
        ({ devtools_session }) =>
          callbacks.current.onDevtools({
            session: devtools_session,
            place: "right",
            size: DEVTOOLS_SIZE,
          }),
        () => {},
      );
      return;
    }
    if (devtools !== null) {
      callbacks.current.onDevtools({ ...devtools, place: action });
    }
  };

  // 탭 안 자리(오른쪽·아래)만 page 옆에 DevTools 칸을 둔다.
  const docked =
    devtools !== null &&
    (devtools.place === "right" || devtools.place === "bottom")
      ? devtools
      : null;
  const resize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = body.current?.getBoundingClientRect();
    if (docked === null || box === undefined || event.button !== 0) return;
    const right = docked.place === "right";
    const room = (right ? box.width : box.height) - PAGE_MIN;
    const clamp = (value: number) =>
      Math.round(Math.max(DEVTOOLS_MIN, Math.min(room, value)));
    const start = docked.size;
    let last = start;
    // 끄는 동안 page <webview>와 DevTools native view가 pointer를 가져가지 않게 한다. <webview>는 DOM이라
    // 창 전체를 덮는 투명한 막이 위에서 받는다. DevTools는 native view라 DOM 위에 그려지므로 끄는 동안
    // 숨기고(자리에는 빈 칸이 보인다) 놓으면 새 크기로 다시 붙인다.
    const shield = document.createElement("div");
    shield.className = styles.dragShield;
    shield.dataset.axis = right ? "x" : "y";
    document.body.append(shield);
    setDragSize(start);
    startPointerDrag(event, {
      move: (dx, dy) => {
        // 경계를 page 쪽으로 끌면 DevTools가 커진다.
        last = clamp(start - (right ? dx : dy));
        setDragSize(last);
      },
      finish: (outcome) => {
        shield.remove();
        setDragSize(null);
        if (outcome.type === "drag-end" && last !== start) {
          callbacks.current.onDevtools({ ...docked, size: last });
        }
      },
    });
  };

  const reload = () => {
    if (viewSession === null) return;
    void browser
      .command({ view_session: viewSession, command: "reload" })
      .catch(() => {});
  };

  const navigate = (url: string) => {
    if (viewSession === null) return;
    void browser
      .navigate({ view_session: viewSession, input: url })
      .catch(() => {});
  };

  return (
    <div className={styles.tab} data-key-context="browser" onFocus={bindFocus}>
      <BrowserChrome
        browser={browser}
        viewSession={viewSession}
        state={state}
        focusAddress={props.url === "" && shown}
        bookmarks={bookmarks}
        bookmarkKey={bookmarkKey}
        onHeadFocus={bindFocus}
        onNotice={(text) =>
          setNotice((last) => ({ n: (last?.n ?? 0) + 1, text, error: true }))
        }
        onNavigate={navigate}
        onMenuOpenChange={setMenuOpen}
        native={native}
        devtools={devtools?.place ?? null}
        onDevtools={devtoolsAction}
        keepAlive={props.keepAlive}
        onKeepAlive={props.onKeepAlive}
        agent={agent}
        owner={props.owner}
        {...(props.onTakeBack === undefined
          ? {}
          : { onTakeBack: props.onTakeBack })}
      />
      {notice === null ? null : (
        <div className={styles.notice}>
          <Toast
            key={notice.n}
            title={notice.text}
            tone={notice.error ? "error" : "neutral"}
            duration="brief"
            onClose={() => setNotice(null)}
          />
        </div>
      )}
      <div
        ref={body}
        className={styles.body}
        data-devtools-place={docked?.place ?? "none"}
      >
        <div ref={region} className={styles.region} data-browser-page="">
          {failed ? (
            <ErrorState
              target={t("browser.label.page")}
              // 가져오지 못한 popup은 빈 webview 탭으로 다시 연다.
              onRetry={props.onDocked}
            />
          ) : state.health === "crashed" ? (
            <ErrorState target={t("browser.label.page")} onRetry={reload} />
          ) : state.url === "" && viewSession !== null ? (
            <BlankTabPage
              bookmarks={bookmarks}
              onOpen={navigate}
              onOpenInNewTab={props.onOpenInNewTab}
            />
          ) : null}
        </div>
        {docked === null ? null : (
          <>
            <div
              className={styles.devtoolsDivider}
              role="separator"
              aria-label={t("browser.label.devtools-resize")}
              aria-orientation={
                docked.place === "right" ? "vertical" : "horizontal"
              }
              onPointerDown={resize}
            />
            <div
              className={styles.devtoolsSlot}
              style={{ flexBasis: `${dragSize ?? docked.size}px` }}
            >
              <DevtoolsPane
                views={views}
                session={docked.session}
                shown={shown && !menuOpen && dragSize === null}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
