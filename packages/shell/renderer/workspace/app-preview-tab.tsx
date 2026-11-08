// app_preview 탭. 그 앱에서 지금 돌고 있는 preview를 앱 view(mode preview)로 보인다. 앱마다 탭 하나이고 지금 preview를 따라간다:
// 2초마다 `previews.get`을 읽어 process가 바뀌면 view를 새로 열고, 없어지면 "돌고 있는 preview 없음"을 보인다.
// Annotate는 앱 화면 탭과 같은 길(use-tab-annotate.tsx)이고, 보낸 annotation은 release 대신 preview의 bundle hash를 싣는다.
import { createContext, useContext, useEffect, useState } from "react";
import { Button } from "@lophn/ui/primitives";
import { Toast } from "@lophn/ui/overlay";
import { t } from "@lophn/i18n";

import { STAY } from "../app-frame/annotate/use-view-toast.ts";
import { useAppViews, useAppWorkspace } from "../app-frame/app-views.tsx";
import { EmbeddedView } from "../app-frame/embedded-view.tsx";
import { useWebviewHost } from "../app-frame/webview-host.tsx";
import type { AppRow, AppsSource } from "../apps/source.ts";
import {
  type CoreSource,
  windowCoreSource,
} from "../desktop/connection/connection.ts";
import type { AppFrameViewState } from "../../ipc/app-frame.ts";
import type { AgentViewSlice } from "./kinds/host.ts";
import { AgentControlBar } from "../browser/browser-chrome.tsx";
import { useAgentControl } from "./use-surface-requests.ts";
import { useTabAnnotate } from "./use-tab-annotate.tsx";
import styles from "./app-preview-tab.module.css";

const POLL_MS = 2000;

/** 지금 돌고 있는 preview 하나. release는 없을 수 있다(bundle만 띄운 preview). */
export interface RunningPreview {
  readonly nonce: string;
  readonly release: string | null;
}

export interface PreviewSource {
  /** 그 앱에서 ready인 preview. 없으면 null이고, 못 읽으면 undefined다. */
  current(app: string): Promise<RunningPreview | null | undefined>;
  stop(app: string, nonce: string): Promise<void>;
}

export function corePreviewSource(core: CoreSource): PreviewSource {
  return {
    async current(app) {
      const reply = await core.call({
        kind: "read",
        resource: "previews",
        method: "get",
        body: { app },
      });
      if (!reply.ok) return undefined;
      const observation = (
        reply.value as {
          observation: {
            process_nonce: string;
            release: string | null;
            ready: boolean;
          } | null;
        }
      ).observation;
      return observation === null || !observation.ready
        ? null
        : { nonce: observation.process_nonce, release: observation.release };
    },
    async stop(app, nonce) {
      await core.call({
        kind: "read",
        resource: "previews",
        method: "stop",
        body: { app, process_nonce: nonce },
      });
    },
  };
}

const PreviewSourceContext = createContext<PreviewSource | null>(null);
export const PreviewSourceProvider = PreviewSourceContext.Provider;

// preload가 없는 창에서는 call이 거절되어 preview가 없는 것과 같이 보인다.
let windowSource: PreviewSource | undefined;
function usePreviewSource(): PreviewSource {
  const given = useContext(PreviewSourceContext);
  if (given !== null) return given;
  windowSource ??= corePreviewSource(windowCoreSource());
  return windowSource;
}

