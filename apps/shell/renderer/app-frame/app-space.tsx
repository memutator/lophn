// 앱 공간(shell/app-frame#R26, architecture/shell 2.4 `/apps/:app`). 얇은 바 아래 본문 전체에
// 그 앱의 native view 하나를 붙인다. 운영 패널은 720px로 열고 좁은 창에서는 본문을 덮되 앱
// view는 덮이지 않는 영역으로 줄어든다. lophn 크롬은 그 앱의 결정 대기와 lophn 장애 안내만이다
// (desktop#R27). 다른 공간으로 가면 이 공간이 사라지며 그 view를 닫는다(R27, EmbeddedView).
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  ErrorState,
  Loading,
  Skeleton,
  useObservedSize,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import type { LophnAppWindowsApi } from "../../ipc/app-window.ts";
import type { LophnShellFeedbackBegin } from "../../ipc/feedback.ts";
import type {
  AppFrameViewState,
  LophnShellViewsApi,
} from "../../ipc/app-frame.ts";
import {
  DockSlot,
  DockToggle,
  useConversation,
} from "../conversation/dock-slot.tsx";
import { dockPlacement } from "../conversation/model.ts";
import { SpaceDecisions } from "../desktop/notification-chip/space-decisions.tsx";
import {
  type AppStatus,
  appStatus,
} from "../desktop/lophn-space/apps/model.ts";
import type {
  AppRow,
  AppsSource,
  RunState,
} from "../desktop/lophn-space/apps/source.ts";
import { AppDetail } from "./app-detail/app-detail.tsx";
import type { PreviewOpen } from "./app-detail/model.ts";
import { IssuesTab } from "./app-detail/issues/issues-tab.tsx";
import type { IssuesSource } from "./app-detail/issues/source.ts";
import { withReportAgain } from "./app-detail/issues/report-again.ts";
import { TasksTab } from "./app-detail/tasks/tasks-tab.tsx";
import type { TasksSource } from "./app-detail/tasks/source.ts";
import type { AppDetailSource } from "./app-detail/source.ts";
import { AppBar } from "./app-bar.tsx";
import {
  createViewCovers,
  EmbeddedView,
  useViewCover,
  ViewCoversProvider,
} from "./embedded-view.tsx";
import { OpsPanelFrame, opsPanelPlacement } from "./ops-panel-frame.tsx";
import { ReportButton } from "./report-button.tsx";
import styles from "./app-space.module.css";

export interface AppSpaceProps {
  app: string;
  source: AppsSource;
  /** shell preload의 view 통로. 없으면 앱 화면을 열 수 없다고 보인다. */
  views?: LophnShellViewsApi;
  /** 새 창 열기와 OS 앱 바로가기 통로. 없으면 그 조작을 두지 않는다. */
  windows?: LophnAppWindowsApi;
  /** [Report a problem] 통로. 없으면 버튼을 두지 않는다. */
  feedback?: LophnShellFeedbackBegin;
  /** 운영 패널의 app-detail 통로. 없으면 app-detail 탭을 두지 않는다. */
  detail?: AppDetailSource;
  /** 운영 패널 Issues 탭의 통로. 없으면 Issues 탭은 아직 없다고 보인다. */
  issues?: IssuesSource;
  /** 있으면 운영 패널을 Issues 탭으로, 그 문제를 고른 채 연다. */
  issueProblem?: string;
  /** 운영 패널 Tasks 탭의 통로(shell#T50). 없으면 Tasks 탭은 아직 없다고 보인다. */
  tasks?: TasksSource;
  /**
   * 있으면 운영 패널을 Tasks 탭으로 연다. ticket이 있으면 그 Task를 고른 채(취소 링크), create면 새 Task 입력을
   * 펼친 채(생성 링크) 연다.
   */
  taskTarget?: { readonly ticket: string | null; readonly create: boolean };
  /** app 층 [Instructions]를 연다. 없으면 단추를 두지 않는다. */
  onInstructions?: () => void;
  /** 창 폭. 테스트가 고정하고 화면은 관측값을 쓴다. */
  windowWidth: number;
  onLauncher: () => void;
  /** 문서 작업대(lophn 공간 documents)로 바꾼다. */
  onDocuments: () => void;
  /** 대화의 결과 링크로 그 문서를 연다. */
  onOpenResult?: (document: string, version: string | null) => void;
  onThingsToConfirm: () => void;
}

