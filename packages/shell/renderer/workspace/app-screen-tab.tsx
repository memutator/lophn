// 앱 place의 앱 화면 탭. 앱의 현재 release entry screen 하나를 full 크기로 연다. 탭이 안 보이거나 다시 mount돼도
// view는 남겨 숨기고(keepKey), 탭이 layout에서 사라지면 폐기한다. Annotate의 요청은 App panel이 보내고, 이 탭은
// 같은 view의 annotation 목록과 알림을 view 위에 그린다.
import { useEffect, useRef, useState } from "react";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { Toast } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import { LOPHN_AGENT_ID } from "../../../protocol/lophn-agent/places.ts";
import type { AppFrameViewState } from "../../ipc/app-frame.ts";
import { AnnotationPanel } from "../app-frame/annotate/annotation-panel.tsx";
import { useAnnotate } from "../app-frame/annotate/use-annotate.ts";
import { STAY, useViewToast } from "../app-frame/annotate/use-view-toast.ts";
import { useAppViews } from "../app-frame/app-views.tsx";
import { EmbeddedView } from "../app-frame/embedded-view.tsx";
import { ViewChrome } from "../app-frame/view-chrome.tsx";
import { useAnnotateApi } from "../artifact/artifact-api.tsx";
import { useBrowserOverlay } from "../browser/browser-api.tsx";
import type { AppRow, AppsSource } from "../apps/source.ts";
import type { AgentViewSlice } from "./kinds/host.ts";
import styles from "./app-screen-tab.module.css";

type AppRecord =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "missing" }
  | { readonly state: "ready"; readonly row: AppRow };

type Entry =
  | { readonly state: "loading" }
  | { readonly state: "unavailable" }
  | { readonly state: "ready"; readonly screen: string };

interface AppScreenTabProps {
  app: string;
  source: AppsSource | undefined;
  /** 칸에 보이는 고른 탭인지. false면 view를 남긴 채 숨긴다. */
  shown: boolean;
  keepKey: string;
  /** 화면이 열리거나 닫히면 알린다(App panel의 Annotate가 이 view를 가리킨다). */
  onView: (state: AppFrameViewState | null) => void;
  /** annotation을 받는 lophn session. 통로가 없으면 null이다. */
  agentView: AgentViewSlice | null;
}

export function AppScreenTab(props: AppScreenTabProps) {
  const { app, source, shown, keepKey, agentView } = props;
  const deps = useAppViews();
  const [attempt, setAttempt] = useState(0);
  const [record, setRecord] = useState<AppRecord>({ state: "loading" });
  const [entry, setEntry] = useState<Entry>({ state: "loading" });
  const [state, setState] = useState<AppFrameViewState | null>(null);
  const onView = useRef(props.onView);
  onView.current = props.onView;

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
      void source.entryScreen(app, row.release).then((screen) => {
        if (live) {
          setEntry(
            screen.ok
              ? { state: "ready", screen: screen.value }
              : { state: "unavailable" },
          );
        }
      });
    });
    return () => {
      live = false;
    };
  }, [source, app, attempt]);

  useEffect(() => () => onView.current(null), []);

  // ---- annotate ----

  const annotating = useAnnotate(useAnnotateApi(), state?.view_session ?? null);
  const toast = useViewToast(useBrowserOverlay() ?? undefined);
  const toastKind = useRef<"on" | "sent" | null>(null);
  const annotateOn = annotating.state?.on ?? false;
  const turnOff = annotating.setMode;
  useEffect(() => {
    if (annotateOn) {
      toastKind.current = "on";
      toast.show({
        title: t("app-space.title.annotate-on"),
        body: t("app-space.text.annotate-on"),
        action: {
          label: t("app-space.button.annotate-done"),
          run: () => turnOff(false),
        },
      });
    } else if (toastKind.current === "on") {
      toastKind.current = null;
      toast.hide();
    }
  }, [annotateOn]);

  // 받는 쪽은 이 앱 place에서 열린 lophn session이다. 없으면 lophn의 새 session이다.
  async function sendAnnotations(): Promise<void> {
    const session = agentView?.placeLophnSession() ?? null;
    const sent = await annotating.send({ agent: LOPHN_AGENT_ID, session });
    if (sent === null) return;
    toastKind.current = "sent";
    const agent = agentView?.nameOf(sent.session) ?? "lophn";
    toast.show({
      title: t("app-space.title.annotations-sent-to", {
        count: sent.sent,
        agent,
      }),
      body: t("app-space.text.annotations-sent"),
    });
    agentView?.openSession(sent.session);
  }
  const annotations = annotating.state?.items ?? [];

  const retry = () => setAttempt((count) => count + 1);
  const row = record.state === "ready" ? record.row : null;
  let body;
  let embedded = false;
  if (source === undefined || deps === null) {
    body = (
      <p className={styles.state} data-screen-not-ready="">
        {t("app-space.empty.screen-not-ready")}
      </p>
    );
  } else if (record.state === "failed") {
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
        size="full"
        label={row.name}
        shown={shown}
        keepKey={keepKey}
        onState={(next) => {
          setState(next);
          onView.current(next);
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
      {annotateOn && annotations.length > 0 ? (
        <AnnotationPanel
          items={annotations}
          sending={annotating.state?.phase === "sending"}
          failure={annotating.failure}
          onRemove={annotating.remove}
          onClear={() => annotating.remove("all")}
          onSend={() => void sendAnnotations()}
          sendLabel={t("app-space.button.send-annotations-to", {
            agent: "lophn",
          })}
          note={t("app-space.text.annotations-note-to", { agent: "lophn" })}
        />
      ) : null}
    </div>
  );
}
