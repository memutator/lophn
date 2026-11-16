// 앱 workspace의 앱 화면 탭. 앱의 현재 release entry screen 하나를 tab 자리로 연다. 탭이 안 보이거나 다시 mount돼도
// view는 남겨 숨기고(keepKey), 탭이 layout에서 사라지면 폐기한다. Annotate는 card 머리 줄 ⋯ 메뉴의 맨 위 항목(앱 항목 앞)이고,
// 켜진 동안은 머리 줄 전체가 Annotate 줄(annotate-head.tsx)로 바뀐다. 보냄·실패 알림은 view 위쪽 toast다.
import { useEffect, useRef, useState } from "react";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { Toast } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import type { AppFrameViewState } from "../../ipc/app-frame.ts";
import { STAY } from "../app-frame/annotate/use-view-toast.ts";
import { useNotRunningFailure } from "../app-frame/app-not-running.tsx";
import { useAppViews, useAppWorkspace } from "../app-frame/app-views.tsx";
import { EmbeddedView } from "../app-frame/embedded-view.tsx";
import { ViewChrome } from "../app-frame/view-chrome.tsx";
import type { AppRow, AppsSource } from "../apps/source.ts";
import { useRunningPreview } from "./app-preview-tab.tsx";
import { useTabAnnotate } from "./use-tab-annotate.tsx";
import type { AgentViewSlice } from "./kinds/host.ts";
import styles from "./app-screen-tab.module.css";

type AppRecord =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "missing" }
  | { readonly state: "ready"; readonly row: AppRow };

type Entry =
  | { readonly state: "loading" }
  /** 선언에 tab 화면이 없다(영구). */
  | { readonly state: "unavailable" }
  /** 선언을 읽지 못했다(일시일 수 있다). */
  | { readonly state: "failed" }
  | { readonly state: "ready"; readonly screen: string };

interface AppScreenTabProps {
  app: string;
  source: AppsSource | undefined;
  /** 칸에 보이는 고른 탭인지. false면 view를 남긴 채 숨긴다. */
  shown: boolean;
  keepKey: string;
  /** annotation을 받는 lophn session. 통로가 없으면 null이다. */
  agentView: AgentViewSlice | null;
  /** 이 앱의 preview 탭을 연다. */
  onOpenPreview: () => void;
}

