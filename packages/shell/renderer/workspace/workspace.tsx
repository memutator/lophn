import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  Icon,
  IconButton,
  iconPixels,
  type TabItem as StripTab,
  Tooltip,
  useObservedSize,
} from "@lophn/design/components";
import { workspaceIcons } from "../icons/mod.ts";
import { t } from "@lophn/wording";

import type { FilesApi } from "../../ipc/files.ts";
import { LophnEntry, TopBar } from "../desktop/top-bar/top-bar.tsx";
import { useSessions } from "../desktop/connection/events/hooks.tsx";
import { WaitingLayer } from "../desktop/connection/waiting/waiting-layer.tsx";
import { runToastAction } from "../desktop/connection/toasts/toast-actions.ts";
import { openProjectManager } from "./reactions/project-manager.ts";
import { useToastHandler } from "./reactions/toast-handler.ts";
import { Breadcrumbs } from "./top-path/breadcrumbs.tsx";
import { LauncherButton } from "./launcher-button.tsx";
import { startPointerDrag } from "./drag.ts";
import {
  applyDrag,
  breadcrumbs,
  clampSidebar,
  closeTab,
  moveTab,
  SIDEBAR_WIDTH,
  type SidebarState,
  sidebarView,
  type TabItem,
  type WorkspaceView,
} from "./model.ts";
import { ProjectSidebar } from "./sidebar/project-sidebar.tsx";
import type { RailAction } from "./sidebar/rail.tsx";
import { ContextSidebar } from "./contexts/context-sidebar.tsx";
import {
  agentByRole,
  type KnownSessions,
  panelSessions,
  sessionDot,
} from "./sidebar/panel-sessions.ts";
import { Panes } from "./panes/panes.tsx";
import { NewTabMenu } from "./add-tab-menu.tsx";
import { FileActionDialog, type FileDialogState } from "./file-actions.tsx";
import type { FileRow, ProjectView, WorkspaceSource } from "./source.ts";
import { toStoredLayout, viewFromStored } from "./layout-map.ts";
import {
  PaletteButton,
  usePaletteEnv,
  usePaletteScope,
} from "../desktop/palette/host.tsx";
import { workspaceScope } from "../desktop/palette/workspace-scope.ts";
import type { EditorDeps } from "../editor/document-view.tsx";
import type { AgentTabSourceFactory } from "../conversation/agent-tab-source.ts";
import type { ContextChipView } from "../conversation/composer/types.ts";
import type {
  AgentsSlice,
  AgentViewSlice,
  ContextsSlice,
  TabHost,
} from "./kinds/host.ts";
import type { ContextListItem } from "./contexts/source.ts";
import { useSidebarAgents } from "./agents/sidebar-agents.ts";
import { openContext } from "./kinds/context.tsx";
import { openAgent } from "./kinds/agent.tsx";
import { openAgents } from "./kinds/agents.tsx";
import { openContexts } from "./kinds/contexts.tsx";
import { openSearchFor, openSearchShortcut } from "./kinds/search.tsx";
import { tabKindOf } from "./kinds/registry.ts";
import { openFile } from "./kinds/document-editor.tsx";
import { openTerminal as openTerminalTab } from "./kinds/terminal.tsx";
import { openAppPanel } from "./kinds/app-panel.tsx";
import type { TerminalDeps } from "../terminal/deps.ts";
import { useTerminalOpenRequests } from "../terminal/use-terminal-open-requests.ts";
import { openCodingTerminal } from "./kinds/terminal.tsx";
import { NoticeCard } from "./notice-card.tsx";
import { useConversation } from "../conversation/window-deps.tsx";
import { DraftStore } from "../conversation/drafts.ts";
import { useAppViews } from "../app-frame/app-views.tsx";
import {
  createViewCovers,
  ViewCoversProvider,
} from "../app-frame/embedded-view.tsx";
import styles from "./workspace.module.css";