/** 그 앱의 preview를 따라간다. undefined는 아직 읽기 전이다. */
export function useRunningPreview(app: string): {
  preview: RunningPreview | null | undefined;
  stop(): void;
} {
  const source = usePreviewSource();
  const [preview, setPreview] = useState<RunningPreview | null | undefined>();
  const [again, setAgain] = useState(0);
  useEffect(() => {
    let live = true;
    const read = () =>
      void source.current(app).then((next) => {
        if (!live || next === undefined) return;
        // 같은 process면 state를 바꾸지 않아 view를 다시 열지 않는다.
        setPreview((last) =>
          last?.nonce === next?.nonce && last?.release === next?.release
            ? last
            : next,
        );
      });
    read();
    const timer = setInterval(read, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [source, app, again]);
  return {
    preview,
    stop() {
      if (preview === null || preview === undefined) return;
      void source.stop(app, preview.nonce).then(() => setAgain((n) => n + 1));
    },
  };
}

type Entry =
  | { readonly state: "loading" }
  | { readonly state: "unavailable" }
  | { readonly state: "ready"; readonly screen: string };

interface AppPreviewTabProps {
  app: string;
  /** 탭 key. agent가 연 탭은 `host:<tab id>`다. */
  tabKey: string;
  source: AppsSource | undefined;
  shown: boolean;
  /** annotation을 받는 lophn session. 통로가 없으면 null이다. */
  agentView: AgentViewSlice | null;
}

export function AppPreviewTab(props: AppPreviewTabProps) {
  const { app, source, shown, agentView } = props;
  const deps = useAppViews();
  const workspace = useAppWorkspace();
  const { preview, stop } = useRunningPreview(app);
  const [row, setRow] = useState<AppRow | null>(null);
  const [entry, setEntry] = useState<Entry>({ state: "loading" });
  const [state, setState] = useState<AppFrameViewState | null>(null);

  useEffect(() => {
    if (source === undefined) return;
    let live = true;
    void source.get(app).then((result) => {
      if (live && result.ok) setRow(result.value);
    });
    return () => {
      live = false;
    };
  }, [source, app]);

  // 화면은 그 release의 선언에서 읽는다. release 없는 preview는 어느 화면을 열지 알 수 없다.
  const release = preview?.release ?? null;
  useEffect(() => {
    setEntry({ state: "loading" });
    if (source === undefined || release === null) return;
    let live = true;
    void source.entryScreen(app, release).then((screen) => {
      if (live) {
        setEntry(
          screen.ok
            ? { state: "ready", screen: screen.value }
            : { state: "unavailable" },
        );
      }
    });
    return () => {
      live = false;
    };
  }, [source, app, release, preview?.nonce]);

  const agent = useAgentControl(props.tabKey, state?.view_session ?? null);
  // agent가 다루는 동안은 가려져도 그리기를 이어 간다. view의 element key가 view session이다.
  const webviews = useWebviewHost();
  const drivenKey = state?.view_session ?? null;
  const driven = agent !== null;
  useEffect(() => {
    if (webviews === null || drivenKey === null) return;
    webviews.setDriven(drivenKey, driven);
    return () => webviews.setDriven(drivenKey, false);
  }, [webviews, drivenKey, driven]);
  const { shellHead, toast } = useTabAnnotate({
    viewSession: state?.view_session ?? null,
    target: row?.name ?? "",
    agentView,
  });

  let body;
  if (preview === undefined) body = null;
  else if (preview === null) {
    body = <p className={styles.state}>{t("app-space.empty.no-preview")}</p>;
  } else if (entry.state === "unavailable") {
    body = (
      <p className={styles.state}>{t("app-space.empty.screen-not-ready")}</p>
    );
  } else if (entry.state === "ready" && deps !== null) {
    body = (
      <EmbeddedView
        key={preview.nonce}
        views={deps.views}
        app={app}
        mode="preview"
        release={preview.release}
        screen={entry.screen}
        place="tab"
        workspace={workspace}
        label={row?.name ?? ""}
        shown={shown}
        tabHead
        {...(shellHead === undefined ? {} : { shellHead })}
        onState={setState}
      />
    );
  }

  return (
    <div className={styles.tab} data-app-preview={app}>
      <div className={styles.notice} data-preview-notice="">
        <span className={styles.text}>
          {t("app-space.text.preview-notice")}
        </span>
        {agent === null ? null : <AgentControlBar control={agent} />}
        <Button
          size="sm"
          variant="ghost"
          disabled={preview === null || preview === undefined}
          data-preview-stop=""
          onClick={stop}
        >
          {t("app-space.button.stop-preview")}
        </Button>
      </div>
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
