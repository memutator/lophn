// artifact 탭 본문. toolbar 아래 page 자리에 봉한 native view(`lophn-artifact:` 문서)를 붙인다. view는 DOM 위에
// 그려지므로 알림은 overlay로, 모은 목록 panel은 덮개(useViewCover)로 알려 view가 줄어들게 한다.
// 폴더가 없으면 view 없이 안내와 [Retry]만 그린다. 탭이 Float·Dock으로 다시 mount되면 keeps에서 view를 이어 쓰고,
// 닫는 일은 보관소의 주인(Workspace)이 한다.
import { useEffect, useRef, useState } from "react";
import { EmptyState, ErrorState } from "@lophn/ui/feedback";
import { Toast } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import type {
  ArtifactSource,
  ArtifactViewState,
  LophnArtifactApi,
} from "../../ipc/artifact.ts";
import type { LophnShellViewsApi } from "../../ipc/app-frame.ts";
import { useAppViews } from "../app-frame/app-views.tsx";
import { AnnotationPanel } from "../app-frame/annotate/annotation-panel.tsx";
import { useAnnotate } from "../app-frame/annotate/use-annotate.ts";
import { STAY, useViewToast } from "../app-frame/annotate/use-view-toast.ts";
import { useViewBounds, useViewCover } from "../app-frame/embedded-view.tsx";
import type { ViewKeeps } from "../app-frame/view-keeps.ts";
import { useBrowserOverlay } from "../browser/browser-api.tsx";
import { fileNameOf } from "../editor/model.ts";
import { artifactIcons, editorIcons } from "../icons/mod.ts";
import { useAnnotateApi, useArtifactApi } from "./artifact-api.tsx";
import styles from "./artifact-tab.module.css";

interface ArtifactTabProps {
  source: ArtifactSource;
  /** false면 page를 남긴 채 숨긴다(다른 탭·다른 공간). */
  shown: boolean;
  /** Float·Dock으로 다시 mount해도 view를 이어 쓰는 보관소와 탭 key. */
  keeps: ViewKeeps;
  keepKey: string;
  /** 탭 이름이 바뀌었다(page의 title, 없으면 이름). */
  onTitle(title: string): void;
  /** page에서 누른 http/https link. */
  onOpenLink(url: string): void;
  /** [Edit source]. 입구 file의 절대 path. */
  onEditSource(file: string): void;
  /** pane에 열린 이 project place의 lophn session. 없으면 null. */
  placeLophnSession(): string | null;
  /** session의 agent 이름. 모르면 undefined. */
  agentName(session: string): string | undefined;
  /** annotation을 받은 session의 agent 탭을 연다. */
  onOpenSession(session: string): void;
}

// 열기 입력을 이은 글. 입력이 바뀐 view를 다시 쓰지 않게 한다.
function signatureOf(source: ArtifactSource): string {
  return source.kind === "artifact"
    ? `artifact\n${source.domain}\n${source.name}`
    : source.kind === "file"
      ? `file\n${source.project}\n${source.path}`
      : `workflow\n${source.project}\n${source.workflow}\n${source.view}\n${
          source.instance ?? ""
        }`;
}

export function ArtifactTab(props: ArtifactTabProps) {
  const views = useAppViews()?.views;
  const api = useArtifactApi();
  if (views === undefined || api === null) {
    return (
      <ErrorState
        target={t("artifact.label.kind")}
        onRetry={() => globalThis.location.reload()}
      />
    );
  }
  return <OpenTab {...props} views={views} api={api} />;
}

