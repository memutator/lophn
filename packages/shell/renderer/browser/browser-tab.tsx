// browser 탭 본문. toolbar 아래 page region 자리에 page를 그린다. 보통 탭은 <webview>이고(webview-host.tsx,
// DOM 안에 그려져 menu·패널이 위에 겹친다), 크기를 준 popup만 opener를 지키려고 main이 native view를
// 붙인다(adopt). native view는 DOM 위에 그려지므로 알림은 toolbar와 region 사이 줄에 둔다. 주소가 빈
// 탭은 page 대신 bookmark 목록을 그린다.
import { useEffect, useRef, useState } from "react";
import { ErrorState } from "@lophn/ui/feedback";
import { Toast } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";

import type {
  BrowserEvent,
  BrowserViewState,
  LophnBrowserApi,
} from "../../ipc/browser.ts";
import type { LophnShellViewsApi } from "../../ipc/app-frame.ts";
import { useAppViews } from "../app-frame/app-views.tsx";
import { useViewBounds } from "../app-frame/embedded-view.tsx";
import type { ViewKeeps } from "../app-frame/view-keeps.ts";
import { useBrowserApi } from "./browser-api.tsx";
import { useBookmarks } from "./bookmarks.ts";
import { BrowserToolbar } from "./browser-toolbar.tsx";
import { BlankTabPage } from "./blank-tab-page.tsx";
import {
  useWebviewHost,
  useWebviewSlot,
  type WebviewHost,
} from "./webview-host.tsx";
import styles from "./browser-tab.module.css";

interface BrowserTabProps {
  /** page를 처음 열 때만 쓴다. 빈 글이면 빈 주소 칸으로 연다. */
  url: string;
  /** false면 page를 남긴 채 숨긴다(다른 탭·다른 공간·접힌 패널). */
  shown: boolean;
  /** floated 탭의 층(floats index + 1). pane 탭은 0이다. */
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
  onState(state: { url: string; title: string }): void;
  /** 이 탭의 page가 크기를 준 popup을 열었다(native view). */
  onPopup(event: Extract<BrowserEvent, { kind: "popup" }>): void;
  /** 이 탭의 page가 크기 없는 popup을 열려 했다. 그 url로 새 탭을 연다. */
  onOpenTab(url: string): void;
  /** native popup 탭이 pane으로 왔다. 부른 쪽이 native 표시를 지운다. */
  onDocked(): void;
  /** 이 탭의 page가 window.close()를 불렀다. */
  onCloseRequested(): void;
  /** 새 탭 화면의 bookmark를 새 탭에서 연다. */
  onOpenInNewTab(url: string): void;
}

const KEEP_SIGNATURE = "browser";

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
    <OpenTab
      {...props}
      views={views}
      browser={browser}
      webviews={webviews}
    />
  );
}

function DockNative(
  props: { keeps: ViewKeeps; keepKey: string; onDocked(): void },
) {
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
  });
  const [failed, setFailed] = useState(false);
  // 값이 올 때마다 새로 띄우도록 번호를 key로 쓴다. null이면 알림 없음.
  const [notice, setNotice] = useState<
    { n: number; text: string; error: boolean } | null
  >(null);
  const [bookmarkKey, setBookmarkKey] = useState(0);
  const bookmarks = useBookmarks();
  const [menuOpen, setMenuOpen] = useState(false);
  const region = useRef<HTMLDivElement | null>(null);
  // adopt는 한 번만 한다. 끝나거나 거절되면 비워서, 다시 시도할 때는 빈 page를 연다.
  const adoptId = useRef(props.adopt);
  const reported = useRef({ url: props.url, title: "" });
  const callbacks = useRef(props);
  callbacks.current = props;
  // 보관소에 넘길 native view의 마지막 state. view가 아직 없으면 null.
  const lastNative = useRef<BrowserViewState | null>(null);

  const apply = (next: BrowserViewState) => {
    if (native) lastNative.current = next;
    const { view_session: _session, ...rest } = next;
    const page = { ...rest, url: pageUrl(rest.url) };
    setState(page);
    if (
      page.url !== reported.current.url ||
      page.title !== reported.current.title
    ) {
      reported.current = { url: page.url, title: page.title };
      callbacks.current.onState({ url: page.url, title: page.title });
    }
  };
  const applyRef = useRef(apply);
  applyRef.current = apply;

  // guest 탭: <webview>가 붙으면 session을 얻는다. 다시 mount되면 지금 page를 element에서 읽는다.
  useWebviewSlot({
    host: webviews,
    enabled: !native,
    key: props.keepKey,
    url: props.url,
    ref: region,
    shown: !native && shown && state.url !== "" && state.health !== "crashed",
    layer: props.layer,
    onSession(session) {
      if (native) return;
      setViewSession(session);
      // 막 붙은 guest는 아직 about:blank다. 그때는 처음 주소(props.url)를 그대로 보인다.
      const page = webviews.page(props.keepKey);
      if (page !== null && pageUrl(page.url) !== "") {
        applyRef.current({ view_session: session, health: "ok", ...page });
      }
    },
  });

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
      browser.adopt({ view_session: adopting }).then(
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
        event.kind === "popup-blocked" && event.view_session === viewSession
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
        callbacks.current.onCloseRequested();
      } else if (
        event.kind === "bookmark-key" && event.view_session === viewSession
      ) {
        setBookmarkKey((count) => count + 1);
      }
    });
    return () => {
      offState();
      offEvents();
    };
  }, [browser, viewSession]);

  // native view만 main이 붙인다. 주소가 비거나 깨진 page는 안내가 그 자리를 채우므로 숨긴다.
  useViewBounds({
    views,
    viewSession: native ? viewSession : null,
    shown: shown && !menuOpen && state.url !== "" && state.health !== "crashed",
    ref: region,
  });

  const reload = () => {
    if (viewSession === null) return;
    void browser.command({ view_session: viewSession, command: "reload" })
      .catch(() => {});
  };

  const navigate = (url: string) => {
    if (viewSession === null) return;
    void browser.navigate({ view_session: viewSession, input: url })
      .catch(() => {});
  };

  return (
    <div className={styles.tab}>
      <BrowserToolbar
        browser={browser}
        viewSession={viewSession}
        state={state}
        focusAddress={props.url === "" && shown}
        bookmarks={bookmarks}
        bookmarkKey={bookmarkKey}
        onNotice={(text) =>
          setNotice((last) => ({ n: (last?.n ?? 0) + 1, text, error: true }))}
        onNavigate={navigate}
        onMenuOpenChange={setMenuOpen}
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
      <div ref={region} className={styles.region} data-browser-page="">
        {failed
          ? (
            <ErrorState
              target={t("browser.label.page")}
              // 가져오지 못한 popup은 빈 webview 탭으로 다시 연다.
              onRetry={props.onDocked}
            />
          )
          : state.health === "crashed"
          ? <ErrorState target={t("browser.label.page")} onRetry={reload} />
          : state.url === "" && viewSession !== null
          ? (
            <BlankTabPage
              bookmarks={bookmarks}
              onOpen={navigate}
              onOpenInNewTab={props.onOpenInNewTab}
            />
          )
          : null}
      </div>
    </div>
  );
}
