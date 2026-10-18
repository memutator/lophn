// browser 탭 본문. toolbar 아래 page region 자리에 main이 native view를 붙인다. 탭 kind가 url을
// 저장하고 다시 주지만 view는 처음 열 때만 그 url로 연다. native view는 DOM 위에 그려지므로
// 알림은 toolbar와 region 사이 줄에 둔다.
import { useEffect, useRef, useState } from "react";
import { ErrorState } from "@lophn/ui/feedback";
import { Toast } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";

import type { BrowserViewState, LophnBrowserApi } from "../../ipc/browser.ts";
import type { LophnShellViewsApi } from "../../ipc/app-frame.ts";
import { useAppViews } from "../app-frame/app-views.tsx";
import { useViewBounds } from "../app-frame/embedded-view.tsx";
import { useBrowserApi } from "./browser-api.tsx";
import { BrowserToolbar } from "./browser-toolbar.tsx";
import styles from "./browser-tab.module.css";

interface BrowserTabProps {
  /** view를 처음 열 때만 쓴다. 빈 글이면 빈 주소 칸으로 연다. */
  url: string;
  /** false면 view를 남긴 채 숨긴다(다른 탭·다른 공간). */
  shown: boolean;
  onState(state: { url: string; title: string }): void;
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
  const [popup, setPopup] = useState<number | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const region = useRef<HTMLDivElement | null>(null);
  const firstUrl = useRef(props.url);
  const reported = useRef({ url: props.url, title: "" });
  const stateListener = useRef(props.onState);
  stateListener.current = props.onState;

  // 여는 동안 이 자리가 사라지면 늦게 온 view를 바로 닫는다.
  useEffect(() => {
    let alive = true;
    let opened: string | null = null;
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
        setPopup((count) => (count ?? 0) + 1);
      }
    });
    setFailed(false);
    browser.open({ url: firstUrl.current }).then(
      (next) => {
        if (!alive) {
          void views.closeView({ view_session: next.view_session })
            .catch(() => {});
          return;
        }
        opened = next.view_session;
        setViewSession(next.view_session);
        apply(next);
      },
      () => {
        if (alive) setFailed(true);
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

  return (
    <div className={styles.tab}>
      <BrowserToolbar
        browser={browser}
        viewSession={viewSession}
        state={state}
        focusAddress={props.url === "" && shown}
        onMenuOpenChange={setMenuOpen}
      />
      {popup === null ? null : (
        <div className={styles.notice}>
          <Toast
            key={popup}
            title={t("browser.notice.popup-blocked")}
            duration="brief"
            onClose={() => setPopup(null)}
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
          : null}
      </div>
    </div>
  );
}
