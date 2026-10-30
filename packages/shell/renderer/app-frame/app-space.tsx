// 앱 공간(`/apps/:app`). 위쪽 바 아래 전체에 그 앱의 native view 하나를 붙이고, 옆에 오른쪽 패널 하나를 연다. 패널은
// 탭 줄이 있고 App details·Agent가 탭이다. 좁은 창에서는 패널이 본문을 덮되 앱 view는 덮이지 않는 영역으로 줄어든다.
// 다른 공간으로 가면 이 공간이 사라지며 그 view를 닫는다(EmbeddedView).
import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { Toast } from "@lophn/ui/overlay";
import { useObservedSize } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import type { LophnShellAnnotateApi } from "../../ipc/annotation.ts";
import type {
  AppFrameViewState,
  LophnShellViewsApi,
} from "../../ipc/app-frame.ts";
import type { OverlayApi } from "../../ipc/overlay.ts";
import type { AgentTabSourceFactory } from "../conversation/agent-tab-source.ts";
import { useSessions } from "../desktop/connection/events/hooks.tsx";
import { WaitingLayer } from "../desktop/connection/waiting/waiting-layer.tsx";
import { type AppStatus, appStatus } from "../apps/model.ts";
import type { AppRow, AppsSource, RunState } from "../apps/source.ts";
import type { ReadResult } from "../workspace/source.ts";
import { startPointerDrag } from "../workspace/drag.ts";
import { applyDrag } from "../workspace/model.ts";
import type { RunRecordView } from "../workspace/sidebar/run-list.tsx";
import { sessionAgentKey } from "../workspace/sidebar/panel-sessions.ts";
import type { AgentsSource } from "../workspace/agents/source.ts";
import { AppDetail } from "./app-detail/app-detail.tsx";
import type { AppDetailSource } from "./app-detail/source.ts";
import {
  type AgentPaneState,
  type PanelTab,
  SidePanel,
  sidePanelPlacement,
} from "./side-panel.tsx";
import { AgentSelect } from "./agent-select.tsx";
import { AnnotationPanel } from "./annotate/annotation-panel.tsx";
import { useAnnotate } from "./annotate/use-annotate.ts";
import { STAY, useViewToast } from "./annotate/use-view-toast.ts";
import { useAppAgents } from "./app-agents.ts";
import { useAppRuns } from "./app-runs.ts";
import { AppBar } from "./app-bar.tsx";
import {
  createViewCovers,
  EmbeddedView,
  ViewCoversProvider,
} from "./embedded-view.tsx";
import { useToastHandler } from "./toast-handler.ts";
import type { CatalogSource } from "../desktop/palette/catalog.ts";
import {
  clampPanelWidth,
  readPanelWidth,
  savePanelWidth,
} from "./panel-width.ts";
import { readAppLayout, saveAppLayout } from "./app-layout.ts";
import type { SettingsPane } from "../desktop/settings/model.ts";
import { PlaceSwitcher } from "../workspace/top-path/place-selector.tsx";
import {
  type PlaceRef,
  readRecentPlaces,
  rememberPlace,
} from "../workspace/top-path/recent-places.ts";
import { usePlaceLists } from "../workspace/top-path/use-place-lists.ts";
import {
  LOPHN_AGENT_ID,
  LOPHN_AGENT_NAME,
} from "../../../protocol/lophn-agent/mod.ts";
import styles from "./app-space.module.css";