type AppRecord =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | { readonly state: "missing" }
  | { readonly state: "ready"; readonly row: AppRow };

type Entry =
  | { readonly state: "loading" }
  | { readonly state: "unavailable" }
  | { readonly state: "ready"; readonly screen: string };

type ShortcutNotice = "added" | "removed" | "not-installed" | "failed";

function shortcutText(notice: ShortcutNotice): string {
  switch (notice) {
    case "added":
      return t("app-space.notice.shortcut-added");
    case "removed":
      return t("app-space.notice.shortcut-removed");
    case "not-installed":
      return t("app-space.notice.shortcut-not-installed");
    case "failed":
      return t("app-space.notice.shortcut-failed");
  }
}

function useAppRecord(source: AppsSource, app: string, attempt: number) {
  const [record, setRecord] = useState<AppRecord>({ state: "loading" });
  const [run, setRun] = useState<RunState | null>(null);
  useEffect(() => {
    let live = true;
    setRecord({ state: "loading" });
    void source.get(app).then((result) => {
      if (!live) return;
      if (!result.ok) setRecord({ state: "failed" });
      else if (result.value === null) setRecord({ state: "missing" });
      else setRecord({ state: "ready", row: result.value });
    });
    void source.runtime(app).then((result) => {
      if (live && result.ok) setRun(result.value);
    });
    return () => {
      live = false;
    };
  }, [source, app, attempt]);
  return { record, run, setRun };
}

function useEntry(
  source: AppsSource,
  app: string,
  release: string | null,
): Entry {
  const [entry, setEntry] = useState<Entry>({ state: "loading" });
  useEffect(() => {
    if (release === null) return;
    let live = true;
    setEntry({ state: "loading" });
    void source.entryScreen(app, release).then((result) => {
      if (!live) return;
      setEntry(
        result.ok
          ? { state: "ready", screen: result.value }
          : { state: "unavailable" },
      );
    });
    return () => {
      live = false;
    };
  }, [source, app, release]);
  return entry;
}

