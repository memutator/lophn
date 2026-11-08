// 앱 workspace의 앱 화면 탭. 앱의 현재 release entry screen 하나를 tab 자리로 연다. 탭이 안 보이거나 다시 mount돼도
// view는 남겨 숨기고(keepKey), 탭이 layout에서 사라지면 폐기한다. Annotate는 card 머리 줄 ⋯ 메뉴의 맨 위 항목(앱 항목 앞)이고,
// 켜진 동안은 머리 줄 전체가 Annotate 줄(annotate-head.tsx)로 바뀐다. 보냄·실패 알림은 view 위쪽 toast다.
import { useEffect, useRef, useState } from "react";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { MenuIcon, Toast } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import type { AppFrameViewState } from "../../ipc/app-frame.ts";
import { annotateHead } from "../app-frame/annotate/annotate-head.tsx";
import { useAnnotate } from "../app-frame/annotate/use-annotate.ts";
import { STAY, useViewToast } from "../app-frame/annotate/use-view-toast.ts";
import { useAppViews, useAppWorkspace } from "../app-frame/app-views.tsx";
import type { ShellHead } from "../app-frame/app-tab-head.tsx";
import { EmbeddedView } from "../app-frame/embedded-view.tsx";
import { ViewChrome } from "../app-frame/view-chrome.tsx";
import { useAnnotateApi } from "../artifact/artifact-api.tsx";
import { useBrowserOverlay } from "../browser/browser-api.tsx";
import { editorIcons } from "../icons/mod.ts";
import type { AppRow, AppsSource } from "../apps/source.ts";
import type { AgentViewSlice } from "./kinds/host.ts";
import styles from "./app-screen-tab.module.css";

// ⋯ 메뉴 항목 id. 앱 항목(`app-head:`)과 탭 기본 항목과 겹치지 않는다.
const ANNOTATE_ITEM = "shell:annotate";

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
  /** annotation을 받는 lophn session. 통로가 없으면 null이다. */
  agentView: AgentViewSlice | null;
}

export function AppScreenTab(props: AppScreenTabProps) {
  const { app, source, shown, keepKey, agentView } = props;
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

  // ---- annotate ----

  const annotateApi = useAnnotateApi();
  const annotating = useAnnotate(annotateApi, state?.view_session ?? null);
  const toast = useViewToast(useBrowserOverlay() ?? undefined);
  const annotateOn = annotating.state?.on ?? false;
  const failure = annotating.failure;
  useEffect(() => {
    if (failure === null) return;
    toast.show({
      title:
        failure === "archived"
          ? t("app-space.error.annotations-archived")
          : t("app-space.error.annotations-failed"),
    });
  }, [failure]);

  // 받는 쪽은 이 앱 workspace에서 열린 lophn session이다. 없으면 lophn의 새 session이다.
  async function sendAnnotations(): Promise<void> {
    const session = agentView?.workspaceLophnSession() ?? null;
    const sent = await annotating.send({ session });
    if (sent === null) return;
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
  const count = annotating.state?.items.length ?? 0;
  const sending = annotating.state?.phase === "sending";
  // 머리 줄에 올린 단추의 callback은 다시 올리지 않아도 최신 값을 읽는다.
  const latest = useRef({ annotating, annotateOn, sendAnnotations });
  latest.current = { annotating, annotateOn, sendAnnotations };

  const retry = () => setAttempt((count) => count + 1);
  const row = record.state === "ready" ? record.row : null;
  const target = row?.name ?? "";
  let shellHead: ShellHead | undefined;
  if (annotateApi === undefined || state === null) shellHead = undefined;
  else if (annotateOn) {
    shellHead = {
      key: `on:${count}:${sending}:${target}`,
      ...annotateHead({
        target,
        count,
        sending,
        sendLabel: t("app-space.button.send-annotations-to", {
          agent: "lophn",
        }),
        note: t("app-space.text.annotations-note-to", { agent: "lophn" }),
        guide: t("app-space.text.annotate-on"),
        onClear: () => latest.current.annotating.remove("all"),
        onDone: () => latest.current.annotating.setMode(false),
        onSend: () => void latest.current.sendAnnotations(),
      }),
    };
  } else {
    shellHead = {
      key: "off",
      menu: {
        items: [
          {
            id: ANNOTATE_ITEM,
            label: t("app-space.button.annotate"),
            leading: <MenuIcon icon={editorIcons.edit} />,
          },
        ],
        onSelect: () => latest.current.annotating.setMode(true),
      },
    };
  }
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
        place="tab"
        workspace={workspace}
        label={row.name}
        shown={shown}
        keepKey={keepKey}
        tabHead
        {...(shellHead === undefined ? {} : { shellHead })}
        onState={setState}
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
