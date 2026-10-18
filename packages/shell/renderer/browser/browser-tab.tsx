// browser 탭 본문. toolbar 아래 page region 자리에 main이 native view를 붙인다. 탭 kind가 url을
// 저장하고 다시 주지만 view는 처음 열 때만 그 url로 연다. native view는 DOM 위에 그려지므로
// 알림은 toolbar와 region 사이 줄에 둔다. 주소가 빈 탭은 native view 대신 bookmark 목록을 그린다.
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
import { useBrowserApi } from "./browser-api.tsx";
import { useBookmarks } from "./bookmarks.ts";
import { BrowserToolbar } from "./browser-toolbar.tsx";
import { BlankTabPage } from "./blank-tab-page.tsx";
import styles from "./browser-tab.module.css";

interface BrowserTabProps {
  /** view를 처음 열 때만 쓴다. 빈 글이면 빈 주소 칸으로 연다. */
  url: string;
  /** false면 view를 남긴 채 숨긴다(다른 탭·다른 공간). */
  shown: boolean;
  /** main이 만든 popup view의 session. 있으면 처음 열 때 `open` 대신 이 view를 가져온다. */
  adopt?: string;
  /** adopt 응답을 받았다. 부른 쪽이 `adopt`를 지운다. */
  onAdopted(): void;
  onState(state: { url: string; title: string }): void;
  /** 이 탭의 page가 연 popup. */
  onPopup(event: Extract<BrowserEvent, { kind: "popup" }>): void;
  /** 이 탭의 page가 window.close()를 불렀다. */
  onCloseRequested(): void;
  /** 새 탭 화면의 bookmark를 새 탭에서 연다. */
  onOpenInNewTab(url: string): void;
}

type PageState = Omit<BrowserViewState, "view_session">;

export function BrowserTab(props: BrowserTabProps) {
  const views = useAppViews()?.views;
  const browser = useBrowserApi();
  if (views === undefined || browser === null) {
    return (
      <ErrorState
        target={t("browser.label.browser")}
        onRetry={() => globalThis.location.reload()}
      />
    );
  }
  return <OpenTab {...props} views={views} browser={browser} />;
}

function OpenTab(
  props: BrowserTabProps & {
    views: LophnShellViewsApi;
    browser: LophnBrowserApi;
  },
) {
  const { views, browser, shown } = props;
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
  const [attempt, setAttempt] = useState(0);
  // 값이 올 때마다 새로 띄우도록 번호를 key로 쓴다. null이면 알림 없음.
  const [notice, setNotice] = useState<
    { n: number; text: string; error: boolean } | null
  >(null);
  const [bookmarkKey, setBookmarkKey] = useState(0);
  const bookmarks = useBookmarks();
  const [menuOpen, setMenuOpen] = useState(false);
  const region = useRef<HTMLDivElement | null>(null);
  const firstUrl = useRef(props.url);
  // adopt는 한 번만 한다. 끝나거나 거절되면 비워서, 다시 시도할 때는 새 view를 연다.
  const adoptId = useRef(props.adopt);
  const reported = useRef({ url: props.url, title: "" });
  const stateListener = useRef(props.onState);
  stateListener.current = props.onState;
  const callbacks = useRef(props);
  callbacks.current = props;

  // 여는 동안 이 자리가 사라지면 늦게 온 view를 바로 닫는다.
  useEffect(() => {
    let alive = true;
    // adopt는 응답 전에도 이 view의 close가 올 수 있어 처음부터 안다.
    const adopting = adoptId.current;
    let opened: string | null = adopting ?? null;
    const apply = (next: BrowserViewState) => {
      const { view_session: _session, ...page } = next;
      setState(page);
      if (
        page.url !== reported.current.url ||
        page.title !== reported.current.title
      ) {
        reported.current = { url: page.url, title: page.title };
        stateListener.current({ url: page.url, title: page.title });
      }
    };
    const offState = browser.subscribeState((next) => {
      if (next.view_session === opened) apply(next);
    });
    const offEvents = browser.subscribeEvents((event) => {
      if (event.kind === "popup-blocked" && event.view_session === opened) {
        setNotice((last) => ({
          n: (last?.n ?? 0) + 1,
          text: t("browser.notice.popup-blocked"),
          error: false,
        }));
      } else if (event.kind === "popup" && event.opener === opened) {
        callbacks.current.onPopup(event);
      } else if (event.kind === "close" && event.view_session === opened) {
        callbacks.current.onCloseRequested();
      } else if (
        event.kind === "bookmark-key" && event.view_session === opened
      ) {
        setBookmarkKey((count) => count + 1);
      }
    });
    setFailed(false);
    const got = adopting === undefined
      ? browser.open({ url: firstUrl.current })
      : browser.adopt({ view_session: adopting });
    got.then(
      (next) => {
        if (!alive) {
          void views.closeView({ view_session: next.view_session })
            .catch(() => {});
          return;
        }
        opened = next.view_session;
        setViewSession(next.view_session);
        apply(next);
        if (adopting !== undefined) {
          adoptId.current = undefined;
          callbacks.current.onAdopted();
        }
      },
      () => {
        if (!alive) return;
        // 거절된 view는 우리 것이 아니라 닫지 않는다.
        if (adopting !== undefined) {
          adoptId.current = undefined;
          opened = null;
        }
        setFailed(true);
      },
    );
    return () => {
      alive = false;
      offState();
      offEvents();
      setViewSession(null);
      if (opened !== null) {
        void views.closeView({ view_session: opened }).catch(() => {});
      }
    };
  }, [browser, views, attempt]);

  // 주소가 비면 그 자리는 새 탭 화면이 채우고, 깨진 page는 안내가 채우므로 native view를 숨긴다.
  useViewBounds({
    views,
    viewSession,
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
              onRetry={() => setAttempt((count) => count + 1)}
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