export interface WorkspaceProps {
  projectId: string;
  source: WorkspaceSource;
  /** 창 폭. 테스트가 고정하고 화면은 관측값을 넘긴다. */
  windowWidth: number;
  /** 칸을 그릴 본문 폭. */
  bodyWidth: number;
  /** 런처로 돌아간다. */
  onLauncher: () => void;
  /** lophn 관리 공간으로 간다. */
  onLophn: () => void;
  /** project의 LOPHN.md 편집을 연다(Agents 탭의 Instructions [Edit]). 없으면 그 단추는 아무것도 하지 않는다. */
  onProjectInstructions?: () => void;
  /** 파일 탭의 읽기·편집 통로. 없으면 파일 탭은 자리표시다. */
  editor?: EditorDeps;
  /** 터미널 탭 통로. 없으면 터미널 열기 항목을 두지 않는다. */
  terminal?: TerminalDeps;
  /** 앱 공간으로 연다. 없으면 패널을 못 여는 앱에는 안내 글만 둔다. */
  onOpenApp?: (app: string) => void;
  /**
   * Agent 탭이 agent 하나의 통로(AgentViewSource)를 얻는 함수. 없으면
   * Agent 탭을 열지 않고 저장된 Agent 탭은 준비되지 않았다는 안내만 보인다. WorkspaceSource에 두지 않는 까닭: source.ts는 core 통로를 부르는 순수 `.ts`
   * 모듈들이 type으로 읽는데 이 type은 화면 부품(`.tsx`)의 view 값을 끌고 와 그 모듈들의 시험이 css import에서
   * 막힌다. core 구현(agent-tab-core-source.ts의 factory)은 entry(`.tsx`)가 여기에 넘긴다.
   */
  agentViewSource?: AgentTabSourceFactory;
  /** 처음 열 때 한 번 열 session(다른 project의 session toast). */
  session?: string;
  /** 처음 열 때 한 번 Project Manager를 위반(context와 검사)을 붙여 연다. */
  projectManager?: { readonly context: string; readonly check: string };
  /** 처음 열 때 한 번 열 파일. path는 디스크의 절대 경로다. */
  open?: { readonly path: string; readonly line?: number };
}

interface Loaded {
  readonly project: ProjectView | null;
  readonly files: readonly FileRow[];
  readonly failed: boolean;
}

const EMPTY_LOADED: Loaded = { project: null, files: [], failed: false };
const NO_CONTEXTS: readonly ContextListItem[] = [];

function freshView(): WorkspaceView {
  return {
    panes: [{ tabs: [], selected: null }],
    splitRatio: 0.5,
    focusedPane: 0,
  };
}

// OS 파일 선택기. 창에 통로가 없으면 Document 항목을 두지 않는다.
function filePicker(): (() => Promise<string | null>) | undefined {
  const bridge = (globalThis as {
    lophnFolders?: {
      pickFile(): Promise<{ ok: boolean; path?: string | null }>;
    };
  }).lophnFolders;
  if (!bridge || typeof bridge.pickFile !== "function") return undefined;
  return async () => {
    const reply = await bridge.pickFile();
    return reply.ok ? reply.path ?? null : null;
  };
}

