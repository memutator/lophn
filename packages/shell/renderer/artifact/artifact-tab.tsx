// artifact 탭 본문. page 자리에 봉한 `lophn-artifact:` page를 창의 <webview> 그릇으로 그린다.
// DOM 안에 그려지므로 알림과 annotation 목록은 z-index로 page 위에 겹친다. 폴더가 없으면 view 없이 안내와
// [Retry]만 그린다. [Edit source]·[Annotate]는 card 머리 줄에 올리고, card 밖(floated 탭, detached 창)이면 본문 위
// toolbar 한 줄로 그린다. 탭이 Float·Dock으로 다시 mount되면 keeps에서 view를 이어 쓰고, 닫는 일은 보관소의
// 주인(Workspace)이 한다.
import { useEffect, useRef, useState } from "react";
import { EmptyState, ErrorState } from "@lophn/ui/feedback";
import { MenuIcon, Toast } from "@lophn/ui/overlay";
import { Button } from "@lophn/ui/primitives";
import { t } from "@lophn/i18n";

import type {
  ArtifactSource,
  ArtifactViewState,
  LophnArtifactApi,
} from "../../ipc/artifact.ts";
import { useAppViews } from "../app-frame/app-views.tsx";
import { annotateHead } from "../app-frame/annotate/annotate-head.tsx";
import { useAnnotate } from "../app-frame/annotate/use-annotate.ts";
import { STAY, useViewToast } from "../app-frame/annotate/use-view-toast.ts";
import {
  useViewLayer,
  useWebviewHost,
  useWebviewSlot,
  type WebviewHost,
} from "../app-frame/webview-host.tsx";
import type { ViewKeeps } from "../app-frame/view-keeps.ts";
import { useBrowserOverlay } from "../browser/browser-api.tsx";
import { useCardHead } from "../shell/card-head.tsx";
import { fileNameOf } from "../editor/model.ts";
import { artifactIcons, editorIcons } from "../icons/mod.ts";
import { useAnnotateApi, useArtifactApi } from "./artifact-api.tsx";
import styles from "./artifact-tab.module.css";

// ⋯ 메뉴 항목 id. 탭 기본 항목과 겹치지 않는다.
const ANNOTATE_ITEM = "shell:annotate";

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
    ? `artifact\n${"app" in source ? source.app : source.project}\n${source.name}`
    : source.kind === "file"
      ? `file\n${source.project}\n${source.path}`
      : `workflow\n${source.project}\n${source.workflow}\n${source.view}\n${
          source.instance ?? ""
        }`;
}

export function ArtifactTab(props: ArtifactTabProps) {
  const views = useAppViews()?.views;
  const api = useArtifactApi();
  const webviews = useWebviewHost();
  if (views === undefined || api === null || webviews === null) {
    return (
      <ErrorState
        target={t("artifact.label.kind")}
        onRetry={() => globalThis.location.reload()}
      />
    );
  }
  return <OpenTab {...props} api={api} webviews={webviews} />;
}

function OpenTab(
  props: ArtifactTabProps & {
    api: LophnArtifactApi;
    webviews: WebviewHost;
  },
) {
  const { api, source, shown, keeps, keepKey, webviews } = props;
  const layer = useViewLayer();
  const [viewSession, setViewSession] = useState<string | null>(null);
  const [state, setState] = useState<ArtifactViewState | null>(null);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const region = useRef<HTMLDivElement | null>(null);
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
  useWebviewSlot({
    host: webviews,
    kind: "artifact",
    enabled: state !== null && !missing && !failed && !crashed,
    key: keepKey,
    src: state?.src ?? "",
    ref: region,
    shown: shown && !crashed,
    layer,
  });

  // ---- annotate ----

  const annotating = useAnnotate(useAnnotateApi(), viewSession);
  const toast = useViewToast(useBrowserOverlay() ?? undefined);
  const annotateOn = annotating.state?.on ?? false;
  const count = annotating.state?.items.length ?? 0;
  const sending = annotating.state?.phase === "sending";
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

  async function sendAnnotations(): Promise<void> {
    const sent = await annotating.send({
      session: props.placeLophnSession(),
    });
    if (sent === null) return;
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

  // 머리에 올린 단추의 callback은 deps에 없는 최신 값을 읽는다.
  const latest = useRef({ props, state, annotating, sendAnnotations });
  latest.current = { props, state, annotating, sendAnnotations };
  const rootNote =
    folder === null ? null : (
      <span className={styles.rootNote}>
        {t("artifact.note.file-root", { folder })}
      </span>
    );
  const editSource = (
    <Button
      size="sm"
      variant="ghost"
      icon={artifactIcons.editSource}
      disabled={!ready}
      onClick={() => {
        const { props: current, state: now } = latest.current;
        if (now !== null) current.onEditSource(now.file);
      }}
    >
      {t("artifact.button.edit-source")}
    </Button>
  );
  // card 밖(floated)에는 ⋯ 메뉴가 없어 Annotate도 단추로 둔다.
  const buttons = (
    <span className={styles.actions} data-artifact-toolbar="">
      {editSource}
      <Button
        size="sm"
        variant="ghost"
        icon={editorIcons.edit}
        disabled={!ready}
        onClick={() => latest.current.annotating.setMode(true)}
      >
        {t("artifact.button.annotate")}
      </Button>
    </span>
  );
  // Annotate 중에는 머리 줄 전체가 Annotate 줄이다(annotate-head.tsx).
  const annotateBar = annotateOn
    ? annotateHead({
        target: title,
        count,
        sending,
        sendLabel: t("artifact.button.send-annotations"),
        note: t("artifact.text.annotations-note"),
        guide: t("artifact.text.annotate-on"),
        onClear: () => latest.current.annotating.remove("all"),
        onDone: () => latest.current.annotating.setMode(false),
        onSend: () => void latest.current.sendAnnotations(),
      })
    : null;
  // card 안이면 Edit source와 폴더 안내를 card 머리 줄에, Annotate를 ⋯ 메뉴 맨 위에 올린다. 제목은 경로가 이미 보인다.
  const inCard = useCardHead(
    annotateBar ?? {
      actions: (
        <>
          {rootNote}
          <span className={styles.actions} data-artifact-toolbar="">
            {editSource}
          </span>
        </>
      ),
      menu: {
        items: [
          {
            id: ANNOTATE_ITEM,
            label: t("artifact.button.annotate"),
            leading: <MenuIcon icon={editorIcons.edit} />,
            ...(ready ? {} : { disabled: true }),
          },
        ],
        onSelect: () => latest.current.annotating.setMode(true),
      },
    },
    [ready, annotateOn, folder, count, sending, title],
  );

  return (
    <div className={styles.tab}>
      {inCard ? null : annotateBar !== null ? (
        <div className={styles.toolbar}>
          {annotateBar.center}
          {annotateBar.actions}
        </div>
      ) : (
        <div className={styles.toolbar}>
          <span className={styles.heading}>
            <span className={styles.headTitle}>
              <span className={styles.title}>{title}</span>
              <span className={styles.name}>{name}</span>
            </span>
            {rootNote}
          </span>
          {buttons}
        </div>
      )}
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
    </div>
  );
}