function OpenTab(
  props: ArtifactTabProps & {
    views: LophnShellViewsApi;
    api: LophnArtifactApi;
  },
) {
  const { views, api, source, shown, keeps, keepKey } = props;
  const [viewSession, setViewSession] = useState<string | null>(null);
  const [state, setState] = useState<ArtifactViewState | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const region = useRef<HTMLDivElement | null>(null);
  const panel = useRef<HTMLElement | null>(null);
  const callbacks = useRef(props);
  callbacks.current = props;
  // 보관소에 넘길 마지막 state. view가 아직 없으면 null.
  const last = useRef<ArtifactViewState | null>(null);
  const reported = useRef<string | null>(null);
  const signature = signatureOf(source);
  const name =
    source.kind === "artifact"
      ? source.name
      : source.kind === "file"
        ? fileNameOf(source.path)
        : source.workflow;
  const nameRef = useRef(name);
  nameRef.current = name;
  const report = (next: ArtifactViewState) => {
    const title = next.title || nameRef.current;
    if (title === reported.current) return;
    reported.current = title;
    callbacks.current.onTitle(title);
  };

  // 여는 동안 이 자리가 사라지면 늦게 온 view를 보관소에 넘긴다(탭이 남았으면 다시 mount가 꺼낸다).
  useEffect(() => {
    let alive = true;
    setMissing(false);
    setFailed(false);
    const dispose = (next: ArtifactViewState) =>
      keeps.put(keepKey, {
        session: next.view_session,
        signature,
        state: next,
      });
    const show = (next: ArtifactViewState) => {
      last.current = next;
      keeps.track(keepKey, {
        session: next.view_session,
        signature,
        state: next,
      });
      setViewSession(next.view_session);
      setState(next);
      report(next);
    };
    const kept = keeps.take<ArtifactViewState>(keepKey, signature);
    if (kept !== undefined) {
      show(kept.state);
    } else {
      api.open({ source: callbacks.current.source }).then(
        (next) => {
          if (alive) show(next);
          else dispose(next);
        },
        (error: unknown) => {
          if (!alive) return;
          if (error instanceof Error && error.message === "not_found") {
            setMissing(true);
          } else setFailed(true);
        },
      );
    }
    return () => {
      alive = false;
      setViewSession(null);
      setState(null);
      if (last.current !== null) dispose(last.current);
      last.current = null;
    };
  }, [api, keeps, keepKey, signature, attempt]);

  // main이 그 session의 state와 사건을 민다.
  useEffect(() => {
    if (viewSession === null) return;
    const offState = api.subscribeState((next) => {
      if (next.view_session !== viewSession) return;
      last.current = next;
      keeps.track(keepKey, {
        session: next.view_session,
        signature,
        state: next,
      });
      setState(next);
      report(next);
    });
    const offEvent = api.subscribeEvent((event) => {
      if (event.view_session === viewSession && event.kind === "open-link") {
        callbacks.current.onOpenLink(event.url);
      }
    });
    return () => {
      offState();
      offEvent();
    };
  }, [api, keeps, keepKey, signature, viewSession]);

  const crashed = state?.health === "crashed";
  useViewBounds({
    views,
    viewSession,
    shown: shown && !crashed,
    ref: region,
  });

  // ---- annotate ----

  const annotating = useAnnotate(useAnnotateApi(), viewSession);
  const toast = useViewToast(useBrowserOverlay() ?? undefined);
  const toastKind = useRef<"on" | "sent" | null>(null);
  const annotateOn = annotating.state?.on ?? false;
  const items = annotating.state?.items ?? [];
  const panelOpen = annotateOn && items.length > 0;
  useViewCover(panel, panelOpen);
  useEffect(() => {
    if (annotateOn) {
      toastKind.current = "on";
      toast.show({
        title: t("artifact.title.annotate-on"),
        body: t("artifact.text.annotate-on"),
      });
    } else if (toastKind.current === "on") {
      toastKind.current = null;
      toast.hide();
    }
  }, [annotateOn]);

  async function sendAnnotations(): Promise<void> {
    const sent = await annotating.send({
      session: props.placeLophnSession(),
    });
    if (sent === null) return;
    toastKind.current = "sent";
    toast.show({
      title: t("artifact.title.annotations-sent", {
        count: sent.sent,
        agent: props.agentName(sent.session) ?? t("artifact.label.agent"),
      }),
      body: t("artifact.text.annotations-sent"),
    });
    props.onOpenSession(sent.session);
  }

  const title = state?.title || name;
  const folder =
    source.kind === "file"
      ? source.path.slice(0, Math.max(0, source.path.lastIndexOf("/"))) || "/"
      : null;
  const ready = state !== null && !missing;
  const reload = () => {
    if (viewSession !== null) {
      void api.reload({ view_session: viewSession }).catch(() => {});
    }
  };

  return (
    <div className={styles.tab}>
      <div className={styles.toolbar} data-artifact-toolbar="">
        <span className={styles.heading}>
          <span className={styles.headTitle}>
            <span className={styles.title}>{title}</span>
            <span className={styles.name}>{name}</span>
          </span>
          {folder === null ? null : (
            <span className={styles.rootNote}>
              {t("artifact.note.file-root", { folder })}
            </span>
          )}
        </span>
        <span className={styles.actions}>
          <Button
            size="sm"
            variant="ghost"
            icon={artifactIcons.editSource}
            disabled={!ready}
            onClick={() => state !== null && props.onEditSource(state.file)}
          >
            {t("artifact.button.edit-source")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            icon={editorIcons.edit}
            aria-pressed={annotateOn}
            disabled={!ready}
            onClick={() => annotating.setMode(!annotateOn)}
          >
            {t("artifact.button.annotate")}
          </Button>
        </span>
      </div>
      <div ref={region} className={styles.region} data-artifact-page="">
        {missing ? (
          <EmptyState
            icon={artifactIcons.missing}
            message={t("artifact.empty.missing", { name })}
            action={{
              label: t("common.button.retry"),
              onSelect: () => setAttempt((count) => count + 1),
            }}
          />
        ) : failed ? (
          <ErrorState
            target={t("artifact.label.kind")}
            onRetry={() => setAttempt((count) => count + 1)}
          />
        ) : crashed ? (
          <ErrorState target={t("artifact.label.kind")} onRetry={reload} />
        ) : null}
      </div>
      {toast.dom === null ? null : (
        <div className={styles.toasts}>
          <Toast
            title={toast.dom.title}
            {...(toast.dom.body === undefined ? {} : { body: toast.dom.body })}
            timer={STAY}
            onClose={toast.hide}
          />
        </div>
      )}
      {panelOpen ? (
        <AnnotationPanel
          items={items}
          sending={annotating.state?.phase === "sending"}
          failure={annotating.failure}
          onRemove={annotating.remove}
          onClear={() => annotating.remove("all")}
          onSend={() => void sendAnnotations()}
          sendLabel={t("artifact.button.send-annotations")}
          note={t("artifact.text.annotations-note")}
          panelRef={panel}
        />
      ) : null}
    </div>
  );
}