interface AppSpaceProps {
  app: string;
  source: AppsSource;
  /** shell preload의 view 통로. 없으면 앱 화면을 열 수 없다고 보인다. */
  views?: LophnShellViewsApi;
  /** 운영 패널의 app-detail 통로. 없으면 app-detail 탭을 두지 않는다. */
  detail?: AppDetailSource;
  /**
   * 이 앱 자리의 agent 목록과 관리 통로(project Agents 탭과 같은 source). 없으면 agent select를 두지 않는다.
   */
  agents?: AgentsSource;
  /**
   * run 기록 읽기. 있으면 agent select에 Background 항목이 있고 고르면 같은 칸에 이 앱의 run 목록을 연다. 없으면 항목이 없다. 함수가 바뀌면 다시 읽으므로 부르는 쪽은 같은 함수를 넘긴다.
   */
  runs?: () => Promise<ReadResult<readonly RunRecordView[]>>;
  /** Agent 칸이 agent 하나의 통로를 얻는 함수. 없으면 칸이 "준비 안 됨"이다. */
  agentViewSource?: AgentTabSourceFactory;
  /** Settings로 간다(Agent 칸·관리 칸의 기본 model·확장 등록·연결). 없으면 그 단추는 아무것도 하지 않는다. */
  onSettings?: (pane?: SettingsPane) => void;
  /** 창 폭. 테스트가 고정하고 화면은 관측값을 쓴다. */
  windowWidth: number;
  onLauncher: () => void;
  /** Annotate 통로. 없으면 Annotate 단추를 두지 않는다. */
  annotate?: LophnShellAnnotateApi;
  /** native view 위에 알림을 띄우는 overlay. 없으면 같은 모양의 toast를 앱 화면 위쪽에 그린다. */
  overlay?: OverlayApi;
  /** 처음에 pane에 열어 둘 agent session. */
  session?: string;
  /** 이 앱 place의 lophn 새 session으로 열어 시작한다(방금 만든 앱). */
  startLophn?: boolean;
  /** 이 공간의 pane에 없는 agent session을 연다(호스트가 그 session이 있는 화면으로 간다). */
  onOpenSession?: (session: string) => void;
  /** 위쪽 바의 place switcher에 넣을 project·app 목록. 없으면 지금 앱 하나만 보인다. */
  places?: CatalogSource;
  /** place switcher에서 고른 place를 연다(호스트가 그 공간으로 간다). */
  onOpenPlace?: (place: PlaceRef) => void;
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

export function AppSpace({
  app,
  source,
  views,
  detail,
  agents,
  agentViewSource,
  runs,
  onSettings,
  windowWidth,
  onLauncher,
  annotate: annotateApi,
  overlay,
  session,
  startLophn,
  onOpenSession,
  places,
  onOpenPlace,
}: AppSpaceProps) {
  const [attempt, setAttempt] = useState(0);
  const { record, run, setRun } = useAppRecord(source, app, attempt);
  const row = record.state === "ready" ? record.row : null;
  const release = row && !row.archived ? row.release : null;
  const entry = useEntry(source, app, release);
  const placeLists = usePlaceLists(places);
  const [recentPlaces, setRecentPlaces] = useState(readRecentPlaces);

  const frameRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const frameSize = useObservedSize(frameRef);
  const contentSize = useObservedSize(contentRef);
  const width = frameSize?.width ?? windowWidth;

  // 창마다 하나인 덮개 목록. 좁은 창의 오른쪽 패널이 앱 view 자리를 덮는다.
  const covers = useMemo(createViewCovers, []);
  // 오른쪽 패널. 열린 탭(details, agent)과 고른 탭, 패널을 보이는지는 따로 쥔다. 단추로 패널을 닫아도 탭의 상태는 남는다.
  // 앱마다 마지막 모양을 기억해 다른 place에 갔다 와도 이어진다. 새 session 요청(startLophn)은 저장값보다 먼저다.
  const [saved] = useState(() => readAppLayout(app));
  const [pane, setPane] = useState<AgentPaneState | null>(
    startLophn
      ? { mode: "agent", assignment: LOPHN_AGENT_ID, session: null }
      : (saved?.pane ?? null),
  );
  const [detailsOpen, setDetailsOpen] = useState(saved?.detailsOpen ?? false);
  const [panelTab, setPanelTab] = useState<PanelTab>(
    startLophn ? "agent" : (saved?.panelTab ?? "agent"),
  );
  const [panelOpen, setPanelOpen] = useState(
    startLophn === true || (saved?.panelOpen ?? false),
  );
  useEffect(() => {
    saveAppLayout(app, {
      panelOpen,
      panelTab,
      detailsOpen,
      pane: pane?.mode === "manage" ? null : pane,
    });
  }, [app, panelOpen, panelTab, detailsOpen, pane]);
  const agentList = useAppAgents(agents, app);
  const paneShown = pane !== null && agents !== undefined;
  const runRows = useAppRuns(
    runs,
    app,
    agentList.agents,
    agentViewSource,
    paneShown && pane.mode === "runs",
  );
  const tabs: PanelTab[] = [
    ...(detailsOpen ? ["details" as const] : []),
    ...(paneShown ? ["agent" as const] : []),
  ];
  const shownTab = tabs.includes(panelTab) ? panelTab : (tabs[0] ?? null);
  const [panelWidth, setPanelWidth] = useState(readPanelWidth);
  const [panelFull, setPanelFull] = useState(false);
  const contentWidth = contentSize?.width ?? width;
  const shownWidth = clampPanelWidth(panelWidth, contentWidth);
  const placement = sidePanelPlacement(
    panelOpen && shownTab !== null,
    contentWidth,
    shownWidth,
    panelFull,
  );
  const panelVisible = placement !== "hidden";

  function showTab(next: PanelTab): void {
    setPanelTab(next);
    setPanelOpen(true);
  }

  const status: AppStatus | null = row ? appStatus(row, run) : null;

  // 본문 view의 상태. crash해도 view_session은 남아 annotate 통로가 동작한다.
  const [viewState, setViewState] = useState<AppFrameViewState | null>(null);
  const viewSession = viewState?.view_session ?? null;

  function onViewState(state: AppFrameViewState): void {
    setRun(state.connectionState);
    setViewState(state);
  }

  // ---- agent pane ----

  const sessions = useSessions().sessions;

  // 이 앱 place에서 그 agent의 가장 최근 열린 session. 고르면 빈 새 session 대신 이어 가던 대화가 열린다.
  // 새 session은 header의 session 목록에서 연다.
  const latestSession = (assignment: string): string | null =>
    sessions
      .filter(
        (item) =>
          item.ended === null &&
          item.place?.kind === "app" &&
          item.place.id === app &&
          sessionAgentKey(item) === assignment,
      )
      .at(-1)?.session ?? null;

  function openAgent(assignment: string): void {
    // 보고 있는 agent를 다시 고르면 패널을 닫는다.
    if (
      panelVisible &&
      shownTab === "agent" &&
      pane?.mode === "agent" &&
      pane.assignment === assignment
    ) {
      setPanelOpen(false);
      return;
    }
    setPane((current) =>
      current?.mode === "agent" && current.assignment === assignment
        ? current
        : { mode: "agent", assignment, session: latestSession(assignment) },
    );
    showTab("agent");
  }

  // 이 앱의 agent session이면 pane을 그 session으로 연다. session이 없으면 이 앱의 lophn 열린 session이다.
  function openSession(
    target: string | null,
    forApp: string | undefined,
  ): boolean {
    if (agents === undefined || agentViewSource === undefined) return false;
    if (target === null) {
      if (forApp !== app) return false;
      setPane({
        mode: "agent",
        assignment: LOPHN_AGENT_ID,
        session: latestSession(LOPHN_AGENT_ID),
      });
    } else {
      const entry = sessions.find((item) => item.session === target);
      const assignment = entry === undefined ? null : sessionAgentKey(entry);
      if (
        entry === undefined ||
        assignment === null ||
        entry.place?.kind !== "app" ||
        entry.place.id !== app ||
        !agentList.agents.some((item) => item.assignment === assignment)
      )
        return false;
      setPane({ mode: "agent", assignment, session: target });
    }
    showTab("agent");
    return true;
  }

  const firstSession = useRef(session);
  useEffect(() => {
    if (firstSession.current === undefined) return;
    if (openSession(firstSession.current, undefined)) {
      firstSession.current = undefined;
    }
  }, [sessions, agentList.agents]);

  useToastHandler({ app, openSession });

  // 대기 목록과 질문 카드가 session을 열 때: 이 pane에 있으면 pane에서, 아니면 호스트가 연다.
  function showSession(target: string): void {
    if (!openSession(target, undefined)) onOpenSession?.(target);
  }

  function closeTab(name: PanelTab): void {
    if (name === "details") setDetailsOpen(false);
    else if (name === "agent") setPane(null);
  }

  // ---- annotate ----

  const annotating = useAnnotate(annotateApi, viewSession);
  const toast = useViewToast(overlay);
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

  // 받는 쪽은 pane이 보이는 agent다. pane이 agent를 보이지 않으면 lophn의 새 session이다.
  // 사람이 고른 agent와 보내기 단추 글이 늘 같아야 받는 쪽을 안다.
  const receiver =
    pane?.mode === "agent"
      ? { agent: pane.assignment, session: pane.session }
      : { agent: LOPHN_AGENT_ID, session: null };
  const receiverName =
    agentList.agents.find((item) => item.assignment === receiver.agent)?.name ??
    LOPHN_AGENT_NAME;

  async function sendAnnotations(): Promise<void> {
    const sent = await annotating.send(receiver);
    if (sent === null) return;
    toastKind.current = "sent";
    toast.show({
      title: t("app-space.title.annotations-sent-to", {
        count: sent.sent,
        agent: receiverName,
      }),
      body: t("app-space.text.annotations-sent"),
    });
  }

  const annotations = annotating.state?.items ?? [];

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
  } else if (row?.archived) {
    body = <p className={styles.state}>{t("app-space.empty.archived")}</p>;
  } else if (row !== null && row.release === null) {
    body = <p className={styles.state}>{t("app-space.empty.no-version")}</p>;
  } else if (
    entry.state === "unavailable" ||
    (row !== null && views === undefined)
  ) {
    body = (
      <p className={styles.state} data-screen-not-ready="">
        {t("app-space.empty.screen-not-ready")}
      </p>
    );
  } else if (
    row !== null &&
    row.release !== null &&
    entry.state === "ready" &&
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
          placeSwitcher={
            onOpenPlace === undefined ? undefined : (
              <PlaceSwitcher
                active={{ kind: "app", id: app }}
                activeName={row?.name ?? undefined}
                projects={placeLists.projects}
                apps={placeLists.apps}
                recent={recentPlaces}
                onOpenChange={(open) => {
                  if (!open) return;
                  placeLists.read();
                  setRecentPlaces(readRecentPlaces());
                }}
                onSelect={onOpenPlace}
              />
            )
          }
          detailsOpen={panelVisible && shownTab === "details"}
          onDetails={() => {
            if (panelVisible && shownTab === "details") setPanelOpen(false);
            else {
              setDetailsOpen(true);
              showTab("details");
            }
          }}
          {...(annotateApi !== undefined && embedded && viewSession !== null
            ? {
                annotate: {
                  on: annotateOn,
                  onToggle: () => annotating.setMode(!annotateOn),
                },
              }
            : {})}
          decisions={<WaitingLayer onOpenSession={showSession} />}
          agentSelect={
            agents ? (
              <AgentSelect
                agents={agentList.agents}
                paneOpen={panelVisible && shownTab === "agent"}
                onOpenAgent={openAgent}
                {...(runs === undefined
                  ? {}
                  : {
                      onRuns: () => {
                        setPane({ mode: "runs" });
                        showTab("agent");
                      },
                    })}
                onManage={() => {
                  setPane({ mode: "manage", agent: null });
                  showTab("agent");
                }}
              />
            ) : null
          }
        />
      </div>
      <ViewCoversProvider value={covers}>
        <div className={styles.content} ref={contentRef}>
          <div className={styles.column}>
            <div className={styles.view}>
              {body}
              {toast.dom === null ? null : (
                <div className={styles.viewToast} data-view-toast="">
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
                  agent: receiverName,
                })}
                note={t("app-space.text.annotations-note-to", {
                  agent: receiverName,
                })}
              />
            ) : null}
          </div>
          <SidePanel
            tabs={tabs}
            tab={shownTab ?? "agent"}
            onTab={setPanelTab}
            onCloseTab={closeTab}
            placement={placement}
            width={shownWidth}
            full={panelFull}
            onFull={setPanelFull}
            onResizeStart={(event) => {
              const start = panelWidth;
              const startShown = shownWidth;
              let last = start;
              startPointerDrag(event, {
                // 왼쪽 경계라 왼쪽으로 끌면(dx < 0) 넓어진다.
                move: (dx) => {
                  last = clampPanelWidth(startShown - dx, contentWidth);
                  setPanelWidth(last);
                },
                finish: (outcome) => {
                  const applied = applyDrag(start, last, outcome);
                  setPanelWidth(applied);
                  if (outcome.type === "drag-end") savePanelWidth(applied);
                },
              });
            }}
            details={
              detail && row ? (
                <AppDetail
                  app={app}
                  name={row.name}
                  source={detail}
                  onOpenSession={showSession}
                />
              ) : null
            }
            state={paneShown ? pane : null}
            app={app}
            appName={row?.name ?? ""}
            {...(agents === undefined ? {} : { source: agents })}
            agents={agentList.agents}
            runs={runRows}
            {...(agentViewSource === undefined ? {} : { agentViewSource })}
            onState={setPane}
            {...(onSettings === undefined ? {} : { onSettings })}
            onChanged={agentList.reload}
          />
        </div>
      </ViewCoversProvider>
    </div>
  );
}
