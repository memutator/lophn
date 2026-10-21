// 앱 공간(`/apps/:app`). 위쪽 바 아래 전체에 그 앱의 native view 하나를 붙이고, 옆에 오른쪽 패널 하나를 연다. 패널은
// 탭 줄이 있고 App details·Agent·coding 터미널이 탭이다. 좁은 창에서는 패널이 본문을 덮되 앱 view는 덮이지 않는 영역으로 줄어든다.
// 다른 공간으로 가면 이 공간이 사라지며 그 view를 닫는다(EmbeddedView).
import { useEffect, useMemo, useRef, useState } from "react";
import { ErrorState, Loading, Skeleton } from "@lophn/ui/feedback";
import { Toast } from "@lophn/ui/overlay";
import { useObservedSize } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

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
import type { RunRecordView } from "../workspace/sidebar/run-list.tsx";
import { closeTerminalTab, type TerminalDeps } from "../terminal/deps.ts";
import { useTerminalOpenRequests } from "../terminal/use-terminal-open-requests.ts";
import { keyOf } from "../workspace/agents/agent-key.ts";
import type { AgentsSource } from "../workspace/agents/source.ts";
import { AppDetail } from "./app-detail/app-detail.tsx";
import type { AppDetailSource } from "./app-detail/source.ts";
import {
  type AgentPaneState,
  type PanelTab,
  type PaneTerminal,
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
import type { SettingsPane } from "../desktop/settings/model.ts";
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
  /** app 층 [Instructions]를 연다. 없으면 단추를 두지 않는다. */
  onInstructions?: () => void;
  /** 앱 상세 Domains 줄 menu의 Open DOMAIN.md. domain id를 준다. 없으면 그 항목은 아무것도 하지 않는다. */
  onDomainDoc?: (domain: string) => void;
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
  /** 이 공간의 pane에 없는 agent session을 연다(호스트가 그 session이 있는 화면으로 간다). */
  onOpenSession?: (session: string) => void;
  /** 터미널 탭 통로. 있어야 lophn이 연 coding 터미널을 pane에 받는다. */
  terminal?: TerminalDeps;
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

export function AppSpace(
  {
    app,
    source,
    views,
    detail,
    agents,
    agentViewSource,
    runs,
    onInstructions,
    onDomainDoc,
    onSettings,
    windowWidth,
    onLauncher,
    annotate: annotateApi,
    overlay,
    session,
    onOpenSession,
    terminal,
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

  // 창마다 하나인 덮개 목록. 좁은 창의 오른쪽 패널이 앱 view 자리를 덮는다.
  const covers = useMemo(createViewCovers, []);
  // 오른쪽 패널. 열린 탭(details, agent, terminal)과 고른 탭, 패널을 보이는지는 따로 쥔다. 단추로 패널을 닫아도 탭의 상태는 남는다.
  const [pane, setPane] = useState<AgentPaneState | null>(null);
  const [coding, setCoding] = useState<PaneTerminal | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [panelTab, setPanelTab] = useState<PanelTab>("agent");
  const [panelOpen, setPanelOpen] = useState(false);
  const [opened, setOpened] = useState(false);
  const agentList = useAppAgents(agents, app);
  const paneShown = pane !== null && agents !== undefined;
  const runRows = useAppRuns(
    runs,
    app,
    agentList.agents,
    agentViewSource,
    paneShown && pane.mode === "runs",
  );
  const terminalShown = terminal !== undefined && coding !== null &&
    agents !== undefined;
  const tabs: PanelTab[] = [
    ...(detailsOpen ? ["details" as const] : []),
    ...(paneShown ? ["agent" as const] : []),
    ...(terminalShown ? ["terminal" as const] : []),
  ];
  const shownTab = tabs.includes(panelTab) ? panelTab : tabs[0] ?? null;
  const placement = sidePanelPlacement(
    panelOpen && shownTab !== null,
    contentSize?.width ?? width,
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

  function openAgent(assignment: string): void {
    // 보고 있는 agent를 다시 고르면 패널을 닫는다.
    if (
      panelVisible && shownTab === "agent" && pane?.mode === "agent" &&
      pane.assignment === assignment
    ) {
      setPanelOpen(false);
      return;
    }
    setPane((current) =>
      current?.mode === "agent" && current.assignment === assignment
        ? current
        : { mode: "agent", assignment, session: null }
    );
    showTab("agent");
  }

  // 이 앱의 agent session이면 pane을 그 session으로 연다. session이 없으면 이 앱의 App Engineer 열린 session이다.
  function openSession(
    target: string | null,
    forApp: string | undefined,
  ): boolean {
    if (agents === undefined || agentViewSource === undefined) return false;
    if (target === null) {
      if (forApp !== app) return false;
      const latest = sessions.filter((item) =>
        item.ended === null && item.agent?.role === "app_engineer" &&
        item.agent.app === app
      ).at(-1);
      setPane({
        mode: "agent",
        assignment: "app_engineer",
        session: latest?.session ?? null,
      });
    } else {
      const agent = sessions.find((item) => item.session === target)?.agent;
      if (agent === undefined || agent === null) return false;
      if (agent.role === "lophn") {
        setPane({ mode: "agent", assignment: keyOf(agent), session: target });
      } else if (agent.role === "app_engineer" && agent.app === app) {
        setPane({ mode: "agent", assignment: keyOf(agent), session: target });
      } else if (
        agent.role === "operator" &&
        agentList.agents.some((item) => item.assignment === agent.agent)
      ) {
        setPane({ mode: "agent", assignment: keyOf(agent), session: target });
      } else return false;
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

  // core 요청으로 열린 coding 터미널. 이 앱의 것만 패널의 터미널 탭으로 두고 보던 탭에서 focus를 옮기지 않는다.
  useTerminalOpenRequests((request) => {
    if (terminal === undefined || agents === undefined) return;
    if (request.coding.app !== app) return;
    terminal.store.requestFromCore(request);
    setCoding({
      key: request.tab.key,
      title: request.tab.title,
      project: request.runtime.project,
      product: request.coding.product,
      session: request.coding.session,
    });
    setOpened(true);
    // 패널이 안 보이면 열되, 열린 탭이 없던 때만 agent를 보인다.
    if (!panelVisible || shownTab === null) {
      setPane((current) =>
        current ?? { mode: "agent", assignment: "app_engineer", session: null }
      );
      setPanelTab("agent");
    }
    setPanelOpen(true);
  }, terminal?.bridge ?? null);

  // 대기 목록 카드의 [Answer in terminal]이 이 pane의 터미널을 고르면 터미널 탭으로 바꾼다.
  useEffect(() => {
    if (terminal === undefined || coding === null) return;
    return terminal.store.onSelect((key) => {
      if (key === coding.key) showTab("terminal");
    });
  }, [terminal, coding]);

  function closeTab(name: PanelTab): void {
    if (name === "details") setDetailsOpen(false);
    else if (name === "agent") setPane(null);
    else if (terminal !== undefined && coding !== null) {
      void closeTerminalTab(terminal, coding.key).then((closed) => {
        if (!closed) return;
        setCoding(null);
        setOpened(false);
      });
    }
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

  async function sendAnnotations(): Promise<void> {
    const receiver = pane?.mode === "agent" &&
        pane.assignment === "app_engineer"
      ? pane.session
      : null;
    const sent = await annotating.send(receiver);
    if (sent === null) return;
    toastKind.current = "sent";
    toast.show({
      title: t("app-space.title.annotations-sent", { count: sent.sent }),
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
          decisions={
            <WaitingLayer
              onOpenSession={showSession}
              onAnswerInTerminal={(target) =>
                void terminal?.store.focusSession(target)}
            />
          }
          agentSelect={agents
            ? (
              <AgentSelect
                agents={agentList.agents}
                paneOpen={panelVisible && shownTab === "agent"}
                onOpenAgent={openAgent}
                {...(runs === undefined ? {} : {
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
            )
            : null}
        />
      </div>
      <ViewCoversProvider value={covers}>
        <div className={styles.content} ref={contentRef}>
          <div className={styles.column}>
            <div className={styles.view}>
              {body}
              {toast.dom === null
                ? null
                : (
                  <div className={styles.viewToast} data-view-toast="">
                    <Toast
                      title={toast.dom.title}
                      {...(toast.dom.body === undefined
                        ? {}
                        : { body: toast.dom.body })}
                      actions={toast.dom.action
                        ? [{ id: "act", label: toast.dom.action.label }]
                        : []}
                      onAction={() => toast.dom?.action?.run()}
                      onClose={toast.hide}
                      timer={STAY}
                    />
                  </div>
                )}
            </div>
            {annotateOn && annotations.length > 0
              ? (
                <AnnotationPanel
                  items={annotations}
                  sending={annotating.state?.phase === "sending"}
                  failure={annotating.failure}
                  onRemove={annotating.remove}
                  onClear={() => annotating.remove("all")}
                  onSend={() => void sendAnnotations()}
                />
              )
              : null}
          </div>
          <SidePanel
            tabs={tabs}
            tab={shownTab ?? "agent"}
            onTab={setPanelTab}
            onCloseTab={closeTab}
            placement={placement}
            details={detail && row
              ? (
                <AppDetail
                  app={app}
                  name={row.name}
                  source={detail}
                  onInstructions={onInstructions}
                  onOpenDomainDoc={onDomainDoc}
                  onOpenSession={showSession}
                />
              )
              : null}
            state={paneShown ? pane : null}
            app={app}
            appName={row?.name ?? ""}
            {...(agents === undefined ? {} : { source: agents })}
            agents={agentList.agents}
            runs={runRows}
            {...(agentViewSource === undefined ? {} : { agentViewSource })}
            {...(terminal !== undefined && coding !== null
              ? { coding: { tab: coding, deps: terminal } }
              : {})}
            opened={opened}
            onOpenedClose={() => setOpened(false)}
            onState={setPane}
            {...(onInstructions === undefined ? {} : { onInstructions })}
            {...(onSettings === undefined ? {} : { onSettings })}
            onChanged={agentList.reload}
          />
        </div>
      </ViewCoversProvider>
    </div>
  );
}