export function AppScreenTab(props: AppScreenTabProps) {
  const { app, source, shown, keepKey, agentView, onOpenPreview } = props;
  // 돌고 있는 preview가 있을 때만 머리 줄에 [Preview]가 선다.
  const previewRunning = (useRunningPreview(app).preview ?? null) !== null;
  const deps = useAppViews();
  const workspace = useAppWorkspace();
  const [attempt, setAttempt] = useState(0);
  const [record, setRecord] = useState<AppRecord>({ state: "loading" });
  const [entry, setEntry] = useState<Entry>({ state: "loading" });
  const [state, setState] = useState<AppFrameViewState | null>(null);

  useEffect(() => {
    if (source === undefined) return;
    let live = true;
    setRecord({ state: "loading" });
    setEntry({ state: "loading" });
    void source.get(app).then((result) => {
      if (!live) return;
      if (!result.ok) setRecord({ state: "failed" });
      else if (result.value === null) setRecord({ state: "missing" });
      else setRecord({ state: "ready", row: result.value });
      const row = result.ok ? result.value : null;
      if (row === null || row.archived || row.release === null) return;
      void source.screenToOpen(app, row.release).then((screen) => {
        if (live) {
          setEntry(
            screen.ok
              ? { state: "ready", screen: screen.value.key }
              : {
                  state: screen.code === "not_found" ? "unavailable" : "failed",
                },
          );
        }
      });
    });
    return () => {
      live = false;
    };
  }, [source, app, attempt]);

  // 머리 줄의 [Preview]는 다시 올리지 않아도 최신 callback을 읽는다.
  const openPreview = useRef(onOpenPreview);
  openPreview.current = onOpenPreview;
  const { shellHead, toast } = useTabAnnotate({
    viewSession: state?.view_session ?? null,
    target: record.state === "ready" ? record.row.name : "",
    agentView,
    off: {
      key: `off:${previewRunning}`,
      actions: previewRunning ? (
        <Button
          size="sm"
          variant="ghost"
          data-open-preview=""
          onClick={() => openPreview.current()}
        >
          {t("app-space.button.open-preview")}
        </Button>
      ) : undefined,
    },
  });

  const retry = () => setAttempt((count) => count + 1);
  const notRunning = useNotRunningFailure(
    app,
    record.state === "ready" ? record.row.name : t("app-space.label.this-app"),
  );
  const row = record.state === "ready" ? record.row : null;
  let body;
  let embedded = false;
  if (source === undefined || deps === null) {
    body = (
      <p className={styles.state} data-screen-not-ready="">
        {t("app-space.empty.screen-not-ready")}
      </p>
    );
  } else if (record.state === "failed" || entry.state === "failed") {
    return (
      <ErrorState target={t("app-space.label.this-app")} onRetry={retry} />
    );
  } else if (record.state === "missing") {
    body = <p className={styles.state}>{t("app-space.empty.not-found")}</p>;
  } else if (row?.archived) {
    body = <p className={styles.state}>{t("app-space.empty.archived")}</p>;
  } else if (row !== null && row.release === null) {
    body = <p className={styles.state}>{t("app-space.empty.no-version")}</p>;
  } else if (entry.state === "unavailable") {
    body = (
      <p className={styles.state} data-screen-not-ready="">
        {t("app-space.empty.screen-not-ready")}
      </p>
    );
  } else if (row !== null && row.release !== null && entry.state === "ready") {
    embedded = true;
    body = (
      <EmbeddedView
        key={attempt}
        views={deps.views}
        app={app}
        mode="live"
        release={row.release}
        screen={entry.screen}
        place="tab"
        workspace={workspace}
        label={row.name}
        shown={shown}
        keepKey={keepKey}
        tabHead
        {...(shellHead === undefined ? {} : { shellHead })}
        renderFailure={notRunning.renderFailure}
        onState={(next) => {
          notRunning.onOpened();
          setState(next);
        }}
      />
    );
  } else {
    body = (
      <Loading
        loading
        placeholder={
          <div className={styles.placeholder} aria-busy="true">
            <Skeleton lines={3} />
          </div>
        }
      >
        {null}
      </Loading>
    );
  }

  // 평소에는 크롬 줄을 두지 않는다. 탭과 앱 화면 사이에 다른 바탕의 줄이 끼면 한 면으로 이어지지 않는다.
  const troubled =
    embedded &&
    ((state?.viewHealth !== undefined && state.viewHealth !== "ok") ||
      state?.connectionState === "stopped" ||
      state?.connectionState === "unavailable");
  return (
    <div className={styles.tab} data-app-screen={app}>
      {troubled && deps !== null ? (
        <ViewChrome
          name={row?.name ?? ""}
          mode="live"
          connection={state?.connectionState ?? null}
          viewSession={state?.view_session ?? null}
          health={state?.viewHealth}
          onReopen={(view_session) =>
            void deps.views.reopenView({ view_session }).catch(() => {})
          }
        />
      ) : null}
      <div className={styles.view}>
        {body}
        {toast.dom === null ? null : (
          <div className={styles.toast} data-view-toast="">
            <Toast
              title={toast.dom.title}
              {...(toast.dom.body === undefined
                ? {}
                : { body: toast.dom.body })}
              actions={
                toast.dom.action
                  ? [{ id: "act", label: toast.dom.action.label }]
                  : []
              }
              onAction={() => toast.dom?.action?.run()}
              onClose={toast.hide}
              timer={STAY}
            />
          </div>
        )}
      </div>
    </div>
  );
}