// 프로젝트 작업대. sidebar·상단 경로·탭 줄·두 칸을 한 화면에 모은다.
export function Workspace(props: WorkspaceProps) {
  const {
    projectId,
    source,
    windowWidth,
    bodyWidth,
    onLauncher,
    onLophn,
    onProjectInstructions,
    terminal,
  } = props;
  // Contexts·Context·Search 탭의 통로. 없으면 그 탭과 여는 길을 두지 않는다.
  const contextsSource = source.contextsSource;
  // Agents 탭과 sidebar의 Agent 모양의 통로. 없으면 그 탭과 여는 길을 두지 않는다.
  const agentsSource = source.agentsSource;
  const sidebarAgents = useSidebarAgents(agentsSource, projectId);
  const { sessions: sessionStates } = useSessions();
  // Agent 탭의 통로. 없으면 Agent 탭을 열지 않는다.
  const agentViewSource = props.agentViewSource;
  // sidebar session 줄의 제목과 시각. session store는 싣지 않아 agent마다 대화 source의 session 목록에서 읽는다.
  const [knownSessions, setKnownSessions] = useState<KnownSessions>(
    new Map(),
  );
  const sessionIds = sessionStates.map((entry) => entry.session).join();
  useEffect(() => {
    if (agentViewSource === undefined) return;
    let live = true;
    void Promise.all(sidebarAgents.agents.map(async (row) => {
      const read = await agentViewSource({
        assignment: row.assignment,
        place: row.role === "lophn"
          ? { kind: "global", id: "" }
          : { kind: "project", id: projectId },
      }).sessions();
      return read.ok ? read.value : [];
    })).then((lists) => {
      if (!live) return;
      setKnownSessions(
        new Map(
          lists.flat().map((entry) => [entry.id, {
            title: entry.title,
            at: Date.parse(entry.activeAt) || 0,
          }]),
        ),
      );
    });
    return () => {
      live = false;
    };
  }, [agentViewSource, sidebarAgents.agents, projectId, sessionIds]);
  // 앱 패널 view가 같이 보는 목록.
  const covers = useMemo(createViewCovers, []);
  const appViews = useAppViews();
  const [loaded, setLoaded] = useState<Loaded>(EMPTY_LOADED);
  // 배치를 다 읽은 project. 시작 route는 이 project의 배치가 선 뒤에 연다.
  const [readyProject, setReadyProject] = useState<string | null>(null);
  const [view, setView] = useState<WorkspaceView>(freshView);
  const [sidebar, setSidebar] = useState<SidebarState>({
    chosenWidth: SIDEBAR_WIDTH,
    collapsedByUser: false,
  });
  const [userChoseWidth, setUserChoseWidth] = useState(false);
  // 떠 있는 안내(읽기 실패)를 닫은 상태. 상단 바의 안내 단추가 다시 연다.
  const [noticesHidden, setNoticesHidden] = useState(false);
  const hideNotices = () => setNoticesHidden(true);
  const hasNotices = loaded.failed;
  const conversation = useConversation();
  // 창에 대화 메모리가 없을 때(통로 없는 화면 시험) Agent 탭이 쓰는 입력 메모리.
  const localDrafts = useMemo(() => new DraftStore(), []);
  // 이 project의 context 목록. 여는 때(Contexts 탭, sidebar의 Context 모양, 새 탭 menu)만 읽는다.
  const [contextList, setContextList] = useState<readonly ContextListItem[]>(
    NO_CONTEXTS,
  );
  // sidebar 파일 tree의 Rename·Delete 확인. 끝나면 tree를 다시 읽으려고 sidebar를 새로 세운다.
  const [fileDialog, setFileDialog] = useState<FileDialogState>(null);
  const [treeEpoch, setTreeEpoch] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const frameSize = useObservedSize(frameRef);
  const mainSize = useObservedSize(mainRef);
  const measuredWindow = frameSize?.width ?? windowWidth;

  const readContexts = () => {
    if (contextsSource === undefined) return;
    void contextsSource.list(projectId).then((read) => {
      if (read.ok) setContextList(read.value);
    });
  };

  useEffect(() => {
    let live = true;
    const load = async () => {
      const [project, layout, files, contexts] = await Promise.all([
        source.project(projectId),
        source.readLayout(projectId),
        source.files(projectId),
        contextsSource?.list(projectId),
      ]);
      if (!live) return;
      setLoaded({
        project: project.ok ? project.value : null,
        // 파일 목록은 팔레트와 검색 결과 링크만 쓴다. 읽지 못해도 작업대는 그대로 연다.
        files: files.ok ? files.value : [],
        failed: !project.ok,
      });
      if (contexts?.ok) setContextList(contexts.value);
      if (layout.ok && layout.available) {
        const restored = viewFromStored(layout.layout);
        // 복원한 Context 탭은 읽은 뒤 스스로 이름을 얻는다.
        if (restored) setView(restored);
      }
      setReadyProject(projectId);
    };
    void load();
    return () => {
      live = false;
    };
  }, [projectId, source, contextsSource]);

  const sidebarShown = sidebarView(measuredWindow, sidebar, userChoseWidth);
  const crumbs = breadcrumbs(loaded.project?.title ?? "", view);
  const focused = view.panes[view.focusedPane];
  const contentWidth = mainSize?.width ?? bodyWidth;

  // 비동기 닫기·시작 결과는 그 사이 바뀐 배치에 적용한다.
  const latest = useRef(view);
  latest.current = view;
  // 파일 탭의 읽던 위치. scroll마다 배치 state를 바꾸지 않고 저장만 늦춘다.
  const positions = useRef<
    Record<string, { section: string; scroll_offset: number }>
  >({});
  const positionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const withPositions = (next: WorkspaceView): WorkspaceView => ({
    ...next,
    panes: next.panes.map((pane) => ({
      ...pane,
      tabs: pane.tabs.map((tab) => {
        const position = positions.current[tab.key] ?? tab.readPosition;
        return position === undefined
          ? tab
          : { ...tab, readPosition: position };
      }),
    })),
  });

  const persist = (next: WorkspaceView) => {
    void source.saveLayout(toStoredLayout({
      project: projectId,
      view: withPositions(next),
      lastSpace: "project",
    }));
  };
  const persistRef = useRef(persist);
  persistRef.current = persist;

  // 잦은 바뀜(scroll, 입력)은 저장만 늦춰 한 번에 쓴다.
  const persistLater = () => {
    if (positionTimer.current !== null) {
      clearTimeout(positionTimer.current);
    }
    positionTimer.current = setTimeout(() => {
      positionTimer.current = null;
      persistRef.current(latest.current);
    }, 200);
  };

  const notePosition = (
    key: string,
    position: { section: string; scroll_offset: number },
  ) => {
    positions.current[key] = position;
    persistLater();
  };

  useEffect(() => () => {
    if (positionTimer.current === null) return;
    clearTimeout(positionTimer.current);
    positionTimer.current = null;
    persistRef.current(latest.current);
  }, []);

  const update = (next: WorkspaceView) => {
    latest.current = next;
    setView(next);
    persist(next);
  };

  // 비동기 확인 뒤에는 그 사이 바뀐 배치에서 그 탭을 뺀다.
  const removeTab = (key: string) => {
    const current = latest.current;
    const at = current.panes.findIndex((item) =>
      item.tabs.some((candidate) => candidate.key === key)
    );
    if (at >= 0) update(closeTab(current, at, key));
  };

  // focus 칸 끝에 붙이고 고른다. 같은 key가 어느 칸에 있으면 새로 붙이지 않고 그 칸에서 고른다
  // (탭 key는 작업대 안에서 유일하다). `select: false`면 붙이기만 하고 보던 탭을 그대로 둔다.
  const openTab: TabHost["openTab"] = (tab, options) => {
    const current = latest.current;
    const holder = current.panes.findIndex((pane) =>
      pane.tabs.some((candidate) => candidate.key === tab.key)
    );
    const select = options?.select !== false;
    if (!select) {
      if (holder >= 0) return;
      const target = current.focusedPane;
      update({
        ...current,
        panes: current.panes.map((item, index) =>
          index === target
            ? {
              tabs: [...item.tabs, tab],
              selected: item.selected ?? tab.key,
            }
            : item
        ),
      });
      return;
    }
    const target = holder >= 0 ? holder : current.focusedPane;
    update({
      ...current,
      focusedPane: target,
      panes: current.panes.map((item, index) =>
        index === target
          ? {
            tabs: holder >= 0 ? item.tabs : [...item.tabs, tab],
            selected: tab.key,
          }
          : item
      ),
    });
  };

  // 그 사이 바뀐 배치의 탭 필드를 바꾼다.
  const patchTab: TabHost["patchTab"] = (key, patch, options) => {
    const current = latest.current;
    const next: WorkspaceView = {
      ...current,
      panes: current.panes.map((pane) => ({
        ...pane,
        tabs: pane.tabs.map((tab) =>
          tab.key === key
            ? { ...tab, ...(typeof patch === "function" ? patch(tab) : patch) }
            : tab
        ),
      })),
    };
    if (options?.later === true) {
      latest.current = next;
      setView(next);
      persistLater();
    } else update(next);
  };

  // 검색 결과·Overview 예시의 도메인 객체는 그 파일 탭으로 간다. 경로는 연결 폴더 기준 상대 경로이거나
  // 절대 경로다.
  const openPath = (path: string) => {
    if (path.startsWith("/")) {
      openFile(host, path);
      return;
    }
    const folders = loaded.project?.folders ?? [];
    const row = loaded.files.find((item) =>
      item.path === path || item.path.endsWith(`/${path}`)
    );
    const folder = row?.folder ??
      (folders.find((item) => item.found) ?? folders[0])?.path;
    if (folder === undefined) return;
    openFile(host, `${folder.replace(/\/+$/, "")}/${path}`);
  };

  // 팔레트 파일 행이 주는 문서 행을 파일 탭으로 연다. id가 경로면 그대로 연다.
  const openDocumentRow = (row: { id: string }) => {
    if (row.id.startsWith("/")) {
      openFile(host, row.id);
      return;
    }
    const file = loaded.files.find((item) => item.document === row.id);
    if (file === undefined) return;
    const folder = file.folder ?? loaded.project?.folders[0]?.path;
    if (folder === undefined) return;
    openFile(host, `${folder.replace(/\/+$/, "")}/${file.path}`);
  };

  // 이 project의 role로 agent를 찾아 그 Agent 탭을 연다. chips가 있으면 첫 말 전에 붙인다. agent 목록을 아직 읽지 못했으면 열지 않고 false다.
  const openRole = (
    role: "lophn" | "project_manager",
    chips?: readonly ContextChipView[],
  ): boolean => {
    const row = agentByRole(sidebarAgents.agents, role);
    if (agentViewSource === undefined || row === undefined) return false;
    openAgent(host, { agent: row.assignment, name: row.name, chips });
    return true;
  };

  // 이 project의 열린 Project Manager session 가운데 가장 최근 것.
  const openedPmSession = (): string | null => {
    const found = sessionStates.filter((entry) =>
      entry.ended === null && entry.agent?.role === "project_manager" &&
      entry.agent.project === projectId
    );
    return found.length === 0 ? null : found[found.length - 1].session;
  };

  // Violations 단추. 열린 PM session이 있으면 그 탭을 고르고 chip을 쓰던 글로 채운다(session에는 chip을 붙일 길이 없다). 없으면 chip을 붙인 새 PM 탭이다.
  const askPm = (chips: readonly ContextChipView[]) => {
    const row = agentByRole(sidebarAgents.agents, "project_manager");
    if (agentViewSource === undefined || row === undefined) return;
    const session = openedPmSession();
    if (session === null) {
      openAgent(host, { agent: row.assignment, name: row.name, chips });
      return;
    }
    const drafts = conversation?.drafts ?? localDrafts;
    if (drafts.draft(session).text === "") {
      const text = chips.map((chip) =>
        chip.violation === undefined
          ? chip.label
          : `${chip.label}: ${chip.violation.file} - ${chip.violation.rule}`
      ).join("\n");
      drafts.save(session, { text, selection: [text.length, text.length] });
    }
    openAgent(host, { agent: row.assignment, name: row.name, session });
  };

  // session 하나를 그 agent의 탭으로 연다. session이나 agent 목록을 아직 모르면 열지 않고 false다.
  const openSessionTab = (session: string): boolean => {
    const entry = panelSessions(
      sessionStates,
      sidebarAgents.agents,
      projectId,
    )
      .find((item) => item.id === session);
    const row = sidebarAgents.agents.find((item) =>
      item.assignment === entry?.agent
    );
    if (row === undefined || agentViewSource === undefined) return false;
    openAgent(host, { agent: row.assignment, name: row.name, session });
    return true;
  };

  const contexts: ContextsSlice | null = contextsSource === undefined ? null : {
    source: contextsSource,
    list: contextList,
    titleOf: (id) => contextList.find((item) => item.id === id)?.title,
    refresh: readContexts,
    openPath,
    openSearch: (state) => openSearchFor(host, state),
    askProjectManager: askPm,
  };

  const agentView: AgentViewSlice | null = agentViewSource === undefined
    ? null
    : {
      factory: agentViewSource,
      drafts: conversation?.drafts ?? localDrafts,
      ...(conversation?.now === undefined ? {} : { now: conversation.now }),
      openFile: (path) => openFile(host, path),
      profileOf: (agent) =>
        sidebarAgents.agents.find((row) => row.assignment === agent)?.profile,
      dotOf: (session) => sessionDot(sessionStates, session),
      openSettings: onLophn,
      ...(conversation?.onSettings === undefined
        ? {}
        : { openConnections: conversation.onSettings }),
    };

  const agents: AgentsSlice | null = agentsSource === undefined ? null : {
    source: agentsSource,
    changed: sidebarAgents.reload,
    editInstructions: () => onProjectInstructions?.(),
    openLophn: onLophn,
  };

  // kind 선언이 배치와 통로를 건드리는 유일한 길이다. 본문·열기·닫기 확인은 모두 kind의 선언에서 오고
  // 여기서는 kind 이름으로 가르지 않는다.
  const host: TabHost = {
    projectId,
    projectTitle: loaded.project?.title,
    props,
    appScreens: appViews?.screens !== undefined,
    view,
    openTab,
    patchTab,
    removeTab,
    document: { noteReadPosition: notePosition },
    contexts,
    agents,
    agentView,
  };

  // 이 창이 보이는 동안 toast 행동을 받는다. 처리기는 열 때의 최신 작업대를 본다.
  const hostRef = useRef(host);
  hostRef.current = host;
  const sessionsRef = useRef(sessionStates);
  sessionsRef.current = sessionStates;
  const agentsRef = useRef(sidebarAgents.agents);
  agentsRef.current = sidebarAgents.agents;
  const reactionEnv = {
    project: projectId,
    host: () => hostRef.current,
    sessions: () => sessionsRef.current,
    agents: () => agentsRef.current,
  };
  useToastHandler({
    project: projectId,
    openSession: openSessionTab,
    openProjectManager: (context, check) =>
      openProjectManager(reactionEnv, { context, check }),
  });

  // 시작 route(session·Project Manager·파일)는 이 project의 배치가 선 뒤 값마다 한 번 연다. session과 agent 목록을 아직 모르면 목록이 올 때 다시 본다.
  const started = useRef<{ session?: string; pm?: object; open?: object }>({});
  useEffect(() => {
    if (readyProject !== projectId) return;
    const { session, projectManager, open } = props;
    if (open !== undefined && started.current.open !== open) {
      started.current.open = open;
      openFile(host, open.path, { line: open.line });
    }
    if (session !== undefined && started.current.session !== session) {
      if (openSessionTab(session)) started.current.session = session;
    }
    if (
      projectManager !== undefined && started.current.pm !== projectManager &&
      openProjectManager(reactionEnv, projectManager)
    ) {
      started.current.pm = projectManager;
    }
  }, [
    readyProject,
    projectId,
    props.session,
    props.projectManager,
    props.open,
    sidebarAgents.agents,
    sessionIds,
  ]);

  // core 요청으로 열린 coding 터미널은 이 project의 것만 붙이고 보던 탭을 바꾸지 않는다.
  useTerminalOpenRequests((request) => {
    if (terminal === undefined || request.runtime.project !== projectId) return;
    openCodingTerminal(host, request);
  });
  // 대기 목록 카드가 터미널 session을 고르면 그 탭을 고른다.
  useEffect(() => {
    if (terminal === undefined) return;
    return terminal.store.onSelect((key) => {
      const at = latest.current.panes.findIndex((pane) =>
        pane.tabs.some((tab) => tab.key === key)
      );
      if (at < 0) return;
      update({
        ...latest.current,
        focusedPane: at,
        panes: latest.current.panes.map((item, index) =>
          index === at ? { ...item, selected: key } : item
        ),
      });
    });
  }, [terminal]);

  const renderTab = (tab: TabItem, active: boolean): ReactNode | null =>
    tabKindOf(tab.kind)?.render?.(tab, active, host) ?? null;

  const renderKept = (tab: TabItem, shown: boolean): ReactNode | null =>
    tabKindOf(tab.kind)?.keep?.(tab, shown, host) ?? null;

  // 탭 줄이 그리는 탭: 아이콘은 kind가 정하고(파일 종류, agent의 profile, harness vendor) 이름 뒤에 상태 점이 붙는다.
  const stripTab = (tab: TabItem): StripTab => {
    const def = tabKindOf(tab.kind);
    const icon = def === undefined ? undefined : def.iconOf?.(tab, host) ??
      <Icon icon={def.icon} pixels={iconPixels("small")} />;
    return {
      key: tab.key,
      title: tab.title,
      ...(icon === undefined ? {} : { icon }),
      dot: def?.dotOf?.(tab, host) ?? null,
    };
  };

  // 확인이 필요한 kind는 사람이 확인해야 닫는다. 취소하면 탭을 유지한다.
  const close = (pane: number, key: string) => {
    const tab = view.panes[pane]?.tabs.find((item) => item.key === key);
    const confirm = tab ? tabKindOf(tab.kind)?.beforeClose?.(tab, host) : null;
    if (!confirm) {
      update(closeTab(view, pane, key));
      return;
    }
    void confirm.then((remove) => {
      if (remove) removeTab(key);
    });
  };

  const filesApi = (): FilesApi | undefined =>
    (globalThis as { lophnFiles?: FilesApi }).lophnFiles;

  // sidebar에서 지운 파일은 열린 탭도 닫는다. 지우기 확인은 Delete 단추가 이미 받았다.
  const deleteFile = async (path: string): Promise<boolean> => {
    const reply = await filesApi()?.delete({ path });
    if (reply === undefined || !reply.ok) return false;
    removeTab(path);
    setTreeEpoch((epoch) => epoch + 1);
    return true;
  };

  // 열려 있던 파일은 저장이 남았으면 사람에게 묻고 탭을 닫은 뒤 옮기고, 옮긴 파일을 다시 연다.
  const renameFile = async (
    path: string,
    name: string,
  ): Promise<"ok" | "exists" | "failed"> => {
    const api = filesApi();
    if (api === undefined || name.includes("/")) return "failed";
    const open = latest.current.panes.flatMap((pane) => pane.tabs).find((tab) =>
      tab.key === path
    );
    if (open !== undefined) {
      const confirm = tabKindOf(open.kind)?.beforeClose?.(open, host);
      if (confirm && !(await confirm)) return "failed";
    }
    const to = `${path.slice(0, path.lastIndexOf("/") + 1)}${name}`;
    const reply = await api.rename({ from: path, to });
    if (!reply.ok) return reply.code === "conflict" ? "exists" : "failed";
    if (open !== undefined) {
      removeTab(path);
      openFile(host, to);
    }
    setTreeEpoch((epoch) => epoch + 1);
    return "ok";
  };

  // 접힌 sidebar의 바로 가기 rail. 통로가 없는 단추는 열 탭이 없어 아무것도 하지 않는다.
  const openContextsTab = () => {
    readContexts();
    openContexts(host);
  };
  const onRail = (action: RailAction) => {
    if (action === "terminal") openTerminalTab(host);
    else if (action === "agent") openRole("lophn");
    else if (action === "search") openSearchShortcut(host);
    else if (contexts === null) return;
    else if (action === "contexts") openContextsTab();
    else {
      // 저장한 보기는 context의 Search 탭에 있다. 첫 context의 Search 탭을 연다.
      const first = contextList[0];
      if (first === undefined) openContextsTab();
      else {
        openSearchFor(host, {
          context: first.id,
          search: null,
          inputs: {},
          page: 0,
          savedView: null,
        });
      }
    }
  };

  const pickFile = filePicker();

  // 창 팔레트의 작업대 행. 고르면 이 작업대 안의 대상으로만 간다.
  const palette = usePaletteEnv();
  usePaletteScope(() =>
    workspaceScope({
      view,
      files: loaded.files,
      contexts: contextList,
      terminal: terminal !== undefined,
      platform: palette.platform,
      search: palette.search
        ? (query) => palette.search!(query, { kind: "project", id: projectId })
        : undefined,
      go: (target) => {
        if (target.kind === "tab") {
          update({
            ...view,
            focusedPane: target.pane,
            panes: view.panes.map((item, index) =>
              index === target.pane ? { ...item, selected: target.key } : item
            ),
          });
        } else if (target.kind === "document") openDocumentRow(target.document);
        else if (target.kind === "context") openContext(host, target.id);
        else if (target.action === "launcher") onLauncher();
        else if (target.action === "lophn") onLophn();
        else if (target.action === "terminal") openTerminalTab(host);
      },
    })
  );

  const currentTab = focused?.tabs.find((tab) => tab.key === focused.selected);

  return (
    <ViewCoversProvider value={covers}>
      <div className={styles.workspace} data-space="project" ref={frameRef}>
        {sidebarShown.mode === "hidden" ? null : (
          <ProjectSidebar
            key={treeEpoch}
            mode={sidebarShown.mode === "collapsed" ? "collapsed" : "open"}
            width={sidebarShown.width}
            project={loaded.project}
            source={source}
            contextPanel={contextsSource === undefined ? null : (
              <ContextSidebar
                source={contextsSource}
                project={projectId}
                onLoaded={setContextList}
                onOpenContext={(item) =>
                  openContext(host, item.id, undefined, item.title)}
                onOpenSavedView={(view) =>
                  openSearchFor(host, {
                    context: view.context,
                    search: view.search,
                    inputs: view.inputs,
                    page: 0,
                    savedView: view.id,
                  })}
              />
            )}
            agents={sidebarAgents.agents}
            sessions={panelSessions(
              sessionStates,
              sidebarAgents.agents,
              projectId,
              knownSessions,
            )}
            current={currentTab?.kind === "document_editor"
              ? currentTab.key
              : null}
            onLauncher={onLauncher}
            onToggle={() =>
              setSidebar((current) => ({
                ...current,
                collapsedByUser: sidebarShown.mode !== "collapsed",
              }))}
            onOpenFile={(path) => openFile(host, path)}
            onFileAction={(action, path) => {
              if (action === "open") openFile(host, path);
              else setFileDialog({ action, path });
            }}
            onRail={onRail}
            onAgent={(agent) =>
              openAgent(host, { agent: agent.assignment, name: agent.name })}
            onSession={(session) => {
              const row = sidebarAgents.agents.find((agent) =>
                agent.assignment === session.agent
              );
              if (row !== undefined) {
                openAgent(host, {
                  agent: row.assignment,
                  name: row.name,
                  session: session.id,
                });
              }
            }}
            onManage={() => openAgents(host)}
            onResizeStart={(event) => {
              const start = sidebar.chosenWidth;
              const startShown = sidebarShown.width;
              let last = start;
              startPointerDrag(event, {
                move: (dx) => {
                  last = clampSidebar(startShown + dx);
                  setSidebar((current) => ({ ...current, chosenWidth: last }));
                },
                finish: (outcome) => {
                  const applied = applyDrag(start, last, outcome);
                  setSidebar((current) => ({
                    ...current,
                    chosenWidth: applied,
                  }));
                  if (outcome.type === "drag-end") setUserChoseWidth(true);
                },
              });
            }}
          />
        )}
        <div className={styles.main}>
          <div className={styles.topBar}>
            <TopBar
              leading={
                <span className={styles.leading}>
                  {sidebarShown.launcherInTopBar
                    ? <LauncherButton onLauncher={onLauncher} />
                    : null}
                  <Breadcrumbs crumbs={crumbs} />
                </span>
              }
              trailing={
                <span className={styles.trailing}>
                  <WaitingLayer
                    onOpenSession={(session) =>
                      runToastAction({ kind: "session", session })}
                    onAnswerInTerminal={(session) =>
                      void terminal?.store.focusSession(session)}
                  />
                  {noticesHidden && hasNotices
                    ? (
                      <Tooltip
                        content={t("project-workspace.button.show-notices")}
                      >
                        <IconButton
                          icon={workspaceIcons.notices}
                          label={t("project-workspace.button.show-notices")}
                          data-show-notices=""
                          onClick={() => setNoticesHidden(false)}
                        />
                      </Tooltip>
                    )
                    : null}
                  <PaletteButton />
                  <LophnEntry onLophn={onLophn} />
                </span>
              }
            />
          </div>
          <div className={styles.content} ref={mainRef}>
            {noticesHidden
              ? null
              : (
                <div className={styles.notices} data-notices="">
                  {loaded.failed
                    ? (
                      <NoticeCard
                        tone="error"
                        data={{ "data-load-failed": "" }}
                        text={t("project-workspace.error.load-failed")}
                        onDismiss={hideNotices}
                      />
                    )
                    : null}
                </div>
              )}
            <Panes
              view={view}
              bodyWidth={contentWidth}
              windowWidth={measuredWindow}
              onSelect={(pane, key) =>
                update({
                  ...view,
                  focusedPane: pane,
                  panes: view.panes.map((item, index) =>
                    index === pane ? { ...item, selected: key } : item
                  ),
                })}
              onClose={close}
              onFocus={(pane) => update({ ...view, focusedPane: pane })}
              onMove={(key, toPane) => update(moveTab(view, key, toPane))}
              onRatio={(ratio) => update({ ...view, splitRatio: ratio })}
              newTab={
                <NewTabMenu
                  onOpen={readContexts}
                  {...(pickFile === undefined ? {} : {
                    onDocument: () =>
                      void pickFile().then((path) => {
                        if (path !== null) openFile(host, path);
                      }),
                  })}
                  {...(terminal === undefined
                    ? {}
                    : { onTerminal: () => openTerminalTab(host) })}
                  {...(agentView === null ? {} : {
                    agents: sidebarAgents.agents.map((agent) => ({
                      id: agent.assignment,
                      name: agent.name,
                      profile: agent.profile,
                    })),
                    onAgent: (id: string) => {
                      const row = sidebarAgents.agents.find((agent) =>
                        agent.assignment === id
                      );
                      if (row !== undefined) {
                        openAgent(host, { agent: id, name: row.name });
                      }
                    },
                  })}
                  {...(contexts === null ? {} : {
                    contexts: contextList,
                    onContext: (id: string) => openContext(host, id),
                  })}
                  {...(source.searchSource === undefined ? {} : {
                    onSearch: () => openSearchShortcut(host),
                  })}
                  {...(host.appScreens
                    ? { onAppPanel: () => openAppPanel(host) }
                    : {})}
                />
              }
              stripTab={stripTab}
              renderTab={renderTab}
              renderKept={renderKept}
            />
          </div>
        </div>
        <FileActionDialog
          state={fileDialog}
          onClose={() => setFileDialog(null)}
          onDelete={deleteFile}
          onRename={renameFile}
        />
      </div>
    </ViewCoversProvider>
  );
}

export type { LayoutRead } from "./source.ts";