export function AppSpace(
  {
    app,
    source,
    views,
    windows,
    feedback,
    detail,
    issues,
    issueProblem,
    tasks,
    taskTarget,
    onInstructions,
    windowWidth,
    onLauncher,
    onDocuments,
    onOpenResult,
    onThingsToConfirm,
  }: AppSpaceProps,
) {
  const [attempt, setAttempt] = useState(0);
  const { record, run, setRun } = useAppRecord(source, app, attempt);
  const row = record.state === "ready" ? record.row : null;
  const release = row && !row.archived ? row.release : null;
  const entry = useEntry(source, app, release);

  const frameRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const frameSize = useObservedSize(frameRef);
  const contentSize = useObservedSize(contentRef);
  const width = frameSize?.width ?? windowWidth;

  // 창마다 하나인 덮개 목록. 좁은 창의 운영 패널·대화 도크가 앱 view 자리를 덮는다.
  const covers = useMemo(createViewCovers, []);
  const conversation = useConversation();
  const [dockOpen, setDockOpen] = useState(false);
  const dock = dockPlacement(
    dockOpen && conversation !== null,
    contentSize?.width ?? width,
  );
  // 도크가 열리면 운영 패널은 자리를 내주고, 닫히면 사람이 둔 상태로 돌아간다.
  const [detailsOpen, setDetailsOpen] = useState(
    issueProblem !== undefined || taskTarget !== undefined,
  );
  const ops = opsPanelPlacement(detailsOpen && dock === "hidden", width);

  // 운영과 분리된 preview. 열려 있는 동안 본문은 그 preview이고 사람이 닫으면 앱으로 돌아온다.
  const [preview, setPreview] = useState<PreviewOpen | null>(null);
  const previewRef = useRef<PreviewOpen | null>(null);
  previewRef.current = preview;
  function changePreview(next: PreviewOpen | null): void {
    const closing = previewRef.current;
    if (closing !== null && closing.nonce !== next?.nonce) {
      void detail?.stopPreview(app, { nonce: closing.nonce });
    }
    setPreview(next);
  }
  useEffect(() => () => {
    const closing = previewRef.current;
    if (closing !== null) {
      void detail?.stopPreview(app, { nonce: closing.nonce });
    }
  }, [detail, app]);

  const [windowFailed, setWindowFailed] = useState(false);
  const [shortcut, setShortcut] = useState<ShortcutNotice | null>(null);

  const status: AppStatus | null = row ? appStatus(row, run) : null;

  // [Report a problem]이 묶일 본문 view. crash해도 view_session은 남아 버튼이 동작한다.
  const [viewSession, setViewSession] = useState<string | null>(null);

  function onViewState(state: AppFrameViewState): void {
    setRun(state.connectionState);
    setViewSession(state.view_session);
  }

  async function changeShortcut(add: boolean): Promise<void> {
    if (!windows) return;
    const reply = add
      ? await windows.addShortcut({ app })
      : await windows.removeShortcut({ app });
    if (reply.ok) setShortcut(add ? "added" : "removed");
    else {setShortcut(
        reply.code === "not_installed" ? "not-installed" : "failed",
      );}
  }

  let body;
  let embedded = false;
  if (record.state === "failed") {
    body = (
      <ErrorState
        target={t("app-space.label.this-app")}
        onRetry={() => setAttempt((count) => count + 1)}
      />
    );
  } else if (record.state === "missing") {
    body = <p className={styles.state}>{t("app-space.empty.not-found")}</p>;
  } else if (preview !== null && views !== undefined) {
    // 운영 앱이 아니라 그 Version의 preview다. 모드를 바꿔 보이고 닫는 길을 바로 둔다.
    body = (
      <>
        <p className={styles.notice} role="status" data-preview-banner="">
          {t("app-detail.label.preview-banner", {
            number: String(preview.number),
          })}{" "}
          <Button
            size="sm"
            data-preview-close=""
            onClick={() => changePreview(null)}
          >
            {t("app-detail.button.close-preview")}
          </Button>
        </p>
        <EmbeddedView
          key={preview.nonce}
          views={views}
          app={app}
          mode="preview"
          release={preview.release}
          screen={preview.screen}
          size="full"
          label={row?.name ?? t("app-space.label.this-app")}
        />
      </>
    );
    embedded = false;
  } else if (row?.archived) {
    body = <p className={styles.state}>{t("app-space.empty.archived")}</p>;
  } else if (row !== null && row.release === null) {
    body = <p className={styles.state}>{t("app-space.empty.no-version")}</p>;
  } else if (
    entry.state === "unavailable" || (row !== null && views === undefined)
  ) {
    body = (
      <p className={styles.state} data-screen-not-ready="">
        {t("app-space.empty.screen-not-ready")}
      </p>
    );
  } else if (
    row !== null && row.release !== null && entry.state === "ready" &&
    views !== undefined
  ) {
    embedded = true;
    body = (
      <EmbeddedView
        key={attempt}
        views={views}
        app={app}
        mode="live"
        release={row.release}
        screen={entry.screen}
        size="full"
        label={row.name}
        onState={onViewState}
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

  return (
    <div
      className={styles.space}
      data-space="app"
      data-app={app}
      ref={frameRef}
    >
      <div className={styles.topBar}>
        <AppBar
          name={row?.name ?? null}
          status={status}
          onLauncher={onLauncher}
          detailsOpen={detailsOpen}
          onDetails={() => setDetailsOpen(!detailsOpen)}
          onDocuments={onDocuments}
          onNewWindow={windows && row && !row.archived
            ? () => {
              setWindowFailed(false);
              void windows.openWindow({ app }).then((reply) =>
                setWindowFailed(!reply.ok)
              );
            }
            : undefined}
          report={feedback
            ? (
              <ReportButton
                feedback={feedback}
                viewSession={embedded ? viewSession : null}
              />
            )
            : null}
          decisions={
            <SpaceDecisions
              place={{ kind: "app", id: app }}
              onOpen={onThingsToConfirm}
            />
          }
          tools={conversation
            ? (
              <DockToggle
                open={dockOpen}
                onToggle={() => setDockOpen(!dockOpen)}
              />
            )
            : null}
        />
      </div>
      {windowFailed
        ? (
          <p className={styles.notice} role="status" data-window-failed="">
            {t("app-space.notice.window-failed")}
          </p>
        )
        : null}
      <ViewCoversProvider value={covers}>
        <div className={styles.content} ref={contentRef}>
          <div className={styles.view}>{body}</div>
          <OpsPanelFrame
            placement={ops}
            onClose={() => setDetailsOpen(false)}
          >
            {detail && row
              ? (
                <AppDetail
                  app={app}
                  name={row.name}
                  source={detail}
                  preview={preview}
                  onPreview={changePreview}
                  onInstructions={onInstructions}
                  initialTab={issueProblem !== undefined
                    ? "issues"
                    : taskTarget !== undefined
                    ? "tasks"
                    : undefined}
                  issues={issues
                    ? (
                      <IssuesTab
                        app={app}
                        source={withReportAgain(
                          issues,
                          feedback,
                          embedded ? viewSession : null,
                        )}
                        now={() => new Date()}
                        initialProblem={issueProblem}
                      />
                    )
                    : undefined}
                  tasks={tasks
                    ? (
                      <TasksTab
                        app={app}
                        source={tasks}
                        now={() => new Date()}
                        initialTask={taskTarget?.ticket ?? null}
                        initialCreate={taskTarget?.create ?? false}
                      />
                    )
                    : undefined}
                />
              )
              : null}
            {windows
              ? (
                <section
                  className={styles.section}
                  data-section="this-computer"
                >
                  <h3 className={styles.heading}>
                    {t("app-space.heading.this-computer")}
                  </h3>
                  <span className={styles.actions}>
                    <Button
                      size="sm"
                      data-shortcut="add"
                      disabled={row === null || row.archived}
                      onClick={() => void changeShortcut(true)}
                    >
                      {t("app-space.button.add-shortcut")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      data-shortcut="remove"
                      onClick={() => void changeShortcut(false)}
                    >
                      {t("app-space.button.remove-shortcut")}
                    </Button>
                  </span>
                  {shortcut
                    ? (
                      <p
                        className={styles.result}
                        role="status"
                        data-shortcut-result={shortcut}
                      >
                        {shortcutText(shortcut)}
                      </p>
                    )
                    : null}
                </section>
              )
              : null}
          </OpsPanelFrame>
          <DockCover dock={dock} content={contentRef} />
          <DockSlot
            placement={dock}
            workPlace={{ kind: "app", id: app }}
            onClose={() => setDockOpen(false)}
            onOpenResult={onOpenResult}
          />
        </div>
      </ViewCoversProvider>
    </div>
  );
}

// 좁은 창에서 대화 도크가 본문을 덮으면 앱 view는 덮이지 않는 영역으로 준다(R36). 도크는
// 대화 쪽 컴포넌트라 이 공간 안의 그 요소를 찾아 덮개로 둔다.
function DockCover(
  { dock, content }: {
    dock: ReturnType<typeof dockPlacement>;
    content: { readonly current: Element | null };
  },
) {
  const ref = useMemo(() => ({
    get current(): Element | null {
      return content.current?.querySelector("[data-dock='overlay']") ?? null;
    },
  }), [content]);
  useViewCover(ref, dock === "overlay");
  return null;
}
