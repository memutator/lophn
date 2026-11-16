import { Icon } from "@lophn/ui/primitives";
import { iconPixels, useObservedSize } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { useAppRuns } from "../app-frame/app-runs.ts";
import { lophnIdAt } from "./agents/agent-key.ts";
import type { AppDetailSource } from "../app-frame/app-detail/source.ts";
import {
  type DetachedEvent,
  type LophnDetachedApi,
  slimDetachedTab,
  type TabTransfer,
} from "../../ipc/detached.ts";
import {
  APP_PANEL,
  type Command,
  KEYBINDINGS,
} from "../../../protocol/shell/keybindings.ts";
import { AppWorkspaceProvider } from "../app-frame/app-views.tsx";
import { ViewKeepsProvider } from "../app-frame/embedded-view.tsx";
import { useWorkspaceViews } from "../app-frame/workspace-views.tsx";
import { useBookmarks } from "../browser/bookmarks.ts";
import { useBrowserApi } from "../browser/browser-api.tsx";
import {
  WebviewHostProvider,
  WebviewLayer,
} from "../app-frame/webview-host.tsx";
import type { AgentTabSourceFactory } from "../conversation/agent-tab-source.ts";
import type { AppsSource } from "../apps/source.ts";
import { runToastAction } from "../desktop/connection/toasts/toast-actions.ts";
import {
  useOpenPalette,
  usePaletteEnv,
  usePaletteScope,
} from "../desktop/palette/host.tsx";
import type { ProjectsSource } from "../desktop/workspaces/projects/source.ts";
import {
  focusTab,
  topFloat,
  workspaceScope,
} from "../desktop/palette/workspace-scope.ts";
import type { JobsSource } from "../desktop/jobs/source.ts";
import type { SettingsPane } from "../desktop/settings/model.ts";
import type { EditorDeps } from "../editor/document-view.tsx";
import { dotLabel } from "../parts/tab-state-dot/tab-state-dot.tsx";
import {
  ContentCard,
  type CardPane,
  type TabAction,
} from "../shell/content-card.tsx";
import {
  activeDesk,
  addDesk,
  allTabs,
  applyTabDrop,
  closeDetached,
  type CloseScope,
  closeFloat,
  closeTab,
  closeTargets,
  cyclePane,
  type Desk,
  deskEntries,
  deskTabs,
  detachTab,
  dirsOf,
  dockFloat,
  dropLayoutTabs,
  entryKey,
  findTab,
  floatTab,
  focusLeaf,
  groupOf,
  leavesOf,
  mapLayoutTabs,
  membersOf,
  minimizeFloat,
  MAIN_DESK,
  moveTab,
  newFloatRect,
  openDetachedTab,
  openFloatTab,
  pinFloat,
  minimizeLooseFloats,
  openTab as openTabInDesk,
  paneStackOf,
  type WorkspaceLayout,
  defaultWorkspaceLayout,
  pinTab,
  workspaceKey,
  reattachTab,
  mergeDeskIntoMain,
  removeDesk,
  renameDesk,
  restoreFloat,
  selectTab,
  setActiveDesk,
  setFloatRect,
  setRatio,
  splitPartner,
  splitTab,
  stepTab,
  swapTabs,
  tabDropState,
  type WorkspaceRef,
  type FloatRect,
  type TabItem,
  ungroup,
  ungroupTab,
  updateDesk,
  whereInDesk,
} from "../shell/desk-model.ts";
import {
  DeskCloseDialog,
  type DeskCloseSummary,
} from "../shell/desk-close-dialog.tsx";
import { DeskSwitcher } from "../shell/desk-switcher.tsx";
import {
  TabsCloseDialog,
  type TabsCloseRow,
} from "../shell/tabs-close-dialog.tsx";
import { FloatLayer } from "../shell/float-layer.tsx";
import {
  canGoGlobal,
  type GlobalFloatView,
  useGlobalFloats,
} from "../shell/global-floats/global-floats.tsx";
import { neighborLeaf, type PaneDirection } from "../shell/group-geometry.ts";
import { PanelTabs } from "../shell/panel-tabs.tsx";
import { ShellFrame, useSidebarOpen } from "../shell/shell-frame.tsx";
import { Taskbar } from "../shell/taskbar/taskbar.tsx";
import { TrayHost } from "../shell/tray/tray.tsx";
import { TabContextMenu, type TabMenuState } from "../shell/tab-menu.tsx";
import { TabDragProvider } from "../shell/tab-drag.tsx";
import {
  type StripEntry,
  type StripTab,
  TabStrip,
} from "../shell/tab-strip.tsx";
import { type TerminalDeps, terminalLive } from "../terminal/deps.ts";
import {
  openBridgeUrl,
  useBridgeOpenRequests,
} from "../terminal/use-bridge-open-requests.ts";
import { NewTabMenu } from "./add-tab-menu.tsx";
import { panelChoices, useScreensRead } from "./app-panel-tab.tsx";
import { agentOf, sessionOf } from "./agent/tab-fields.ts";
import { focusTabBody } from "./focus-tab.ts";
import {
  distinctAgentTab,
  openAgent,
  type SessionTabOpen,
} from "./kinds/agent.tsx";
import { openAgents } from "./kinds/agents.tsx";
import { openAppDetail } from "./kinds/app-detail.tsx";
import {
  newKey,
  openAppPanel,
  openPinnedAppPanel,
} from "./kinds/app-panel.tsx";
import {
  appScreenKey,
  appScreenTab,
  openAppScreen,
} from "./kinds/app-screen.tsx";
import { openInbox } from "./kinds/inbox.tsx";
import { openJobs } from "./kinds/jobs.tsx";
import { openArtifact } from "./kinds/artifact.tsx";
import { openBrowserTab } from "./kinds/browser.tsx";
import { openFile } from "./kinds/document-editor.tsx";
import type { TabHost } from "./kinds/host.ts";
import { tabKindOf } from "./kinds/registry.ts";
import { TabBoundary } from "./tab-boundary.tsx";
import { openProjectSettings } from "./kinds/project-settings.tsx";
import { openSearchShortcut } from "./kinds/search.tsx";
import {
  harnessOf,
  openTerminal as openTerminalTab,
  syncTerminalTab,
} from "./kinds/terminal.tsx";
import { openWorkflow } from "./kinds/workflow.tsx";
import { NoticeCard } from "./notice-card.tsx";
import { pinId, shownQuickOrder } from "./project-settings/quick-launch.ts";
import { clampFloatRect } from "./model.ts";
import { AppTabIcon } from "../app-frame/app-icon.tsx";
import { Favicon } from "../browser/favicon.tsx";
import { launchKey } from "../desktop/settings/quick-launch/source.ts";
import { useQuickPrefs } from "../desktop/settings/quick-launch/store.tsx";
import { openProjectLophn } from "./reactions/project-lophn.ts";
import { useToastHandler } from "./reactions/toast-handler.ts";
import { CrumbBrowse } from "./sidebar/crumb-browse.tsx";
import type { TabAwareResult } from "./sidebar/explorer.tsx";
import { agentRow } from "./sidebar/panel-sessions.ts";
import {
  type SidebarSession,
  sessionKey,
} from "../shell/left-sidebar-model.ts";
import { layoutDesks } from "../shell/left-sidebar-workspaces.ts";
import { WorkspaceLeftSidebar } from "./sidebar/workspace-left-sidebar.tsx";
import {
  type QuickHoverItem,
  type QuickLaunch,
  QuickLaunchRow,
} from "../shell/quick-launch.tsx";
import { agentChoices, codingCommand } from "../shell/agent-sections.tsx";
import {
  AgentFaceIcon,
  type AgentChoice,
} from "../parts/agent-session/agent-session.tsx";
import { codingFace } from "../parts/agent-session/coding.ts";
import { HARNESS_ADAPTERS } from "../../../protocol/coding-agent/harness-adapter.ts";
import { workspaceIcons } from "../icons/mod.ts";
import type { NewSessionStart } from "../desktop/router.ts";
import type { HarnessId } from "../../../protocol/coding-agent/harness-id.ts";
import { useSidebarWorkspaceList } from "../shell/use-left-sidebar.ts";
import {
  type InboxNames,
  InboxNamesProvider,
} from "../desktop/connection/waiting/names.ts";
import {
  SIDEBAR_KEEP_PREFIX,
  type SidebarCtx,
  type SidebarKind,
  sidebarPanelsFor,
} from "./sidebar/sidebar-panels.tsx";
import { usePanelTerminals } from "./sidebar/use-panel-terminals.ts";
import type {
  FileRow,
  ProjectView,
  ReadResult,
  WorkflowEntryView,
  WorkspaceSource,
} from "./source.ts";
import { useCommands, useWindowCommands } from "../commands/react.tsx";
import { surfaceApi, useSurfaceRequests } from "./use-surface-requests.ts";
import { useTabHostSlices } from "./use-tab-host-slices.ts";
import { useWindowMachine } from "../desktop/machines/context.tsx";
import { MachineSwitcher } from "../desktop/machines/machine-switcher.tsx";
import { OnlyHere } from "../desktop/machines/only-here.tsx";
import styles from "./workspace-window.module.css";

/** 이 창이 보일 수 있는 workspace: Home, project, 앱. */
export type WindowWorkspace = WorkspaceRef;

export interface WorkspaceWindowProps {
  /**
   * Home이면 project 폴더가 필요한 것(Explorer, 터미널, workflow, project settings)이 없고 Workspaces·Jobs panel이 오른쪽에 선다.
   * 앱이면 폴더 대신 앱 화면 탭이 있고 오른쪽에 Logs panel이 선다.
   * 창은 workspace마다 새로 mount된다(부르는 쪽이 key로 가른다).
   */
  workspace: WindowWorkspace;
  source: WorkspaceSource;
  /** 창 폭. 테스트가 고정하고 화면은 관측값을 넘긴다. */
  windowWidth: number;
  /** Home으로 간다. */
  onHome: () => void;
  /** card 위에 얹는 안내(core 연결이 끊긴 알림). */
  notice?: ReactNode;
  /** Settings로 간다. 항목을 주면 그 항목부터 연다. */
  onSettings: (pane?: SettingsPane) => void;
  /** sidebar Jobs panel, Jobs overlay, Jobs 탭의 통로. 없으면 sidebar 항목을 두지 않고 Jobs overlay는 줄이 바로 탭을 연다. */
  jobs?: JobsSource;
  /** 파일 탭의 읽기·편집 통로. 없으면 파일 탭은 자리표시다. */
  editor?: EditorDeps;
  /** 터미널 탭 통로. 없으면 터미널 열기 항목을 두지 않는다. */
  terminal?: TerminalDeps;
  /**
   * 창의 터미널. 터미널 탭이 없는 Home·앱 창의 sidebar도 다른 workspace의 coding agent 터미널을 이것으로 알고 닫는다.
   * 없으면 `terminal`이다.
   */
  windowTerminal?: TerminalDeps;
  /** detached 창 통로. 없으면 Detach 항목과 단추를 두지 않는다. */
  detached?: LophnDetachedApi;
  /** 앱 공간으로 연다. 없으면 패널을 못 여는 앱에는 안내 글만 둔다. */
  onOpenApp?: (app: string) => void;
  /** 왼쪽 sidebar의 앱 목록과 Create app의 통로. 없으면 앱 줄과 Create app이 없다. */
  apps?: AppsSource;
  /** 왼쪽 sidebar에서 project나 앱 workspace로 간다(Home은 onHome). */
  onWorkspace?: (workspace: Exclude<WorkspaceRef, { kind: "home" }>) => void;
  /** 왼쪽 sidebar의 다른 앱 줄. 그 앱 공간으로 가서 앱 화면 탭을 연다. */
  onAppScreenAt?: (app: string) => void;
  /** Create app으로 만든 앱의 앱 공간으로 간다. */
  onNewApp?: (app: string) => void;
  /** project 등록(이름·폴더)을 고치는 통로. Home의 Workspaces panel이 쓰는 것과 같다. 없으면 settings 탭의 General을 쓸 수 없다. */
  projects?: ProjectsSource;
  /**
   * Agent 탭이 agent 하나의 통로를 얻는 함수(agentViewSource). 없으면
   * Agent 탭을 열지 않고 이미 열린 Agent 탭은 준비되지 않았다는 안내만 보인다. WorkspaceSource에 두지 않는 까닭: source.ts는 core 통로를 부르는 순수 `.ts`
   * 모듈들이 type으로 읽는데 이 type은 화면 부품(`.tsx`)의 view 값을 끌고 와 그 모듈들의 시험이 css import에서
   * 막힌다. core 구현(agent-tab-core-source.ts의 factory)은 entry(`.tsx`)가 여기에 넘긴다.
   */
  agentViewSource?: AgentTabSourceFactory;
  /** 처음 열 때 한 번 열 session(다른 project의 session toast). */
  session?: string;
  /** 앱 workspace의 App details 탭을 여는 통로. 없으면 workspace 설정 줄이 없다. */
  appDetail?: AppDetailSource;
  /** 처음 열 때 한 번 이 workspace의 lophn을 연다. 앱 workspace는 앱 화면과 붙인 split으로 연다. */
  startLophn?: true;
  /** 처음 열 때 한 번 새 session을 연다(다른 workspace 줄의 +나 그 hover 목록으로 왔다). */
  startSession?: NewSessionStart;
  /** 처음 열 때 한 번 이 workspace의 설정 탭을 연다(다른 workspace 줄의 설정 단추로 왔다). */
  startSettings?: true;
  /** 처음 열 때 한 번 앱 화면 탭을 연다(다른 앱 줄로 왔다). */
  startAppScreen?: true;
  /** 왼쪽 sidebar 다른 workspace 줄의 +와 hover 목록. 그 workspace로 가서 새 session을 연다. */
  onNewSessionAt?: (workspace: WorkspaceRef, start: NewSessionStart) => void;
  /** 왼쪽 sidebar 다른 workspace 줄의 설정 단추. 그 workspace로 가서 설정 탭을 연다. */
  onSettingsAt?: (workspace: WorkspaceRef) => void;
  /** 처음 열 때 한 번 고를 터미널의 terminal_ref(다른 project의 터미널 알림). */
  revealTerminal?: string;
  /** 처음 열 때 한 번 열 파일. path는 디스크의 절대 경로다. */
  open?: { readonly path: string; readonly line?: number };
}

interface Loaded {
  readonly project: ProjectView | null;
  readonly files: readonly FileRow[];
  readonly failed: boolean;
}

const EMPTY_LOADED: Loaded = { project: null, files: [], failed: false };
const CLOSED_TABS_MAX = 10;
// 작업대가 주인인 command id. 단축키 표에 있는 것 중 context가 있는 줄(agent·terminal·browser)과
// 팔레트가 여는 줄은 다른 화면이 올린다. app.panel은 표에 줄이 없어 따로 올린다.
const WORKSPACE_COMMANDS: readonly Command[] = [
  ...new Set(
    KEYBINDINGS.filter(
      (binding) =>
        binding.context === undefined &&
        binding.command !== "palette.open" &&
        binding.command !== "home.open",
    ).map((binding) => binding.command as Command),
  ),
];

// context menu와 같은 일인 command. 새 길을 만들지 않고 runTabAction을 부른다.
const TAB_ACTIONS = {
  "tab.rename": "rename",
  "tab.close-others": "close-others",
  "tab.close-right": "close-right",
  "tab.close-saved": "close-saved",
  "tab.close-all": "close-all",
  "tab.keep-open": "keep-open",
  "tab.copy-path": "copy-path",
  "tab.copy-relative-path": "copy-relative-path",
  "tab.reveal": "reveal",
  "tab.float": "float",
  "tab.detach": "detach",
  "pane.unstack": "unstack",
  "pane.remove": "split-remove",
  "pane.unsplit": "unsplit",
  "pane.close-others": "close-pane-others",
  "pane.close-group": "close-group",
} as const satisfies Partial<Record<Command, TabAction>>;

// OS 파일 선택기. 창에 통로가 없으면 Document 항목을 두지 않는다.
function filePicker(): (() => Promise<string | null>) | undefined {
  const bridge = (
    globalThis as {
      lophnFolders?: {
        pickFile(): Promise<{ ok: boolean; path?: string | null }>;
      };
    }
  ).lophnFolders;
  if (!bridge || typeof bridge.pickFile !== "function") return undefined;
  return async () => {
    const reply = await bridge.pickFile();
    return reply.ok ? (reply.path ?? null) : null;
  };
}

// 창 폭이 이보다 좁으면 sidebar를 접은 채 시작한다.
const LEFT_OPEN_MIN = 640;
const RIGHT_OPEN_MIN = 1024;
// 이동 기록의 상한.
const TRAIL_MAX = 50;

interface Stop {
  readonly desk: string;
  readonly key: string | null;
  /** 칸의 focus tab key(group이 아니면 칸의 tab). */
  readonly focus: string | null;
}

const sameStop = (a: Stop, b: Stop) =>
  a.desk === b.desk && a.key === b.key && a.focus === b.focus;

// workspace(Home, project, 앱) 창. 새 shell 틀(title bar의 desk 단추·tab 줄, 가운데 card, float 층, 양쪽 sidebar)에 desk 하나를 그린다.
// Home과 앱은 project가 없어(projectId null) 폴더가 필요한 부분을 건너뛴다.
export function WorkspaceWindow(props: WorkspaceWindowProps) {
  const { workspace, source, windowWidth, onHome, onSettings, terminal } =
    props;
  const windowTerminal = props.windowTerminal ?? terminal;
  const projectId = workspace.kind === "project" ? workspace.id : null;
  const appId = workspace.kind === "app" ? workspace.id : null;
  const isHome = workspace.kind === "home";
  const isApp = appId !== null;
  const workspaceId = workspaceKey(workspace);
  const browserApi = useBrowserApi();
  const surface = surfaceApi();
  // 다른 기계의 창이면 그 기계. 이 컴퓨터의 shell host가 필요하거나 기기가 부를 수 없는 것(앱 화면, Agents, 설정)은 감추고
  // 그런 탭 자리에는 "This opens only on <이름>"이 선다.
  const machine = useWindowMachine();
  // 창의 view 보관이 있으면 화면 그릇이 이 창보다 오래 산다: 떠나도 살려 둘 page가 다시 load되지 않는다.
  const workspaceViews = useWorkspaceViews();
  const pool = useMemo(
    () => workspaceViews?.views.acquire(workspaceId) ?? null,
    [workspaceViews, workspaceId],
  );
  const bookmarkList = useBookmarks();
  // Agent 탭의 통로. 없으면 Agent 탭을 열지 않는다.
  const agentViewSource = props.agentViewSource;
  const [loaded, setLoaded] = useState<Loaded>(EMPTY_LOADED);
  // Explorer가 보이는 연결 폴더. 화면 상태일 뿐이라 저장하지 않는다. 터미널도 이 폴더에서 열린다.
  const [explorerRoot, setExplorerRoot] = useState<string | undefined>();
  const {
    sidebarAgents,
    sessionStates,
    sessionTitles,
    agentView,
    agents,
    agentTabs,
    appViews,
    keeps,
    webviews,
  } = useTabHostSlices({
    workspace,
    source,
    agentViewSource,
    terminalStore: terminal?.store,
    host: () => host,
    onSettings,
    pool,
  });
  const sessionIds = sessionStates.map((entry) => entry.session).join();
  // 배치를 다 읽은 workspace. 시작 route는 이 workspace의 배치가 선 뒤에 연다.
  const [readyWorkspace, setReadyWorkspace] = useState<string | null>(null);
  // desk 단추의 workflow 목록. null은 아직 안 읽었거나 읽는 중이다. 실패와 읽는 중에는 합치지 않는다.
  const [workflowList, setWorkflowList] = useState<ReadResult<
    readonly WorkflowEntryView[]
  > | null>(null);
  // desk마다 tab 줄·split·float·detached가 하나씩 있다. 화면이 그리고 고치는 것은 보이는 desk뿐이다.
  const [layout, setLayout] = useState<WorkspaceLayout>(defaultWorkspaceLayout);
  const desk = activeDesk(layout);
  // 빠른 실행의 App hover 목록과 고정 앱 panel은 설치된 앱 목록과 맞춰 그린다.
  const panelApps = useScreensRead(appViews?.screens !== undefined).read;
  const { prefs: quickPrefs, set: setQuickPrefs } = useQuickPrefs();
  // 모든 workspace에 사는 전역 float. 앱 panel 화면을 desk float과 서로 옮기고, QuickLaunch가 있는 것을 펼친다.
  const globalFloats = useGlobalFloats();
  // 이 workspace에서 나온 터미널 중 전역 float이 된 것의 key. 문자열로 접어 float이 움직여도 다시 돌지 않게 한다.
  const globalTerminalList = globalFloats.floats
    .filter(
      (item) =>
        item.tab.kind === "terminal" &&
        workspaceKey(item.workspace) === workspaceId,
    )
    .map((item) => item.key)
    .join("\n");
  const globalTerminals = useMemo(
    () => (globalTerminalList === "" ? [] : globalTerminalList.split("\n")),
    [globalTerminalList],
  );
  // 앱 panel 화면 탭의 여는 자리와 마지막 float 자리. 앱을 아직 고르지 않은 탭과 다른 kind는 없다.
  const launchOf = (tab: TabItem | undefined) =>
    tab?.kind === "app_panel" &&
    tab.app !== undefined &&
    tab.screen !== undefined
      ? quickPrefs.launch[launchKey(tab.app, tab.screen)]
      : undefined;
  // 사람이 앱 panel float을 옮기거나 크기를 바꾸면 그 화면의 다음 float 자리로 기억한다. 여는 자리(dock·float)는 그대로다.
  const rememberFloatRect = (key: string, rect: FloatRect) => {
    const tab = activeDesk(latestLayout.current).floats.find(
      (item) => item.tab.key === key,
    )?.tab;
    if (
      tab?.kind !== "app_panel" ||
      tab.app === undefined ||
      tab.screen === undefined
    ) {
      return;
    }
    const id = launchKey(tab.app, tab.screen);
    setQuickPrefs("launch", {
      ...quickPrefs.launch,
      [id]: { open: quickPrefs.launch[id]?.open ?? "dock", rect },
    });
  };
  const [leftOpen, setLeftOpen] = useSidebarOpen(
    "left",
    windowWidth >= LEFT_OPEN_MIN,
  );
  const [rightOpen, setRightOpen] = useSidebarOpen(
    "right",
    windowWidth >= RIGHT_OPEN_MIN,
    workspaceId,
  );
  // 고른 panel의 key. 목록에 없으면(앱이 지워졌거나 다른 workspace 종류) 목록의 첫 panel이다.
  const [panel, setPanel] = useState<string>("");
  // 떠 있는 안내(읽기 실패)를 닫은 상태.
  const [noticesHidden, setNoticesHidden] = useState(false);
  const hideNotices = () => setNoticesHidden(true);
  const deskCount = useRef(0);
  // float 층(창 몸통 전체)의 크기. 패널 rect의 기준이다. 0이면 못 잰 것과 같다(0x0으로 가둔 rect는 저장이 거절된다).
  const floatRef = useRef<HTMLDivElement>(null);
  const floatSize = useObservedSize(floatRef);
  const stageSize =
    floatSize !== undefined && floatSize.width > 0 && floatSize.height > 0
      ? floatSize
      : undefined;

  // 앱 workspace의 이름. 앱 화면 탭 제목과 crumb이 쓴다.
  const [appName, setAppName] = useState<string | undefined>();
  useEffect(() => {
    if (appId === null || props.apps === undefined) return;
    let live = true;
    void props.apps.get(appId).then((read) => {
      if (live && read.ok && read.value !== null) setAppName(read.value.name);
    });
    return () => {
      live = false;
    };
  }, [appId, props.apps]);
  // 앱 workspace를 처음 열면(저장된 layout이 없으면) Main desk에 앱 화면 탭이 고른 채 있다. 다른 기계의 창은 앱 화면이 없다.
  const freshLayout = (): WorkspaceLayout => {
    const base = defaultWorkspaceLayout();
    return appId === null || machine !== null
      ? base
      : updateDesk(base, base.active, (item) =>
          openTabInDesk(item, appScreenTab(appId, "")),
        );
  };

  useEffect(() => {
    let live = true;
    // project와 파일 목록은 배치를 기다리게 하지 않는다. 파일 목록은 큰 project에서 느리고 팔레트만 쓴다.
    if (projectId !== null) {
      void source.project(projectId).then((project) => {
        if (!live) return;
        setLoaded((now) => ({
          ...now,
          project: project.ok ? project.value : null,
          failed: !project.ok,
        }));
      });
      void source.files(projectId).then((files) => {
        // 읽지 못해도 작업대는 그대로 연다.
        if (live && files.ok) {
          setLoaded((now) => ({ ...now, files: files.value }));
        }
      });
    }
    const load = async () => {
      const read = await source.layout.readWorkspaceLayout(workspace);
      if (!live) return;
      // 이 창의 터미널 store가 모르는 터미널 탭은 살아 있는 PTY가 없다(lophn을 다시 켰다). 되살리면 새 shell을 띄우므로 뺀다.
      // workspace를 오가는 동안은 store가 PTY를 들고 있어 남는다.
      const terminals = props.terminal?.store;
      const restored = dropLayoutTabs(
        read.ok && read.layout !== null ? read.layout : freshLayout(),
        (tab) =>
          tab.kind === "terminal" && terminals?.get(tab.key) === undefined,
      );
      latestLayout.current = restored;
      setLayout(restored);
      // 보이는 desk의 detached 창만 연다. 다른 desk의 것은 그 desk로 갈 때 syncDetached가 연다.
      // 거절은 무시한다. conflict는 이미 떠 있는 것이고 나머지는 탭이 layout의 detached로 남는다.
      // transfer가 없어 terminal은 PTY에 다시 붙지 못한다(재시작과 같다).
      for (const item of activeDesk(restored).detached) {
        void props.detached
          ?.open({
            project: workspaceId,
            tab: item.tab,
            transfer: null,
            bounds: item.bounds,
          })
          .catch(() => {});
      }
      setReadyWorkspace(workspaceId);
    };
    void load();
    return () => {
      live = false;
    };
  }, [workspaceId, source]);

  // 이름이나 폴더를 project settings에서 저장하면 crumb과 sidebar가 새 값을 보이게 다시 읽는다.
  const reloadProject = () => {
    if (projectId === null) return;
    void source.project(projectId).then((read) => {
      if (read.ok) setLoaded((now) => ({ ...now, project: read.value }));
    });
  };

  // 비동기 닫기·시작 결과는 그 사이 바뀐 배치에 적용한다.
  const latestLayout = useRef(layout);
  latestLayout.current = layout;
  const latestDesk = () => activeDesk(latestLayout.current);
  // 저장 안 된 변경이 있는 탭: 파일 탭의 편집 session과 Agents 탭의 agent 설정 편집. 탭 줄과 preview 탭 보호가 같은 것을 본다.
  const editorSessions = props.editor?.sessions;
  const isUnsaved = (key: string) =>
    (editorSessions?.isUnsettled(key) ?? false) || agentTabs.isDirty(key);
  const [, redrawUnsaved] = useReducer((count: number) => count + 1, 0);
  // 파일 탭의 읽던 위치. scroll마다 배치 state를 바꾸지 않고 저장만 늦춘다.
  const positions = useRef<
    Record<string, { section: string; scroll_offset: number }>
  >({});
  const positionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const withPosition = (tab: TabItem): TabItem => {
    const position = positions.current[tab.key] ?? tab.readPosition;
    return position === undefined ? tab : { ...tab, readPosition: position };
  };

  const persist = (next: WorkspaceLayout) => {
    void source.layout.saveWorkspaceLayout(
      workspace,
      mapLayoutTabs(next, withPosition),
    );
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
      persistRef.current(latestLayout.current);
    }, 200);
  };

  const notePosition = (
    key: string,
    position: { section: string; scroll_offset: number },
  ) => {
    positions.current[key] = position;
    persistLater();
  };

  useEffect(
    () => () => {
      if (positionTimer.current === null) return;
      clearTimeout(positionTimer.current);
      positionTimer.current = null;
      persistRef.current(latestLayout.current);
    },
    [],
  );

  // layout에서 사라진 탭의 view를 닫는다. 탭을 닫는 길이 여럿이라 길마다 닫지 않고 차이로 본다.
  // <webview>는 모든 desk의 탭이 사는 동안(보이지 않는 desk 포함) 그대로 두어 desk를 오가도 page가
  // 다시 load되지 않는다. 놓는 것은 탭 key가 layout에서 사라졌을 때뿐이다.
  // layout을 읽기 전에 떠나도 가져온 화면(agent page 포함)을 놓지 않도록 가져온 key로 시작한다.
  const webviewTabKeys = useRef<Set<string>>(new Set(pool?.carried() ?? []));
  // 앞서 떠나며 살려 둔 화면(workspace-views.tsx)은 layout을 읽은 뒤 지금 탭과 맞춘다.
  const carriedKeys = useRef<readonly string[]>(pool?.carried() ?? []);
  // 다른 창으로 넘긴 view(main이 소유를 옮긴 browser popup native view)는 여기서 닫지 않는다.
  const transferredViews = useRef<Set<string>>(new Set());
  useEffect(() => {
    // 배치를 읽기 전의 기본 layout으로 가져온 화면과 view를 놓지 않는다.
    if (readyWorkspace !== workspaceId) return;
    const desks = Object.values(layout.desks);
    const detached = new Set(
      desks.flatMap((item) => item.detached.map((entry) => entry.tab.key)),
    );
    // 다른 desk의 탭도 layout에 있는 동안은 산다. desk를 건너가도 app panel의 view가 이어진다.
    // detached 탭의 <webview>는 그 창이 갖는다. 여기 남기면 page가 두 창에 산다. 앱·artifact view는
    // 넘어가지 않으므로(받는 창이 다시 연다) detached가 되면 보내는 창이 닫는다.
    const allKeys = new Set(allTabs(layout).map((tab) => tab.key));
    for (const key of keeps.keys()) {
      const session = keeps.lookup<{ view_session: string }>(key)?.session;
      if (
        (!allKeys.has(key) && !key.startsWith(SIDEBAR_KEEP_PREFIX)) ||
        (detached.has(key) &&
          (session === undefined || !transferredViews.current.has(session)))
      ) {
        keeps.release(key);
      }
    }
    const live = new Set([...allKeys].filter((key) => !detached.has(key)));
    // 가져온 화면도 이전 key로 본다. 떠난 사이 탭이 지워졌으면 여기서 놓인다.
    const previous = new Set([
      ...webviewTabKeys.current,
      ...carriedKeys.current,
    ]);
    carriedKeys.current = [];
    for (const key of webviews.keys()) {
      // 앱 view_session처럼 탭 key가 아닌 자리(card·앱 공간)는 그 화면이 닫을 때 놓는다.
      if (previous.has(key) && !live.has(key)) webviews.release(key);
    }
    webviewTabKeys.current = live;
    const terminals = new Set(
      desks
        .flatMap((item) => [
          ...item.tabs,
          ...item.floats.map((float) => float.tab),
        ])
        .filter((tab) => tab.kind === "terminal")
        .map((tab) => tab.key),
    );
    props.terminal?.displays.retain(
      workspaceId,
      new Set([...terminals, ...globalTerminals]),
    );
  }, [
    layout,
    keeps,
    webviews,
    props.terminal,
    workspaceId,
    readyWorkspace,
    globalTerminals,
  ]);
  // 전역 float이 된 터미널의 화면은 이 workspace를 떠나도 전역 층이 그리고 있어 놓지 않는다.
  const globalTerminalsRef = useRef(globalTerminals);
  globalTerminalsRef.current = globalTerminals;
  useEffect(
    () => () =>
      props.terminal?.displays.retain(
        workspaceId,
        new Set(globalTerminalsRef.current),
      ),
    [props.terminal, workspaceId],
  );
  // 떠나면 남은 것을 모두 닫는다. 자식의 cleanup이 부모 뒤에 보관하므로 한 틱 미룬다.
  useEffect(
    () => () => {
      if (pool !== null) {
        // 살려 둘 화면만 두고 나머지를 닫는다. 그릇이 창 것이라 놓지 않은 화면은 숨은 채 남는다.
        pool.leave(() => webviewTabKeys.current);
        return;
      }
      queueMicrotask(() => {
        for (const key of keeps.keys()) keeps.release(key);
      });
    },
    [keeps, pool],
  );

  // detached 창을 보이는 desk에 맞춘다. 창이 없는 key(다른 desk에 있다가 지금 보이게 된 것)는 연다.
  const syncDetached = (next: WorkspaceLayout) => {
    const api = props.detached;
    if (api === undefined) return;
    const items = activeDesk(next).detached;
    void api
      .showOnly({ keys: items.map((item) => item.tab.key) })
      .then(({ missing }) => {
        for (const key of missing) {
          const item = items.find((candidate) => candidate.tab.key === key);
          if (item === undefined) continue;
          // 거절은 무시한다. 복원과 같다.
          void api
            .open({
              project: workspaceId,
              tab: slimDetachedTab(item.tab),
              transfer: null,
              bounds: item.bounds,
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
  };

  // layout state를 바꾸는 유일한 길이다. latestLayout도 같이 맞춘다.
  const commit = (next: WorkspaceLayout, save = true, sync = false) => {
    if (next === latestLayout.current) return;
    const switched = next.active !== latestLayout.current.active;
    latestLayout.current = next;
    setLayout(next);
    if (save) persist(next);
    if (switched || sync) syncDetached(next);
  };
  // 보이는 desk를 바꾼다.
  const update = (change: (desk: Desk) => Desk) =>
    commit(
      updateDesk(latestLayout.current, latestLayout.current.active, change),
    );
  // 보이는 desk가 아닐 수 있는 desk를 바꾼다.
  const updateAt = (at: string, change: (desk: Desk) => Desk) =>
    commit(updateDesk(latestLayout.current, at, change));
  const updateRef = useRef(update);
  updateRef.current = update;

  // agent 탭의 이름은 session 제목이 정본이다. 그려진 탭만 이름을 채우면 고르지 않은 탭이 agent 이름으로 남으므로, 모든
  // agent 탭의 이름을 창이 아는 session 제목으로 여기서 맞춘다. 제목을 아직 모르면(첫 말 전, 읽기 전) 빈 이름만 agent
  // 이름으로 채우고, 이미 있는 이름은 건드리지 않는다.
  useEffect(() => {
    const nameOf = (tab: TabItem) => {
      if (tab.kind === "agent") {
        const session = sessionOf(tab);
        const title =
          session === null
            ? undefined
            : sessionTitles.known.get(session)?.title;
        if (title) return title === tab.title ? undefined : title;
        return tab.title === ""
          ? sidebarAgents.agents.find((row) => row.assignment === agentOf(tab))
              ?.name
          : undefined;
      }
      return tab.kind === "app_screen" && tab.title === ""
        ? appName
        : undefined;
    };
    if (!allTabs(layout).some((tab) => nameOf(tab) !== undefined)) return;
    commit(
      mapLayoutTabs(latestLayout.current, (tab) => {
        const name = nameOf(tab);
        return name === undefined ? tab : { ...tab, title: name };
      }),
      false,
    );
  }, [layout, sidebarAgents.agents, appName, sessionTitles.known]);

  // desk를 바꾼다. 저장과 detached 창 맞추기는 commit이 한다.
  const switchDesk = (key: string) =>
    commit(setActiveDesk(latestLayout.current, key));

  // 사라진 workflow의 desk들을 Main으로 합친다(사람이 끝낸 것이 아니라 일이 끝난 것). 합치며 tab이 된 detached 탭의 창은 닫는다.
  const mergeDesks = (gone: readonly Desk[]) => {
    if (gone.length === 0) return;
    const current = latestLayout.current;
    const next = gone.reduce(
      (all, item) => mergeDeskIntoMain(all, item.key),
      current,
    );
    const detachedKeys = (from: WorkspaceLayout) =>
      new Set(
        Object.values(from.desks).flatMap((item) =>
          item.detached.map((entry) => entry.tab.key),
        ),
      );
    const still = detachedKeys(next);
    for (const key of detachedKeys(current)) {
      if (!still.has(key)) void props.detached?.close({ key }).catch(() => {});
    }
    commit(next, true, true);
  };
  // 사라진 workflow의 desk를 Main으로 합친다.
  const mergeVanished = (liveNames: readonly string[]) =>
    mergeDesks(
      Object.values(latestLayout.current.desks).filter(
        (item) =>
          item.workflow !== undefined && !liveNames.includes(item.workflow),
      ),
    );

  // desk 단추의 workflow 목록을 읽는다. project를 연 직후와 desk 단추를 열 때 부른다. 사라진 desk는 읽기에
  // 성공한 목록으로만 합친다(실패나 읽는 중에 합치면 desk의 탭이 모두 Main으로 옮겨진다).
  const shownProject = useRef(projectId);
  shownProject.current = projectId;
  const readWorkflows = () => {
    const mine = projectId;
    if (mine === null) return;
    void source.workflows(mine).then((result) => {
      if (shownProject.current !== mine) return;
      setWorkflowList(result);
      if (result.ok) mergeVanished(result.value.map((entry) => entry.name));
    });
  };
  useEffect(() => {
    setWorkflowList(null);
    if (readyWorkspace === workspaceId) readWorkflows();
  }, [workspaceId, source, readyWorkspace]);

  // 파일을 고치면(저장 상태가 바뀌면) 그 preview 탭을 고정한다. 저장 안 된 탭이 preview로 사라지지 않게
  // 하는 첫 번째 장치이고, 두 번째는 openTab이 저장 안 된 preview 탭을 바꿔 쓰지 않는 것이다.
  useEffect(() => {
    if (editorSessions === undefined) return;
    return editorSessions.onUnsettledChange(() => {
      redrawUnsaved();
      const current = latestDesk();
      let next = current;
      for (const tab of current.tabs) {
        if (tab.preview && editorSessions.isUnsettled(tab.key)) {
          next = pinTab(next, tab.key);
        }
      }
      if (next !== current) updateRef.current(() => next);
    });
  }, [editorSessions]);

  // 비동기 확인 뒤에는 그 사이 바뀐 배치에서 그 탭을 뺀다.
  const removeTab = (key: string) => {
    const found = findTab(latestLayout.current, key);
    if (found === null) return;
    if (found.where === "detached") {
      void props.detached?.close({ key }).catch(() => {});
      updateAt(found.desk, (item) => closeDetached(item, key));
    } else if (found.where === "float") {
      updateAt(found.desk, (item) => closeFloat(item, key));
    } else updateAt(found.desk, (item) => closeTab(item, key));
  };

  // 탭을 desk 끝에 붙이고 고른다. 같은 key가 어느 desk에 있으면 새로 붙이지 않고 그 desk로 건너가 고른다
  // (탭 key는 작업대 안에서 유일하다). preview 탭은 그 desk의 preview 자리를 바꿔 쓴다.
  // `select: false`면 붙이기만 하고 보던 탭을 그대로 둔다.
  const openTab: TabHost["openTab"] = (tab, options) => {
    const all = latestLayout.current;
    const found = findTab(all, tab.key);
    const select = options?.select !== false;
    if (!select) {
      if (found !== null) return;
      const open = (item: Desk) =>
        openTabInDesk(item, tab, {
          select: false,
          after: options?.after,
          beside: options?.beside,
          relation: options?.relation,
          unsaved: isUnsaved,
        });
      // source가 다른 desk에 있어도 보는 desk를 바꾸지 않고 그 desk에 붙인다.
      const at =
        options?.after === undefined
          ? undefined
          : findTab(all, options.after)?.desk;
      const named =
        options?.desk !== undefined && Object.hasOwn(all.desks, options.desk)
          ? options.desk
          : undefined;
      if (at !== undefined) updateAt(at, open);
      else if (named !== undefined) updateAt(named, open);
      else update(open);
      return;
    }
    // 사는 desk가 있는 탭(workflow)은 그 desk로 건너가서 연다(없는 desk는 만든다). 이미 어느 desk에 열려 있으면 그 desk가 먼저다.
    const home = tabKindOf(tab.kind)?.homeDesk?.(tab);
    const target =
      found?.desk ??
      home ??
      (options?.after === undefined
        ? undefined
        : findTab(all, options.after)?.desk) ??
      all.active;
    const base =
      home !== undefined && found === null && !Object.hasOwn(all.desks, home)
        ? addDesk(all, home, home, home)
        : all;
    // detached 탭은 그 창을 앞으로 가져올 뿐 붙이지 않는다. 다른 desk의 것이면 그 desk로 건너간다.
    if (found?.where === "detached") {
      commit(setActiveDesk(base, target));
      void props.detached?.focus({ key: tab.key }).catch(() => {});
      return;
    }
    commit(
      updateDesk(setActiveDesk(base, target), target, (item) =>
        openTabInDesk(item, tab, {
          after: options?.after,
          beside: options?.beside,
          relation: options?.relation,
          unsaved: isUnsaved,
        }),
      ),
    );
  };

  // popup 같은 탭을 floated로 연다. float 층을 못 쟀으면 tabs에 붙인다.
  const openFloatInStage: TabHost["openFloat"] = (tab, at, options) => {
    if (stageSize === undefined) {
      openTab(tab, options);
      return;
    }
    const rect =
      at !== undefined && "x" in at
        ? clampFloatRect(at, stageSize)
        : newFloatRect(stageSize, at);
    update((item) =>
      openFloatTab(item, tab, rect, options?.minimized === true),
    );
  };

  // 그 사이 바뀐 배치의 탭 필드를 바꾼다.
  const patchTab: TabHost["patchTab"] = (key, patch, options) => {
    const next = mapLayoutTabs(latestLayout.current, (tab) =>
      tab.key === key
        ? { ...tab, ...(typeof patch === "function" ? patch(tab) : patch) }
        : tab,
    );
    if (options?.later === true) {
      commit(next, false);
      persistLater();
    } else commit(next);
  };
  const patchTabRef = useRef(patchTab);
  patchTabRef.current = patchTab;

  // 접힌 float·다른 desk의 browser 탭은 BrowserTab이 mount되지 않아 state를 못 받고, main은 favicon을
  // 바뀔 때만 민다. 그 사이 온 favicon을 놓치면 아이콘이 기본으로 남으므로 mount와 상관없이 여기서 받는다.
  useEffect(() => {
    if (browserApi === null) return;
    return browserApi.subscribeState((state) => {
      const key = webviews.keyOf(state.view_session);
      if (key === undefined) return;
      const tab = allTabs(latestLayout.current).find(
        (item) => item.key === key,
      );
      if (tab?.kind !== "browser" || tab.fields?.favicon === state.favicon) {
        return;
      }
      patchTabRef.current(
        key,
        (current) => ({
          fields: { ...current.fields, favicon: state.favicon },
        }),
        { later: true },
      );
    });
  }, [browserApi, webviews]);

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

  // 새 session을 연다: coding agent는 그 명령어의 새 터미널, lophn agent는 새 Agent 탭이다(안 주면 기본 lophn).
  // agent 목록이나 터미널을 아직 쓸 수 없으면 열지 않고 false다.
  const openNew = (start: NewSessionStart): boolean => {
    if (start.command !== undefined) {
      if (terminal === undefined) return false;
      openTerminalTab(host, { command: start.command, docked: true });
      return true;
    }
    const wanted = start.agent ?? lophnIdAt(workspace);
    const row = sidebarAgents.agents.find((item) => item.assignment === wanted);
    if (agentViewSource === undefined || row === undefined) return false;
    openAgent(host, { agent: row.assignment, name: row.name });
    return true;
  };
  const openLophn = (): boolean => openNew({});
  // 이 workspace의 설정 단추가 여는 탭(project는 Project settings, 앱은 App details). Home은 없다.
  const openSettingsHere =
    machine !== null
      ? undefined
      : projectId !== null
        ? () => openProjectSettings(host)
        : isApp && props.appDetail !== undefined
          ? () => openAppDetail(host)
          : undefined;
  const onSettingsAt = machine === null ? props.onSettingsAt : undefined;
  // + hover 목록과 탭 줄 + menu가 같이 쓰는, 고른 agent로 새 session을 여는 길.
  const startChoice = (choice: AgentChoice) => {
    if (choice.kind === "lophn") {
      openAgent(host, { agent: choice.id, name: choice.name });
      return;
    }
    const command = codingCommand(
      quickPrefs.coding.commands,
      choice.id as HarnessId,
    );
    if (command !== undefined) {
      openTerminalTab(host, { command, docked: true });
    }
  };
  const agentChoiceList = agentChoices(
    sidebarAgents.agents,
    terminal === undefined ? [] : quickPrefs.coding.favorites,
  );

  // session 하나를 그 agent의 탭으로 연다. session이나 agent 목록을 아직 모르면 열지 않고 false다.
  const openSessionTab = (session: string, open?: SessionTabOpen): boolean => {
    const entry = sessionStates.find((item) => item.session === session);
    const row =
      entry === undefined
        ? undefined
        : agentRow(entry, sidebarAgents.agents, workspace);
    if (row === undefined || agentViewSource === undefined) return false;
    return openAgent(host, {
      agent: row.assignment,
      name: row.name,
      session,
      ...open,
    });
  };

  // kind 선언이 배치와 통로를 건드리는 유일한 길이다. 본문·열기·닫기 확인은 모두 kind의 선언에서 오고
  // 여기서는 kind 이름으로 가르지 않는다.
  const host: TabHost = {
    workspace,
    projectId,
    projectTitle: loaded.project?.title,
    appName,
    explorerRoot,
    props,
    appScreens: appViews?.screens !== undefined,
    desk,
    windowTabs: () => allTabs(latestLayout.current),
    viewKeeps: keeps,
    openTab,
    openFloat: openFloatInStage,
    patchTab,
    removeTab,
    document: { noteReadPosition: notePosition },
    agents,
    agentView,
    projectSettings:
      projectId === null
        ? null
        : {
            projects: props.projects,
            projectChanged: reloadProject,
            quick: layout.quick,
            setQuick: (quick) => {
              const { quick: _old, ...rest } = latestLayout.current;
              commit(quick === undefined ? rest : { ...rest, quick });
            },
            commands: layout.commands ?? [],
            setCommands: (commands) => {
              const { commands: _old, ...rest } = latestLayout.current;
              commit(commands.length === 0 ? rest : { ...rest, commands });
            },
          },
  };

  // 이 창이 보이는 동안 toast 행동을 받는다. 처리기는 열 때의 최신 작업대를 본다.
  const hostRef = useRef(host);
  hostRef.current = host;
  const sessionsRef = useRef(sessionStates);
  sessionsRef.current = sessionStates;
  const agentsRef = useRef(sidebarAgents.agents);
  agentsRef.current = sidebarAgents.agents;
  const reactionEnv = {
    workspace,
    host: () => hostRef.current,
    sessions: () => sessionsRef.current,
    agents: () => agentsRef.current,
  };
  useToastHandler({
    openSession: openSessionTab,
  });

  // 시작 route(session·lophn·파일)는 이 project의 배치가 선 뒤 값마다 한 번 연다. session과 agent 목록을 아직 모르면 목록이 올 때 다시 본다.
  const started = useRef<{
    session?: string;
    lophn?: true;
    fresh?: object;
    settings?: true;
    appScreen?: true;
    open?: object;
    terminal?: string;
  }>({});
  useEffect(() => {
    if (readyWorkspace !== workspaceId) return;
    const { session, startLophn, open } = props;
    if (open !== undefined && started.current.open !== open) {
      started.current.open = open;
      openFile(host, open.path, { line: open.line });
    }
    if (session !== undefined && started.current.session !== session) {
      if (openSessionTab(session)) started.current.session = session;
    }
    if (
      props.startSession !== undefined &&
      started.current.fresh !== props.startSession &&
      openNew(props.startSession)
    ) {
      started.current.fresh = props.startSession;
    }
    if (props.startSettings && started.current.settings === undefined) {
      started.current.settings = true;
      openSettingsHere?.();
    }
    if (
      props.startAppScreen &&
      machine === null &&
      started.current.appScreen === undefined
    ) {
      started.current.appScreen = true;
      openAppScreen(host);
    }
    const reveal = props.revealTerminal;
    if (
      reveal !== undefined &&
      terminal !== undefined &&
      started.current.terminal !== reveal
    ) {
      started.current.terminal = reveal;
      terminal.store.reveal(reveal);
    }
    if (
      startLophn !== undefined &&
      started.current.lophn !== startLophn &&
      openProjectLophn(reactionEnv)
    ) {
      started.current.lophn = startLophn;
      // 방금 만든 앱은 앱 화면과 lophn session을 붙여 나란히 본다.
      if (appId !== null) {
        update((item) =>
          item.selected !== null &&
          item.tabs.some((tab) => tab.key === appScreenKey(appId))
            ? splitTab(item, appScreenKey(appId), item.selected, "right", {
                select: "target",
              })
            : item,
        );
      }
    }
  }, [
    readyWorkspace,
    workspaceId,
    props.session,
    props.startLophn,
    props.startSession,
    props.startSettings,
    props.startAppScreen,
    props.revealTerminal,
    props.open,
    sidebarAgents.agents,
    sessionIds,
  ]);

  useSurfaceRequests({
    surface,
    workspace,
    ready: readyWorkspace === workspaceId,
    host: () => hostRef.current,
    openSession: openSessionTab,
    // agent가 접힌 탭을 펴 달라는 요청. 어느 desk의 float이든 그 자리에서 펴고 desk·선택·focus는 바꾸지 않는다.
    showFloat: (key) => {
      const found = findTab(latestLayout.current, key);
      if (found?.where === "float") {
        updateAt(found.desk, (item) => restoreFloat(item, key));
      }
    },
    takePending: pool?.takePending,
    hasPage: pool === null ? undefined : (key) => pool.carried().includes(key),
  });
  useBridgeOpenRequests(terminal?.bridge ?? null, (request) =>
    terminal === undefined
      ? false
      : openBridgeUrl(hostRef.current, terminal.store, request),
  );

  // 이 창의 탭 하나를 그 자리(desk, float, 뗀 창)에서 앞으로 낸다.
  const revealTab = (key: string) => {
    const found = findTab(latestLayout.current, key);
    if (found === null) return;
    if (found.where === "detached") {
      switchDesk(found.desk);
      void props.detached?.focus({ key }).catch(() => {});
      return;
    }
    commit(
      updateDesk(
        setActiveDesk(latestLayout.current, found.desk),
        found.desk,
        (item) =>
          found.where === "float"
            ? restoreFloat(item, key)
            : selectTab(item, key),
      ),
    );
  };

  // 알림을 누르면 그 터미널 탭을 고른다.
  useEffect(() => {
    if (terminal === undefined) return;
    return terminal.store.onSelect(revealTab);
  }, [terminal, props.detached]);

  // 탭을 OS 창으로 뗀다. 순서는 transfer, 창 열기, 성공했을 때만 layout 바꾸기다. 어느 단계에서
  // 실패해도 layout은 그대로라 탭이 사라지지 않는다.
  const detach = async (key: string) => {
    const api = props.detached;
    const first = deskTabs(latestDesk()).find((tab) => tab.key === key);
    if (api === undefined || first === undefined) return;
    if (whereInDesk(latestDesk(), key) === "detached") return;
    const def = tabKindOf(first.kind);
    if (def?.noDetach === true) return;
    const transfer = await (def?.transfer?.(first, hostRef.current) ?? {
      value: null,
      views: [],
    });
    if (transfer === null) return;
    // transfer가 탭 값을 바꿨을 수 있고 그 사이 탭이 닫혔을 수 있다.
    const tab = deskTabs(latestDesk()).find((item) => item.key === key);
    if (tab === undefined) return;
    let bounds;
    try {
      ({ bounds } = await api.open({
        project: workspaceId,
        tab: slimDetachedTab(withPosition(tab)),
        transfer,
        bounds: null,
      }));
    } catch {
      return;
    }
    for (const session of transfer.views) {
      transferredViews.current.add(session);
    }
    if (whereInDesk(latestDesk(), key) === null) {
      void api.close({ key }).catch(() => {});
      return;
    }
    update((item) => detachTab(item, key, bounds));
  };

  // 최신 작업대를 보도록 ref로 건넨다. key가 있는 event는 그 탭이 있는 desk에 적용한다(보이는 desk가
  // 아니어도). 숨은 desk의 창은 숨었을 뿐이라 갑자기 사라지면(docked) 그 desk가 받는다.
  const onDetachedEvent = (event: DetachedEvent) => {
    const all = latestLayout.current;
    if (event.kind === "moved") {
      // main이 저장할 때 살아 있는 창의 bounds를 채운다.
      persistRef.current(all);
    } else if (event.kind === "open-tab") {
      openTab(
        distinctAgentTab(latestDesk(), event.tab as TabItem, allTabs(all)),
      );
    } else if (event.kind === "opened") {
      update((item) =>
        openDetachedTab(item, event.tab as TabItem, event.bounds),
      );
    } else if (
      event.kind === "docked" ||
      event.kind === "changed" ||
      event.kind === "closed"
    ) {
      const found = findTab(all, event.key);
      if (found === null) return;
      if (event.kind !== "closed" && found.where !== "detached") return;
      if (event.kind === "docked") {
        const tab = event.tab as TabItem;
        if (event.transfer !== null) {
          tabKindOf(tab.kind)?.receive?.(tab, event.transfer, hostRef.current);
        }
        updateAt(found.desk, (item) => reattachTab(item, event.key, tab));
        if (found.desk === all.active) focusTabBody(event.key);
      } else if (event.kind === "changed") {
        updateAt(found.desk, (item) => ({
          ...item,
          detached: item.detached.map((entry) =>
            entry.tab.key === event.key
              ? { ...entry, tab: event.tab as TabItem }
              : entry,
          ),
        }));
      } else updateAt(found.desk, (item) => closeDetached(item, event.key));
    }
  };
  const onDetachedEventRef = useRef(onDetachedEvent);
  onDetachedEventRef.current = onDetachedEvent;
  useEffect(
    () =>
      props.detached?.subscribe((event) => onDetachedEventRef.current(event)),
    [props.detached],
  );
  // project를 떠나면 이 project의 detached 창을 닫는다. 상태는 layout의 detached로 남아 다시 열 때 되살아난다.
  useEffect(
    () => () => {
      void props.detached?.close({ key: null }).catch(() => {});
    },
    [workspaceId, props.detached],
  );

  // 탭 본문. 고르지 않아도 남겨 둘 kind(앱 패널, browser, artifact)는 keep이 그리고 shown으로 보임을 정한다.
  // webview는 host가 key로 한 번만 만들고 옮기지 않으므로 desk나 탭을 바꿔 다시 mount해도 page가 이어진다.
  const bodyOf = (tab: TabItem, active: boolean): ReactNode => {
    const def = tabKindOf(tab.kind);
    if (machine !== null && def?.thisComputerOnly) {
      return <OnlyHere key={tab.key} machine={machine} />;
    }
    return (
      <TabBoundary key={tab.key}>
        {def?.keep?.(tab, true, host) ?? def?.render?.(tab, active, host) ?? (
          <h1 className={styles.heading}>{tab.title}</h1>
        )}
      </TabBoundary>
    );
  };

  // 탭 줄이 그리는 탭: 아이콘은 kind가 정하고(파일 종류, agent의 profile, harness vendor) 이름 뒤에 상태 점이 붙는다.
  const iconOfTab = (tab: TabItem): ReactNode => {
    const def = tabKindOf(tab.kind);
    return def === undefined
      ? null
      : (def.iconOf?.(tab, host) ?? (
          <Icon icon={def.icon} pixels={iconPixels("small")} />
        ));
  };
  // 본문이 바뀌는 탭(Agents 탭의 열린 agent)은 kind가 이름을 정한다.
  const titleOfTab = (tab: TabItem): string =>
    tabKindOf(tab.kind)?.titleOf?.(tab, host) ?? tab.title;
  const stripTab = (tab: TabItem): StripTab => ({
    key: tab.key,
    title: titleOfTab(tab),
    icon: iconOfTab(tab),
    dot: tabKindOf(tab.kind)?.dotOf?.(tab, host) ?? null,
    preview: tab.preview === true,
    unsaved: isUnsaved(tab.key),
    renamable: tabKindOf(tab.kind)?.rename !== undefined,
  });

  // 사람이 닫은 탭. 창 전체에서 최근 몇 개를 기억해 Ctrl/Cmd+Shift+T가 되살린다. 이름 바꾸기·
  // 휴지통으로 사라진 탭은 사람이 닫은 것이 아니라서 넣지 않는다.
  const closedTabs = useRef<TabItem[]>([]);
  const rememberClosed = (tab: TabItem) => {
    if (tabKindOf(tab.kind)?.noReopen) return;
    const position = positions.current[tab.key] ?? tab.readPosition;
    closedTabs.current = [
      position === undefined ? tab : { ...tab, readPosition: position },
      ...closedTabs.current.filter((item) => item.key !== tab.key),
    ].slice(0, CLOSED_TABS_MAX);
  };

  // 확인이 필요한 kind는 사람이 확인해야 닫는다. 취소하면 탭을 유지한다.
  const close = (key: string) => {
    const tab = allTabs(latestLayout.current).find((item) => item.key === key);
    if (tab === undefined) return;
    const confirm = tabKindOf(tab.kind)?.beforeClose?.(tab, host);
    if (!confirm) {
      rememberClosed(tab);
      removeTab(key);
      return;
    }
    void confirm.then((remove) => {
      if (!remove) return;
      rememberClosed(tab);
      removeTab(key);
    });
  };

  // desk의 x. 사람이 desk를 끝내는 것이라 확인 dialog를 거친다.
  const [closingDesk, setClosingDesk] = useState<string | null>(null);
  const closeSummary = (target: Desk): DeskCloseSummary => {
    const tabs = deskTabs(target);
    return {
      tabs: tabs.length,
      terminals: tabs.filter((tab) => tab.kind === "terminal").length,
      floats: target.floats.length,
      detached: target.detached.length,
      unsaved: tabs
        .filter((tab) => isUnsaved(tab.key))
        .map((tab) => ({
          title: titleOfTab(tab),
          path: tabKindOf(tab.kind)?.pathOf?.(tab) ?? tab.key,
        })),
    };
  };
  // 그 desk의 tab·float·창을 보통 닫기 길(kind의 beforeClose)로 하나씩 닫고 desk를 지운다. 이미 확인했으므로 터미널은
  // 되묻지 않고, 저장이 안 되는 파일처럼 잃을 것이 남는 질문만 묻는다. 하나라도 거절하면 거기서 멈추고 desk는 남는다.
  const finishDesk = async (key: string) => {
    const target = latestLayout.current.desks[key];
    if (target === undefined || target.workflow !== undefined) return;
    for (const tab of deskTabs(target)) {
      const confirm = tabKindOf(tab.kind)?.beforeClose?.(tab, host, {
        confirmed: true,
      });
      if (confirm && !(await confirm)) return;
      removeTab(tab.key);
    }
    commit(removeDesk(latestLayout.current, key), true, true);
  };

  // 탭이 파일이면 그 절대 경로. Copy Path·Reveal in Explorer가 이 탭에만 생긴다.
  const pathOfTab = (tab: TabItem): string | null =>
    tabKindOf(tab.kind)?.pathOf?.(tab) ?? null;

  const relativePath = (path: string): string => {
    const folder = (loaded.project?.folders ?? []).find((item) =>
      path.startsWith(`${item.path.replace(/\/+$/, "")}/`),
    );
    return folder === undefined
      ? path
      : path.slice(folder.path.replace(/\/+$/, "").length + 1);
  };

  const copyPath = (path: string, relative: boolean) => {
    void globalThis.navigator?.clipboard?.writeText(
      relative ? relativePath(path) : path,
    );
  };

  // 탭 menu의 여러 개 닫기(Close others, Close group 등)가 사람에게 묻는 중인 것. 터미널과 파일을 한 dialog에 줄로 보인다.
  const [closingTabs, setClosingTabs] = useState<{
    readonly keys: readonly string[];
    readonly terminals: readonly TabsCloseRow[];
    readonly lost: readonly TabsCloseRow[];
  } | null>(null);
  // 파일의 마지막 고침을 먼저 보낸 뒤, 멈출 터미널과 저장하지 못한 파일이 있으면 한 번만 묻는다. 없으면 바로 닫는다.
  const closeMany = async (scope: CloseScope, key: string) => {
    const keys = closeTargets(latestDesk(), scope, key, isUnsaved);
    const tabs = latestDesk().tabs.filter((tab) => keys.includes(tab.key));
    await Promise.all(
      tabs
        .filter((tab) => isUnsaved(tab.key))
        .map((tab) => editorSessions?.flush(tab.key)),
    );
    const live = await Promise.all(
      tabs.map(
        (tab) =>
          terminal !== undefined &&
          tab.kind === "terminal" &&
          terminalLive(terminal, tab.key),
      ),
    );
    const rowOf = (tab: TabItem): TabsCloseRow => {
      const path = pathOfTab(tab);
      return {
        key: tab.key,
        title: titleOfTab(tab),
        icon: iconOfTab(tab),
        ...(path === null ? {} : { path }),
      };
    };
    const terminals = tabs.filter((_, at) => live[at] === true).map(rowOf);
    const lost = tabs.filter((tab) => isUnsaved(tab.key)).map(rowOf);
    if (terminals.length === 0 && lost.length === 0) {
      await finishMany(keys, []);
      return;
    }
    setClosingTabs({ keys, terminals, lost });
  };
  // 사람이 확인한 tab들을 닫는다. 터미널은 되묻지 않고 확인한 파일의 남은 고침은 버린다. 그 사이 새로 저장이 남은 파일은
  // 그 tab에서 묻고, 계속 편집을 고르면 거기서 멈춘다(남은 tab도 닫지 않는다).
  const finishMany = async (
    keys: readonly string[],
    lost: readonly string[],
  ) => {
    for (const target of keys) {
      const tab = latestDesk().tabs.find((item) => item.key === target);
      if (tab === undefined) continue;
      if (lost.includes(target)) editorSessions?.discard(target);
      const confirm = tabKindOf(tab.kind)?.beforeClose?.(tab, host, {
        confirmed: true,
      });
      if (confirm && !(await confirm)) return;
      rememberClosed(tab);
      removeTab(target);
    }
  };

  // Reveal in Explorer. 오른쪽 sidebar를 열고 Files에서 그 파일을 알린다.
  const [reveal, setReveal] = useState<{
    readonly path: string;
    readonly nonce: number;
  } | null>(null);
  const revealInExplorer = (path: string) => {
    setPanel("explorer");
    setRightOpen(true);
    setReveal({ path, nonce: Date.now() });
  };

  // Ctrl/Cmd+Shift+E. 오른쪽 sidebar가 Files를 고르고 Explorer가 고른 줄에 focus를 받는다(받으면 내려놓는다).
  const [explorerFocusAsked, setExplorerFocusAsked] = useState(false);
  // desk.rename이 desk 목록을 이름 바꾸기 상태로 여는 신호.
  const [deskRenameAsk, setDeskRenameAsk] = useState(0);

  // path 자신이거나 그 폴더 안에 있는 열린 파일 탭.
  const tabsAt = (path: string) =>
    allTabs(latestLayout.current).filter(
      (tab) =>
        tab.kind === "document_editor" &&
        (tab.key === path || tab.key.startsWith(`${path}/`)),
    );

  // 저장이 남은 파일은 지금 있는 close guard 흐름(beforeClose)으로 사람에게 묻는다. 하나라도 거절하면 false다.
  const releaseTabs = async (tabs: readonly TabItem[]): Promise<boolean> => {
    for (const tab of tabs) {
      const confirm = tabKindOf(tab.kind)?.beforeClose?.(tab, host);
      if (confirm && !(await confirm)) return false;
    }
    return true;
  };

  // sidebar의 이름 바꾸기·끌어 옮기기. 열려 있던 파일은 옮긴 경로의 탭으로 다시 연다.
  const moveFile = async (
    from: string,
    to: string,
  ): Promise<TabAwareResult> => {
    const open = tabsAt(from);
    if (!(await releaseTabs(open))) return { ok: false, code: "cancelled" };
    const result = await source.rename(from, to);
    if (!result.ok) return result;
    for (const tab of open) removeTab(tab.key);
    for (const tab of open) openFile(host, to + tab.key.slice(from.length));
    return result;
  };

  // sidebar에서 휴지통으로 보낸 파일의 열린 탭은 닫는다. 휴지통을 못 쓰면 탭도 그대로다.
  const trashFile = async (path: string): Promise<TabAwareResult> => {
    const open = tabsAt(path);
    if (!(await releaseTabs(open))) return { ok: false, code: "cancelled" };
    const result = await source.trash(path);
    if (!result.ok) return result;
    for (const tab of open) removeTab(tab.key);
    return result;
  };

  // Explorer의 연결 폴더 더하기·빼기. 성공하면 바뀐 폴더 목록으로 sidebar를 다시 그린다.
  // 사람이 선택기를 닫는 것(null)은 실패가 아니다. 빼는 폴더가 지금 루트면 첫 폴더로 돌아간다.
  const addProjectFolder = async (): Promise<boolean> => {
    if (projectId === null) return false;
    const result = await source.addFolder(projectId);
    if (!result.ok) return false;
    if (result.value !== null) {
      const view = result.value;
      setLoaded((state) => ({ ...state, project: view }));
    }
    return true;
  };
  const removeProjectFolder = async (path: string): Promise<boolean> => {
    if (projectId === null) return false;
    const result = await source.removeFolder(projectId, path);
    if (!result.ok) return false;
    const view = result.value;
    setLoaded((state) => ({ ...state, project: view }));
    if (explorerRoot === path) setExplorerRoot(undefined);
    return true;
  };

  const pickFile = filePicker();

  // 창 팔레트의 작업대 행. 고르면 이 작업대 안의 대상으로만 간다.
  const palette = usePaletteEnv();
  const windowCommands = useWindowCommands();
  const selectKey = (key: string) => {
    update((item) => selectTab(item, key));
    focusTabBody(key);
  };
  // tabs의 탭을 float 층 가운데 60% 크기의 패널로 띄운다. 앱 panel 화면은 마지막 float 자리가 있으면 거기다.
  // float 층을 못 쟀으면 아무것도 하지 않는다.
  const floatByKey = (key: string) => {
    if (stageSize === undefined) return;
    const remembered = launchOf(
      desk.tabs.find((item) => item.key === key),
    )?.rect;
    const rect =
      remembered === undefined
        ? newFloatRect(stageSize)
        : clampFloatRect(remembered, stageSize);
    update((item) => floatTab(item, key, rect));
  };
  // desk의 float을 전역 float로 옮긴다. rect, 접힘, pin을 그대로 가져가고 desk에서는 닫는다. 순서는 transfer, 전역 float 더하기,
  // 성공했을 때만 desk에서 닫기다. 전역 float이 상한이거나 transfer가 거절하면 desk float은 그대로다.
  const floatToGlobal = async (key: string) => {
    const first = latestDesk().floats.find((float) => float.tab.key === key);
    if (first === undefined || !canGoGlobal(first.tab)) return;
    const def = tabKindOf(first.tab.kind);
    const transfer = (await def?.transfer?.(first.tab, hostRef.current)) ?? {
      value: null,
      views: [],
    };
    if (transfer === null) return;
    // transfer가 탭을 바꿨을 수 있고 그 사이 float이 닫혔을 수 있다.
    const item = latestDesk().floats.find((float) => float.tab.key === key);
    if (item === undefined) return;
    const moved = globalFloats.add({
      tab: withPosition(item.tab),
      workspace,
      rect: item.rect,
      minimized: item.minimized,
      pinned: item.pinned,
      title: item.tab.title,
      transfer,
    });
    if (moved) update((d) => closeFloat(d, key));
  };
  // 전역 float을 이 desk의 float으로 옮긴다. 이 창의 desk에 더 둘 수 없으면 false다. 앱 panel만 key를 새로 짓는다
  // (전역 key는 앱·화면으로 정해져 있다). 받는 쪽 `receive`는 이 desk의 TabHost로 부른다.
  const globalToFloat = (
    float: GlobalFloatView,
    transfer: TabTransfer,
  ): boolean => {
    if (stageSize === undefined) return false;
    const tab: TabItem =
      float.tab.kind === "app_panel"
        ? { ...float.tab, key: newKey(), title: float.title }
        : float.tab;
    const place = (d: Desk) => {
      const opened = openFloatTab(
        d,
        tab,
        clampFloatRect(float.rect, stageSize),
      );
      const pinned = float.pinned ? pinFloat(opened, tab.key, true) : opened;
      return float.minimized ? minimizeFloat(pinned, tab.key) : pinned;
    };
    if (place(latestDesk()) === latestDesk()) return false;
    tabKindOf(tab.kind)?.receive?.(tab, transfer, hostRef.current);
    update(place);
    return true;
  };
  const globalToFloatRef = useRef(globalToFloat);
  globalToFloatRef.current = globalToFloat;
  const { registerDesk } = globalFloats;
  useEffect(
    () =>
      registerDesk({
        workspace,
        take: (float, transfer) => globalToFloatRef.current(float, transfer),
      }),
    [registerDesk, workspaceId],
  );
  usePaletteScope(() =>
    workspaceScope({
      desk,
      files: loaded.files,
      bookmarks: bookmarkList.state === "ok" ? bookmarkList.bookmarks : [],
      terminal: terminal !== undefined,
      platform: palette.platform,
      keys: windowCommands?.overrides() ?? {},
      // 다른 기계의 창도 project 설정 행이 없다(그 기계에서 바꾼다).
      home: projectId === null || machine !== null,
      search:
        palette.search && projectId !== null
          ? (query) =>
              palette.search!(query, { kind: "project", id: projectId })
          : undefined,
      go: (target) => {
        if (target.kind === "tab") selectKey(target.key);
        else if (target.kind === "document") openDocumentRow(target.document);
        else if (target.kind === "bookmark") openBrowserTab(host, target.url);
        else if (target.action === "home") onHome();
        else if (target.action === "settings") onSettings();
        else if (target.action === "project-settings") {
          openProjectSettings(host);
        } else if (target.action === "terminal") openTerminalTab(host);
        else if (target.action === "float") {
          const tab = focusTab(latestDesk());
          if (tab !== undefined) floatByKey(tab.key);
        } else if (target.action === "dock") {
          const top = topFloat(latestDesk());
          if (top !== undefined) update((item) => dockFloat(item, top.tab.key));
        } else if (target.action === "minimize") {
          const top = topFloat(latestDesk());
          if (top !== undefined) {
            update((item) => minimizeFloat(item, top.tab.key));
          }
        }
      },
    }),
  );

  // 작업대 단축키의 command는 작업대가 갖는다. 키는 창의 keybinding service가 표(protocol의 shell/keybindings.ts)로
  // 정하고, main이 먼저 받는 것(macOS의 Cmd+W)도 같은 command id로 온다. 지금 배치는 latestLayout에서 읽는다.
  const openQuickFiles = useOpenPalette();
  const runCommand = (command: Command, arg?: number | string) => {
    const current = latestDesk();
    const n = typeof arg === "number" ? arg : undefined;
    switch (command) {
      case "tab.next":
      case "tab.prev": {
        const next = stepTab(current, command === "tab.next" ? 1 : -1);
        if (next.selected !== current.selected) selectKey(next.selected!);
        return;
      }
      case "tab.nth": {
        const entries = deskEntries(current);
        const entry = n === 0 ? entries.at(-1) : entries[(n ?? 1) - 1];
        const key = entry?.group?.focus ?? entry?.key;
        if (key !== undefined && key !== current.selected) selectKey(key);
        return;
      }
      case "tab.close": {
        if (current.selected !== null) close(current.selected);
        return;
      }
      case "tab.reopen": {
        while (closedTabs.current.length > 0) {
          const [last, ...rest] = closedTabs.current;
          closedTabs.current = rest;
          if (findTab(latestLayout.current, last!.key) !== null) continue;
          openTab({ ...last!, preview: false });
          focusTabBody(last!.key);
          return;
        }
        return;
      }
      case "tab.move-left":
      case "tab.move-right": {
        const key = entryKey(current);
        const at = current.tabs.findIndex((tab) => tab.key === key);
        if (at >= 0) {
          update((item) =>
            moveTab(item, key!, at + (command === "tab.move-left" ? -1 : 1)),
          );
        }
        return;
      }
      case "pane.focus": {
        const group = groupOf(current, current.selected);
        const key =
          group === null ? undefined : leavesOf(group.layout)[(n ?? 1) - 1];
        if (key === undefined) return;
        update((item) => focusLeaf(item, (n ?? 1) - 1));
        focusTabBody(key);
        return;
      }
      case "pane.focus-left":
      case "pane.focus-right":
      case "pane.focus-up":
      case "pane.focus-down": {
        const group = groupOf(current, current.selected);
        if (group === null || current.selected === null) return;
        const key = neighborLeaf(
          group.layout,
          current.selected,
          command.slice("pane.focus-".length) as PaneDirection,
        );
        if (key === null) return;
        update((item) => selectTab(item, key));
        focusTabBody(key);
        return;
      }
      case "pane.split":
      case "pane.split-down":
        if (current.selected !== null) {
          splitNext(
            current.selected,
            command === "pane.split" ? "right" : "bottom",
          );
        }
        return;
      case "pane.swap-left":
      case "pane.swap-right":
      case "pane.swap-up":
      case "pane.swap-down": {
        const group = groupOf(current, current.selected);
        const from = current.selected;
        if (group === null || from === null) return;
        const to = neighborLeaf(
          group.layout,
          from,
          command.slice("pane.swap-".length) as PaneDirection,
        );
        if (to === null) return;
        // 고른 tab이 selected로 남아 swapTabs의 settle이 focus를 그 tab의 새 칸으로 옮긴다.
        update((item) => swapTabs(item, from, to));
        focusTabBody(from);
        return;
      }
      case "pane.stack-next":
      case "pane.stack-prev": {
        const from = current.selected;
        if (from === null) return;
        const next = cyclePane(
          current,
          from,
          command === "pane.stack-next" ? 1 : -1,
        ).selected;
        if (next !== null && next !== from) selectKey(next);
        return;
      }
      case "tab.rename":
      case "tab.close-others":
      case "tab.close-right":
      case "tab.close-saved":
      case "tab.close-all":
      case "tab.keep-open":
      case "tab.copy-path":
      case "tab.copy-relative-path":
      case "tab.reveal":
      case "tab.float":
      case "tab.detach":
      case "pane.unstack":
      case "pane.remove":
      case "pane.unsplit":
      case "pane.close-others":
      case "pane.close-group":
        if (current.selected !== null) {
          runTabAction(TAB_ACTIONS[command], current.selected);
        }
        return;
      case "desk.new":
        newDesk();
        return;
      case "desk.next":
      case "desk.prev": {
        const at = deskOrder.findIndex(
          (item) => item.key === latestLayout.current.active,
        );
        const step = command === "desk.next" ? 1 : -1;
        const target =
          deskOrder[(at + step + deskOrder.length) % deskOrder.length];
        if (target !== undefined) selectDesk(target.key);
        return;
      }
      case "desk.nth": {
        const target = deskOrder[(n ?? 1) - 1];
        if (target !== undefined) selectDesk(target.key);
        return;
      }
      case "desk.rename": {
        const own = latestLayout.current.desks[latestLayout.current.active];
        if (
          own !== undefined &&
          own.key !== MAIN_DESK &&
          own.workflow === undefined
        ) {
          setDeskRenameAsk((count) => count + 1);
        }
        return;
      }
      case "desk.close":
        requestCloseDesk(latestLayout.current.active);
        return;
      case "float.dock": {
        const top = topFloat(current);
        if (top === undefined) return;
        update((item) => dockFloat(item, top.tab.key));
        focusTabBody(top.tab.key);
        return;
      }
      case "float.minimize":
        update((item) => minimizeLooseFloats(item));
        return;
      case "new.terminal":
        openTerminalTab(hostRef.current);
        return;
      case "new.browser":
        openBrowserTab(hostRef.current);
        return;
      case "new.agent":
        void openLophn();
        return;
      case "new.document":
        void pickFile?.().then((path) => {
          if (path !== null) openFile(hostRef.current, path);
        });
        return;
      case "sidebar.toggle-right":
        setRightOpen((open) => !open);
        return;
      case "nav.back":
        if (backAt >= 0) walk(backAt);
        return;
      case "nav.forward":
        if (forwardAt >= 0) walk(forwardAt);
        return;
      case "settings.open":
        onSettings();
        return;
      // Inbox·Jobs overlay는 왼쪽 sidebar 안의 상태라 여기서 열 길이 없다. 단추가 overlay에서 부르는 탭 열기와 같은 것을 연다.
      case "inbox.open":
        openInbox(hostRef.current);
        return;
      case "jobs.open":
        openJobs(hostRef.current);
        return;
      case APP_PANEL: {
        // arg는 "<app>:<surface>"이고 app id에 ':'가 없다.
        const split = typeof arg === "string" ? arg.indexOf(":") : -1;
        if (
          typeof arg !== "string" ||
          split < 0 ||
          !hostRef.current.appScreens
        ) {
          return;
        }
        const pin = { app: arg.slice(0, split), surface: arg.slice(split + 1) };
        const app = panelApps?.ok
          ? panelApps.value.find((item) => item.app === pin.app)
          : undefined;
        // 앱이나 화면이 없어졌으면(목록을 읽은 뒤) 빠른 실행 pin처럼 열지 않는다.
        if (
          panelApps?.ok &&
          !app?.screens.some(
            (item) => item.key === pin.surface && item.places.includes("panel"),
          )
        ) {
          return;
        }
        launchAppPanel(
          pin,
          app?.name ?? t("project-workspace.label.kind-app-panel"),
        );
        return;
      }
      case "sidebar.toggle":
        setLeftOpen((open) => !open);
        return;
      case "explorer.focus":
        if (projectId === null) return;
        setPanel("explorer");
        setRightOpen(true);
        setExplorerFocusAsked((loaded.project?.folders.length ?? 0) > 0);
        return;
      case "search.open":
        if (source.searchSource !== undefined && projectId !== null) {
          openSearchShortcut(hostRef.current);
        }
        return;
      case "terminal.focus": {
        if (terminal === undefined) return;
        // 지금 desk의 터미널을 먼저 찾고, 없으면 다른 desk의 터미널로 간다.
        const found = [...current.tabs, ...allTabs(latestLayout.current)].find(
          (tab) => tab.kind === "terminal",
        );
        if (found === undefined) openTerminalTab(hostRef.current);
        else openTab(found);
        return;
      }
      case "files.quick-open":
        openQuickFiles();
        return;
    }
  };
  const handlersOf = (commands: readonly Command[]) =>
    Object.fromEntries(
      commands.map((command) => [
        command,
        (arg: unknown) => runCommand(command, arg as number | string),
      ]),
    );
  // 이 창에 그 통로가 아예 없는 command는 올리지 않아 키가 넘어간다.
  const absent = new Set<Command>([
    ...(terminal === undefined
      ? (["new.terminal", "terminal.focus"] as const)
      : []),
    ...(browserApi === null ? (["new.browser"] as const) : []),
    ...(pickFile === undefined ? (["new.document"] as const) : []),
    ...(agentViewSource === undefined ? (["new.agent"] as const) : []),
    ...(source.searchSource === undefined || projectId === null
      ? (["search.open"] as const)
      : []),
    ...(props.jobs === undefined ? (["jobs.open"] as const) : []),
    ...(machine !== null ? (["explorer.focus"] as const) : []),
    ...(projectId === null
      ? ([
          "explorer.focus",
          "desk.new",
          "desk.next",
          "desk.prev",
          "desk.nth",
          "desk.rename",
          "desk.close",
        ] as const)
      : []),
  ]);
  // 지금 일이 있을 때만 받는 command. menu가 그 항목을 보이는 때와 같은 사정(menuStateOf)이다.
  const stateNow = () => {
    const tab = focusTab(desk);
    return tab === undefined ? undefined : menuStateOf(tab);
  };
  const gated: readonly (readonly [readonly Command[], () => boolean])[] = [
    [
      [
        "pane.focus",
        "pane.focus-left",
        "pane.focus-right",
        "pane.focus-up",
        "pane.focus-down",
        "pane.swap-left",
        "pane.swap-right",
        "pane.swap-up",
        "pane.swap-down",
        "pane.unsplit",
        "pane.close-group",
      ],
      () => (stateNow()?.group ?? 0) >= 2,
    ],
    [["pane.remove"], () => (stateNow()?.group ?? 0) >= 3],
    [
      [
        "pane.stack-next",
        "pane.stack-prev",
        "pane.unstack",
        "pane.close-others",
      ],
      () => stateNow()?.stacked === true,
    ],
    [["tab.rename"], () => stateNow()?.renamable === true],
    [["tab.keep-open"], () => stateNow()?.preview === true],
    [["tab.detach"], () => stateNow()?.canDetach === true],
    [
      ["tab.copy-path", "tab.copy-relative-path", "tab.reveal"],
      () => stateNow()?.file === true,
    ],
    [["nav.back"], () => backAt >= 0],
    [["nav.forward"], () => forwardAt >= 0],
    [["float.dock"], () => topFloat(latestDesk()) !== undefined],
    [
      ["float.minimize"],
      () => desk.floats.some((item) => !item.pinned && !item.minimized),
    ],
  ];
  const gatedIds = new Set(gated.flatMap(([ids]) => ids));
  useCommands(
    handlersOf(
      WORKSPACE_COMMANDS.filter(
        (command) => !absent.has(command) && !gatedIds.has(command),
      ),
    ),
  );
  for (const [ids, when] of gated) {
    useCommands(handlersOf(ids.filter((command) => !absent.has(command))), {
      when,
    });
  }
  useCommands(hostRef.current.appScreens ? handlersOf([APP_PANEL]) : {});

  const currentTab = focusTab(desk);

  // sidebar의 Current는 이 창에 열린 탭이고 이름과 점은 탭 줄과 같다. 다른 자리·떼어 낸 창의 탭도 이 창의 것이다.
  const windowTabs = allTabs(layout);
  const agentTabTitles = new Map(
    windowTabs.flatMap((tab) => {
      if (tab.kind !== "agent") return [];
      const session = sessionOf(tab);
      return session === null ? [] : [[session, tab.title] as const];
    }),
  );
  const sidebarDesks = layoutDesks(layout);
  // 첫 메시지 전이라 session이 없는 Agent 탭. sidebar의 draft 줄이다.
  const agentDrafts = windowTabs.filter(
    (tab) => tab.kind === "agent" && sessionOf(tab) === null,
  );
  // 왼쪽 sidebar 줄(lophn session, draft, 터미널)의 탭. 모든 desk에서 찾는다.
  const sidebarTabOf = (item: SidebarSession): TabItem | undefined =>
    allTabs(latestLayout.current).find((tab) =>
      item.kind === "terminal" || item.kind === "draft"
        ? tab.key === item.ref
        : tab.kind === "agent" && sessionOf(tab) === item.ref,
    );
  // 왼쪽 sidebar가 강조할 줄: 고른 tab의 session, draft, 터미널.
  const currentSession =
    currentTab?.kind === "agent" ? sessionOf(currentTab) : null;
  const selectedSessionKey =
    currentTab === null || currentTab === undefined
      ? undefined
      : currentTab.kind === "agent"
        ? currentSession === null
          ? sessionKey({ kind: "draft", ref: currentTab.key })
          : sessionKey({ kind: "session", ref: currentSession })
        : currentTab.kind === "terminal"
          ? sessionKey({ kind: "terminal", ref: currentTab.key })
          : undefined;
  const terminalTabs = windowTabs.flatMap((tab) =>
    tab.kind === "terminal"
      ? [
          {
            key: tab.key,
            title: tab.title,
            dot: tabKindOf(tab.kind)?.dotOf?.(tab, host) ?? null,
          },
        ]
      : [],
  );
  const panelTerminals = usePanelTerminals(terminal, projectId, terminalTabs);

  // 이름은 탭 화면이 아니라 여기서 모든 터미널 탭에 맞춘다. 그려진 탭만 맞추면 숨은 탭의 이름이 갈라진다.
  const subscribeTerminal = useCallback(
    (listener: () => void) => terminal?.store.subscribe(listener) ?? (() => {}),
    [terminal],
  );
  const terminalVersion = useSyncExternalStore(
    subscribeTerminal,
    () => terminal?.store.version() ?? 0,
  );
  useEffect(() => {
    if (terminal === undefined) return;
    for (const tab of allTabs(latestLayout.current)) {
      if (tab.kind !== "terminal") continue;
      syncTerminalTab(tab, terminal.store, host.patchTab);
      // 저장된 layout만 보는 다른 workspace의 sidebar가 coding agent 터미널을 알아보게 harness를 탭에 남긴다.
      const agent = terminal.store.agentOf(tab.key);
      if (agent?.hooked === true && harnessOf(tab) !== agent.harness) {
        host.patchTab(tab.key, (current) => ({
          fields: { ...current.fields, harness: agent.harness },
        }));
      }
    }
  }, [terminalVersion, terminal, windowTabs]);

  // Inbox 줄이 id 대신 쓰는 workspace 이름.
  const inboxWorkspaces = useSidebarWorkspaceList();
  const inboxNames = useMemo<InboxNames>(
    () => ({
      projects: new Map(
        inboxWorkspaces.projects.map((one) => [one.id, one.title]),
      ),
      apps: new Map(inboxWorkspaces.apps.map((one) => [one.id, one.name])),
    }),
    [inboxWorkspaces.projects, inboxWorkspaces.apps],
  );

  // 터미널 탭 이름을 main에 알린다. main이 runtime에 실어 모든 창에 보내므로 OS 알림과 다른 창·workspace의 Inbox도
  // 탭 이름을 안다. 바뀐 것만 보낸다.
  const terminalNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const tab of allTabs(layout)) {
      const ref = tab.kind === "terminal" ? terminal?.store.get(tab.key) : null;
      if (ref?.terminalRef != null) names.set(ref.terminalRef, tab.title);
    }
    return names;
  }, [layout, terminalVersion, terminal]);
  const sentNames = useRef(new Map<string, string>());
  useEffect(() => {
    const api = terminal?.bridge;
    for (const [ref, name] of terminalNames) {
      if (sentNames.current.get(ref) === name) continue;
      sentNames.current.set(ref, name);
      void api?.setTabName({ terminal_ref: ref, name });
    }
  }, [terminalNames, terminal]);

  // card에 그릴 탭. 고른 탭이 group 구성원이면 그 group의 leaf 전부(leaf 순서), 아니면 고른 탭 하나다.
  const group = groupOf(desk, desk.selected);
  const deskTab = (key: string | null) =>
    desk.tabs.find((tab) => tab.key === key);
  const shown = (
    group === null ? [desk.selected] : leavesOf(group.layout)
  ).flatMap((key) => deskTab(key) ?? []);
  // agent가 연 browser·preview·artifact 탭(key `host:`)은 사람이 고르기 전에도 본문을 mount한다. 그래야 page가 붙어 agent가 바로 다룬다.
  // 자리가 없어(display: none) 사람 화면에는 나오지 않고, 고르면 이 자리에서 pane 안으로 옮겨 mount된다(webview는 key로 이어진다).
  // 고르지 않은 tab, 접힌 float, 다른 desk의 tab·float이 모두 대상이다. 보이는 것(card의 칸, 펴진 float)은 제 자리에서 mount한다.
  // detached는 그 창이 mount한다.
  const hiddenHostTabs = Object.values(layout.desks)
    .flatMap((one) => [
      ...one.tabs.filter(
        (tab) => one !== desk || !shown.some((item) => item.key === tab.key),
      ),
      ...one.floats
        .filter((item) => one !== desk || item.minimized)
        .map((item) => item.tab),
    ])
    .filter(
      (tab) =>
        tab.key.startsWith("host:") &&
        (tab.kind === "browser" ||
          tab.kind === "app_preview" ||
          tab.kind === "artifact") &&
        tab.fields?.native !== true,
    );
  // key의 칸 옆에 다음 plain tab을 붙인다. group은 그 leaf 옆에 끼고 가득 차면 아무 일도 없다.
  const splitNext = (key: string, side: "right" | "bottom") => {
    const partner = splitPartner(latestDesk(), key);
    if (partner === null) return;
    update((item) => splitTab(item, key, partner, side, { select: "target" }));
  };

  // tab 메뉴(오른쪽 클릭과 card ⋯)가 보이는 항목.
  const menuStateOf = (tab: TabItem): TabMenuState => {
    const tabs = desk.tabs;
    const own = groupOf(desk, tab.key);
    const span = own === null ? [tab.key] : membersOf(own.layout);
    const lastAt = Math.max(
      ...span.map((key) => tabs.findIndex((item) => item.key === key)),
    );
    return {
      renamable: tabKindOf(tab.kind)?.rename !== undefined,
      preview: tab.preview === true,
      file: pathOfTab(tab) !== null,
      canDetach:
        props.detached !== undefined && tabKindOf(tab.kind)?.noDetach !== true,
      group: own === null ? 0 : leavesOf(own.layout).length,
      stacked: paneStackOf(desk, tab.key).length > 1,
      // 칸에 숨은 tab은 나눌 자리가 없다.
      canSplit:
        (own === null || leavesOf(own.layout).includes(tab.key)) &&
        splitPartner(desk, tab.key) !== null,
      hasOthers: tabs.length > span.length,
      hasRight: lastAt < tabs.length - 1,
    };
  };

  const [renaming, setRenaming] = useState<string | null>(null);
  const [tabMenu, setTabMenu] = useState<{
    readonly key: string;
    readonly x: number;
    readonly y: number;
  } | null>(null);
  const menuTab =
    tabMenu === null
      ? undefined
      : desk.tabs.find((item) => item.key === tabMenu.key);

  const runTabAction = (action: TabAction, key: string) => {
    const tab = desk.tabs.find((item) => item.key === key);
    if (tab === undefined) return;
    const path = pathOfTab(tab);
    switch (action) {
      case "rename":
        setRenaming(key);
        return;
      case "close":
        close(key);
        return;
      case "close-others":
        void closeMany("others", key);
        return;
      case "close-pane-others":
        void closeMany("pane-others", key);
        return;
      case "close-group":
        void closeMany("group", key);
        return;
      case "close-right":
        void closeMany("right", key);
        return;
      case "close-saved":
        void closeMany("saved", key);
        return;
      case "close-all":
        void closeMany("all", key);
        return;
      case "keep-open":
        update((item) => pinTab(item, key));
        return;
      case "float":
        floatByKey(key);
        return;
      case "split-right":
      case "split-down":
        splitNext(key, action === "split-right" ? "right" : "bottom");
        return;
      case "split-remove":
      case "unstack":
        update((item) => ungroupTab(item, key));
        return;
      case "unsplit":
        update((item) => ungroup(item, key));
        return;
      case "detach":
        void detach(key);
        return;
      case "copy-path":
      case "copy-relative-path":
        if (path !== null) copyPath(path, action === "copy-relative-path");
        return;
      case "reveal":
        if (path !== null) revealInExplorer(path);
        return;
    }
  };

  // 탭이 파일이면 project 폴더 기준 경로 조각, 아니면 탭 이름이 crumb이다.
  const crumbsOf = (tab: TabItem): string[] => {
    const path = pathOfTab(tab);
    const base =
      loaded.project?.title ??
      appName ??
      projectId ??
      t("left-sidebar.label.home");
    return tab.kind === "app_screen"
      ? [base]
      : path === null
        ? [base, tab.title]
        : [
            base,
            ...relativePath(path)
              .split("/")
              .filter((part) => part !== ""),
          ];
  };
  // 파일 탭의 경로 조각을 눌러 둘러볼 폴더(VS Code breadcrumb처럼). 폴더 조각은 그 폴더가 든 위쪽 폴더, 연결 폴더 조각은
  // 그 폴더 자신, 파일 조각은 파일이 든 폴더다. 연결 폴더 밖 파일이면 없다.
  const browseOf = (tab: TabItem): CardPane["browse"] => {
    const path = pathOfTab(tab);
    const owner = (loaded.project?.folders ?? []).find((item) =>
      path?.startsWith(`${item.path.replace(/\/+$/, "")}/`),
    );
    if (path === null || owner === undefined) return undefined;
    const base = owner.path.replace(/\/+$/, "");
    const parts = path.slice(base.length + 1).split("/");
    const chain = [base];
    for (const part of parts.slice(0, -1)) {
      chain.push(`${chain[chain.length - 1]}/${part}`);
    }
    const dirs = [
      ...chain.map((_, at) => chain[Math.max(at - 1, 0)]),
      chain[chain.length - 1],
    ];
    return {
      dirs,
      panel: (dir, close) => (
        <CrumbBrowse
          source={source}
          dir={dir}
          current={path}
          onOpenFile={(file, keep) => {
            close();
            openFile(host, file, { preview: keep !== true });
          }}
        />
      ),
    };
  };
  const panes: CardPane[] = shown.map((tab) => {
    const dot = tabKindOf(tab.kind)?.dotOf?.(tab, host) ?? null;
    const browse = browseOf(tab);
    return {
      key: tab.key,
      crumbs: crumbsOf(tab),
      ...(browse === undefined ? {} : { browse }),
      ...(dot === null ? {} : { status: dotLabel(dot) }),
      menu: menuStateOf(tab),
      body: (
        <div key={tab.key} className={styles.tabBody} data-tab-body={tab.key}>
          {bodyOf(tab, group === null || desk.selected === tab.key)}
        </div>
      ),
    };
  });

  // tab 줄의 한 칸. group은 칸 하나에 leaf 순서로 붙는다.
  const entries: StripEntry[] = deskEntries(desk).map((entry) => ({
    key: entry.key,
    tabs: entry.tabs.map((tab) => {
      const stack = paneStackOf(desk, tab.key);
      return stack.length < 2
        ? stripTab(tab)
        : {
            ...stripTab(tab),
            stack: stack.flatMap((key) => {
              const item = desk.tabs.find((each) => each.key === key);
              return item === undefined ? [] : [stripTab(item)];
            }),
          };
    }),
    ...(entry.group === null
      ? {}
      : { dirs: dirsOf(entry.group.layout), focus: entry.group.focus }),
  }));

  // 이동 기록. ← →가 오가는 창 하나의 지나온 자리이고 저장하지 않는다.
  const here: Stop = {
    desk: layout.active,
    key: entryKey(desk),
    focus: desk.selected,
  };
  const [trail, setTrail] = useState<{
    readonly stops: readonly Stop[];
    readonly at: number;
  }>({ stops: [], at: -1 });
  useEffect(() => {
    if (readyWorkspace !== workspaceId) return;
    setTrail((now) => {
      const current = now.stops[now.at];
      if (current !== undefined && sameStop(current, here)) return now;
      const stops = [...now.stops.slice(0, now.at + 1), here].slice(-TRAIL_MAX);
      return { stops, at: stops.length - 1 };
    });
  }, [readyWorkspace, workspaceId, here.desk, here.key, here.focus]);
  // 지운 탭·desk의 자리는 건너뛴다.
  const reachable = (stop: Stop) => {
    const target = layout.desks[stop.desk];
    return (
      target !== undefined &&
      (stop.key === null || target.tabs.some((tab) => tab.key === stop.key))
    );
  };
  const trailTarget = (direction: -1 | 1): number => {
    for (
      let at = trail.at + direction;
      at >= 0 && at < trail.stops.length;
      at += direction
    ) {
      if (reachable(trail.stops[at]!)) return at;
    }
    return -1;
  };
  const backAt = trailTarget(-1);
  const forwardAt = trailTarget(1);
  const walk = (at: number) => {
    const stop = trail.stops[at];
    if (stop === undefined) return;
    setTrail({ stops: trail.stops, at });
    commit(
      updateDesk(
        setActiveDesk(latestLayout.current, stop.desk),
        stop.desk,
        (item) =>
          stop.key === null
            ? item
            : selectTab(
                item,
                item.tabs.some((tab) => tab.key === stop.focus)
                  ? stop.focus!
                  : stop.key,
              ),
      ),
    );
  };

  const deskOptions = [
    ...Object.values(layout.desks).map((item) => ({
      key: item.key,
      label: item.label,
      workflow: item.workflow !== undefined,
      manageable: item.key !== MAIN_DESK && item.workflow === undefined,
    })),
    // 목록에 있지만 아직 desk가 없는 workflow. 고르면 desk를 만들고 그 workflow 탭을 연다.
    ...(workflowList?.ok === true
      ? workflowList.value
          .filter((entry) => !Object.hasOwn(layout.desks, entry.name))
          .map((entry) => ({
            key: entry.name,
            label: entry.name,
            workflow: true,
          }))
      : []),
  ];
  // DeskSwitcher의 순서와 같다: 사람이 만든 desk, 그다음 workflow desk.
  const deskOrder = [
    ...deskOptions.filter((item) => !item.workflow),
    ...deskOptions.filter((item) => item.workflow),
  ];
  const requestCloseDesk = (key: string) => {
    const gone = latestLayout.current.desks[key];
    if (
      gone !== undefined &&
      key !== MAIN_DESK &&
      gone.workflow === undefined
    ) {
      setClosingDesk(key);
    }
  };
  const selectDesk = (key: string) => {
    if (Object.hasOwn(latestLayout.current.desks, key)) switchDesk(key);
    else openWorkflow(host, key);
  };
  const newDesk = () => {
    const all = latestLayout.current;
    const own = Object.values(all.desks).filter(
      (item) => item.workflow === undefined,
    ).length;
    deskCount.current += 1;
    const key = `desk-${Date.now().toString(36)}-${deskCount.current}`;
    commit(
      setActiveDesk(
        addDesk(all, key, t("shell.label.new-desk-name", { number: own + 1 })),
        key,
      ),
    );
  };

  // 앱 workspace 오른쪽 Logs panel의 이 앱 run 기록.
  const runRows = useAppRuns(
    isApp ? (appId ?? "") : null,
    sidebarAgents.agents,
    agentViewSource,
    isApp && rightOpen,
  );

  // 오른쪽 sidebar의 panel 목록. 지금 workspace 종류로 거른 내장 panel과 (사람이 끄지 않은) 앱 sidebar 화면이다.
  const sidebarKind: SidebarKind = isHome ? "home" : isApp ? "app" : "project";
  const sidebarCtx: SidebarCtx = {
    kind: sidebarKind,
    otherMachine: machine !== null,
    ...(props.jobs === undefined ? {} : { jobs: props.jobs }),
    onOpenJobs: () => openJobs(host),
    project:
      projectId === null
        ? null
        : {
            view: loaded.project,
            source,
            onOpenArtifact: (name) => openArtifact(host, name),
            onOpenWorkflow: (workflow) => openWorkflow(host, workflow),
            activeWorkflow: desk.workflow,
            explorer: {
              current:
                currentTab?.kind === "document_editor" ? currentTab.key : null,
              focusAsked: explorerFocusAsked,
              onFocusAsked: () => setExplorerFocusAsked(false),
              reveal,
              onOpenFile: (path, keep) =>
                openFile(host, path, { preview: keep !== true }),
              onMove: moveFile,
              onTrash: trashFile,
              explorerRoot: explorerRoot ?? null,
              onExplorerRoot: setExplorerRoot,
              onAddFolder: addProjectFolder,
              onRemoveFolder: removeProjectFolder,
              ...(terminal === undefined
                ? {}
                : {
                    onOpenTerminal: (cwd: string) =>
                      openTerminalTab(host, { cwd }),
                  }),
            },
          },
    home:
      sidebarKind === "home"
        ? {
            projects: props.projects,
            apps: props.apps,
            onProject: (project) =>
              props.onWorkspace?.({ kind: "project", id: project }),
            onApp: (app) => props.onOpenApp?.(app),
            onNewApp: (app) => props.onNewApp?.(app),
          }
        : null,
    app: isApp
      ? {
          runs: runRows,
          onRunSession: (session) => {
            const row = sidebarAgents.agents.find(
              (item) => item.assignment === session.agent,
            );
            if (row !== undefined) {
              openAgent(host, {
                agent: row.assignment,
                name: row.name,
                session: session.id,
              });
            }
          },
        }
      : null,
  };
  const sidebarPanels = sidebarPanelsFor(
    sidebarCtx,
    quickPrefs.sidebarPanelsOff,
    panelApps,
  );
  const activePanel =
    sidebarPanels.find((item) => item.key === panel) ?? sidebarPanels[0];
  const mainSection = (
    <div className={styles.stage}>
      <ContentCard
        panes={panes}
        {...(group === null ? {} : { layout: group.layout })}
        focus={desk.selected}
        onSplitRatio={(path, ratio) =>
          update((item) =>
            setRatio(item, leavesOf(group!.layout)[0]!, path, ratio),
          )
        }
        deskLabel={desk.label}
        // 배치를 읽기 전에는 빈 desk 안내가 잠깐 떴다 사라지지 않게 빈 card를 둔다.
        pending={readyWorkspace !== workspaceId}
        onFocus={(key) => update((item) => selectTab(item, key))}
        onCycle={(key, delta) => {
          update((item) => cyclePane(item, key, delta));
          focusTabBody(latestDesk().selected);
        }}
        onAction={runTabAction}
        // 끌어 놓은 file은 이 컴퓨터의 것이라 다른 기계의 창에서는 열 곳이 없다.
        {...(machine === null
          ? {
              onDropPath: (path: string) =>
                openFile(host, path, {
                  ...(desk.selected === null ? {} : { from: desk.selected }),
                }),
            }
          : {})}
        onEmptyAction={(action) => {
          if (action === "new-session") openLophn();
          else if (pickFile !== undefined) {
            void pickFile().then((path) => {
              if (path !== null) openFile(host, path);
            });
          }
        }}
      />
      {props.notice === undefined ? null : (
        <div className={styles.banner}>{props.notice}</div>
      )}
      {noticesHidden || !loaded.failed ? null : (
        <div className={styles.notices} data-notices="">
          <NoticeCard
            tone="error"
            data={{ "data-load-failed": "" }}
            text={t("project-workspace.error.load-failed")}
            onDismiss={hideNotices}
          />
        </div>
      )}
    </div>
  );

  // 앱 panel 화면을 연다. 새 탭이면 그 화면의 여는 자리(Settings › Quick launch)와 마지막 float 자리를 따른다.
  const launchAppPanel = (
    pin: { app: string; surface: string },
    title: string,
  ) => {
    // 같은 화면이 전역 float면 desk에 새로 열지 않고 그것을 펼쳐 맨 위로 올린다.
    const global = globalFloats.find(pin.app, pin.surface);
    if (global !== undefined) {
      globalFloats.expand(global.key);
      return;
    }
    openPinnedAppPanel(
      host,
      pin,
      title,
      quickPrefs.launch[launchKey(pin.app, pin.surface)],
    );
  };

  // 이 workspace의 빠른 실행. project가 자기 값을 두었으면 그것이고 아니면 전역 값이다.
  const quickNow = layout.quick ?? quickPrefs.quick;

  // App hover 목록: 앱 workspace의 앱 화면과 모든 앱 panel 화면. 누르면 바로 연다.
  const quickAppItems: QuickHoverItem[] = [
    ...(isApp && machine === null
      ? [
          {
            id: "app-screen",
            label: t("app-space.label.menu-app-screen"),
            leading: <AppTabIcon app={appId ?? undefined} />,
            onSelect: () => openAppScreen(host),
          },
        ]
      : []),
    ...(host.appScreens && panelApps?.ok
      ? panelChoices(panelApps.value).map((choice) => ({
          id: launchKey(choice.app, choice.screen),
          label: choice.label,
          leading: <AppTabIcon app={choice.app} />,
          onSelect: () =>
            launchAppPanel(
              { app: choice.app, surface: choice.screen },
              choice.title,
            ),
        }))
      : []),
  ];

  // Browser hover 목록: bookmark. 누르면 그 주소로 새 browser 탭이다.
  const quickBrowserItems: QuickHoverItem[] =
    bookmarkList.state === "ok"
      ? bookmarkList.bookmarks.map((item) => ({
          id: item.id,
          label: item.title,
          leading: <Favicon src={item.favicon} />,
          onSelect: () => openBrowserTab(host, item.url),
        }))
      : [];

  // 고정한 앱 panel 단추. 앱이나 화면이 없어졌으면(목록을 읽은 뒤) 그리지 않는다.
  const quickPins = host.appScreens
    ? quickNow.apps.flatMap((pin) => {
        const app = panelApps?.ok
          ? panelApps.value.find((item) => item.app === pin.app)
          : undefined;
        const screen = app?.screens.find(
          (item) => item.key === pin.surface && item.places.includes("panel"),
        );
        if (panelApps?.ok && screen === undefined) return [];
        const title = app?.name ?? t("project-workspace.label.kind-app-panel");
        return [
          {
            id: pinId(pin),
            app: pin.app,
            surface: pin.surface,
            label:
              app !== undefined && screen !== undefined
                ? t("app-panel.label.screen", {
                    app: app.name,
                    screen: screen.label,
                  })
                : title,
            onOpen: () => launchAppPanel(pin, title),
          },
        ];
      })
    : [];

  // 빠른 실행 단추 줄. 작업 표시줄이 켜져 있으면 작업 표시줄 왼쪽 끝에, 꺼져 있으면 왼쪽 sidebar 맨 아래에 그린다.
  // Terminal hover 목록은 즐겨찾기 coding agent와 이 project의 명령이다.
  const quickCoding = terminal === undefined ? [] : quickPrefs.coding.favorites;
  const quickLaunch: QuickLaunch = {
    order: shownQuickOrder(quickNow),
    pins: quickPins,
    ...(terminal === undefined
      ? {}
      : {
          onTerminal: () => openTerminalTab(host),
          terminalItems: quickCoding.map((id) => ({
            id,
            label: HARNESS_ADAPTERS[id].label,
            leading: <AgentFaceIcon face={codingFace(id)} />,
            onSelect: () => {
              const command = codingCommand(quickPrefs.coding.commands, id);
              if (command !== undefined) {
                openTerminalTab(host, { command, docked: true });
              }
            },
          })),
          terminalCommands: (layout.commands ?? []).map((item) => ({
            id: item.id,
            label: item.label,
            leading: <Icon icon={workspaceIcons.terminal} pixels={16} />,
            onSelect: () =>
              openTerminalTab(host, { command: item.command, docked: true }),
          })),
        }),
    ...(browserApi === null
      ? {}
      : {
          onBrowser: () => openBrowserTab(host),
          browserItems: quickBrowserItems,
        }),
    ...(host.appScreens ? { onApp: () => openAppPanel(host) } : {}),
    appItems: quickAppItems,
    // project의 Search 탭. 검색 통로가 없는 workspace(Home 등)는 팔레트를 연다.
    onSearch:
      source.searchSource === undefined || projectId === null
        ? openQuickFiles
        : () => openSearchShortcut(host),
  };

  // float chip은 작업 표시줄이 켜져 있으면 거기에, 꺼져 있으면 tab 줄 끝에 그린다.
  const taskbar = quickPrefs.taskbar;
  const floatChips = desk.floats.map((item) => stripTab(item.tab));
  const globalChips = globalFloats.floats.map((item) => ({
    key: item.key,
    title: t("shell.label.global-float", { title: item.title }),
    label: item.title,
    icon: iconOfTab(item.tab),
  }));
  const pressedChips = [
    ...globalFloats.floats.map((item) => ({
      key: item.key,
      minimized: item.minimized,
    })),
    ...desk.floats.map((item) => ({
      key: item.tab.key,
      minimized: item.minimized,
    })),
  ]
    .filter((item) => !item.minimized)
    .map((item) => item.key);
  const toggleDeskFloat = (key: string) =>
    update((item) =>
      item.floats.some((f) => f.tab.key === key && !f.minimized)
        ? minimizeFloat(item, key)
        : restoreFloat(item, key),
    );

  const content = (
    <ViewKeepsProvider value={keeps}>
      <WebviewHostProvider value={webviews}>
        <div
          className={styles.workspace}
          data-pooled={pool !== null ? "" : undefined}
          data-space={isHome ? "home" : isApp ? "app" : "project"}
        >
          <TabDragProvider
            describe={(key) => {
              const found = desk.tabs.find((item) => item.key === key);
              return found === undefined ? undefined : stripTab(found);
            }}
            state={(item, hit) => tabDropState(desk, item, hit)}
            onDrop={(item, hit) => update((d) => applyTabDrop(d, item, hit))}
          >
            <ShellFrame
              left={leftOpen}
              onToggleLeft={() => setLeftOpen(!leftOpen)}
              right={rightOpen}
              onToggleRight={() => setRightOpen(!rightOpen)}
              machineSwitcher={
                <MachineSwitcher onPairAnother={() => onSettings("remote")} />
              }
              deskSwitcher={
                projectId === null ? undefined : (
                  <DeskSwitcher
                    desks={deskOptions}
                    current={layout.active}
                    onSelect={selectDesk}
                    onNewDesk={newDesk}
                    onRename={(key, label) =>
                      commit(renameDesk(latestLayout.current, key, label))
                    }
                    onDelete={requestCloseDesk}
                    renameAsk={deskRenameAsk}
                  />
                )
              }
              tabs={
                <TabStrip
                  entries={entries}
                  selected={entryKey(desk)}
                  minimized={taskbar ? [] : floatChips}
                  globalFloats={taskbar ? [] : globalChips}
                  floating={pressedChips}
                  onToggleGlobalFloat={globalFloats.toggle}
                  onSelect={(key) => {
                    update((item) => selectTab(item, key));
                    focusTabBody(key);
                  }}
                  onClose={close}
                  onMenu={(key, at) => setTabMenu({ key, ...at })}
                  onPin={(key) => update((item) => pinTab(item, key))}
                  renaming={renaming}
                  onRenaming={setRenaming}
                  onRename={(key, name) => {
                    const tab = desk.tabs.find((item) => item.key === key);
                    if (tab !== undefined) {
                      tabKindOf(tab.kind)?.rename?.(tab, name, host);
                    }
                  }}
                  onToggleFloat={toggleDeskFloat}
                  newTab={
                    <NewTabMenu
                      {...(pickFile === undefined
                        ? {}
                        : {
                            onDocument: () =>
                              void pickFile().then((path) => {
                                if (path !== null) openFile(host, path);
                              }),
                          })}
                      {...(terminal === undefined
                        ? {}
                        : { onTerminal: () => openTerminalTab(host) })}
                      {...(browserApi === null
                        ? {}
                        : {
                            onBrowser: () => openBrowserTab(host),
                            browserItems: quickBrowserItems,
                          })}
                      {...(agentView === null
                        ? {}
                        : {
                            choices: agentChoiceList,
                            onChoice: startChoice,
                          })}
                      {...(agents === null || machine !== null
                        ? {}
                        : { onAgents: () => openAgents(host) })}
                      {...(source.searchSource === undefined ||
                      projectId === null
                        ? {}
                        : { onSearch: () => openSearchShortcut(host) })}
                      {...(isApp && machine === null
                        ? { onAppScreen: () => openAppScreen(host) }
                        : {})}
                      {...(host.appScreens
                        ? {
                            onAppPanel: () => openAppPanel(host),
                            appItems: quickAppItems.filter(
                              (item) => item.id !== "app-screen",
                            ),
                          }
                        : {})}
                    />
                  }
                />
              }
              panelTabs={
                <PanelTabs
                  tabs={sidebarPanels}
                  selected={activePanel?.key ?? ""}
                  onSelect={setPanel}
                />
              }
              leftSidebar={
                <WorkspaceLeftSidebar
                  workspace={workspace}
                  source={source}
                  projects={props.projects}
                  apps={props.apps}
                  agentViewSource={agentViewSource}
                  sessionTitles={sessionTitles}
                  agents={sidebarAgents.agents}
                  lophnNames={sidebarAgents.lophnNames}
                  layoutReady={readyWorkspace === workspaceId}
                  openTitles={agentTabTitles}
                  desks={sidebarDesks}
                  agentDrafts={agentDrafts}
                  terminals={panelTerminals}
                  {...(windowTerminal === undefined
                    ? {}
                    : { terminal: windowTerminal })}
                  selected={selectedSessionKey}
                  canTerminal={terminal !== undefined}
                  {...(layout.commands === undefined
                    ? {}
                    : { commands: layout.commands })}
                  onNewSession={() => void openLophn()}
                  {...(props.onNewSessionAt === undefined
                    ? {}
                    : { onNewSessionAt: props.onNewSessionAt })}
                  onNewChoice={startChoice}
                  onNewCoding={(command) =>
                    openTerminalTab(host, { command, docked: true })
                  }
                  onOpenHere={(session, agent) => {
                    const row = sidebarAgents.agents.find(
                      (item) => item.assignment === agent,
                    );
                    if (row !== undefined) {
                      openAgent(host, {
                        agent: row.assignment,
                        name: row.name,
                        session,
                      });
                    }
                  }}
                  onTerminal={(item) => {
                    if (item.live !== null) {
                      terminal?.store.select(item.live.tabKey);
                    } else if (item.saved !== null) {
                      openTerminalTab(host, {
                        folderRef: item.saved.folderRef,
                        ...(item.saved.resumable
                          ? {
                              resume: {
                                harness: item.harness,
                                external_session: item.saved.externalSession,
                              },
                            }
                          : {}),
                      });
                    }
                  }}
                  onWorkflow={selectDesk}
                  onTab={revealTab}
                  onRenameTab={(item, title) => {
                    const tab = sidebarTabOf(item);
                    if (tab === undefined) return false;
                    tabKindOf(tab.kind)?.rename?.(tab, title, host);
                    return true;
                  }}
                  onCloseTab={(item) => {
                    const tab = sidebarTabOf(item);
                    if (tab !== undefined) close(tab.key);
                  }}
                  onOpenSession={(session) =>
                    runToastAction({ kind: "session", session })
                  }
                  onWorkspace={(ref) =>
                    ref.kind === "home" ? onHome() : props.onWorkspace?.(ref)
                  }
                  onWorkspaceRow={(ref) => {
                    // 앱 줄은 앱 화면으로 간다. 이 앱이면 앱 화면 탭을 열거나 고른다. 다른 기계의 창은 앱 workspace로만 간다.
                    if (ref.kind === "home") onHome();
                    else if (ref.kind === "app" && machine !== null) {
                      props.onWorkspace?.(ref);
                    } else if (
                      ref.kind === "app" &&
                      isApp &&
                      ref.id === appId
                    ) {
                      openAppScreen(host);
                    } else if (
                      ref.kind === "app" &&
                      props.onAppScreenAt !== undefined
                    ) {
                      props.onAppScreenAt(ref.id);
                    } else props.onWorkspace?.(ref);
                  }}
                  onNewApp={(app) => props.onNewApp?.(app)}
                  {...(openSettingsHere === undefined &&
                  onSettingsAt === undefined
                    ? {}
                    : {
                        onWorkspaceSettings: (ref: WorkspaceRef) =>
                          workspaceKey(ref) === workspaceKey(workspace)
                            ? openSettingsHere?.()
                            : onSettingsAt?.(ref),
                      })}
                  {...(taskbar ? {} : { quick: quickLaunch })}
                  jobs={props.jobs}
                  onInbox={() => openInbox(host)}
                  onJobs={() => openJobs(host)}
                  {...(machine === null
                    ? { onAgents: () => openAgents(host) }
                    : {})}
                  {...(taskbar ? {} : { onSettings: () => onSettings() })}
                />
              }
              tray={
                taskbar || machine !== null
                  ? undefined
                  : (side) => (
                      <TrayHost
                        off={quickPrefs.trayOff}
                        order={quickPrefs.trayOrder}
                        screens={panelApps}
                        side={side}
                      />
                    )
              }
              rightSidebar={activePanel?.render(sidebarCtx)}
              taskbarStart={
                taskbar ? <QuickLaunchRow quick={quickLaunch} /> : undefined
              }
              taskbar={
                taskbar ? (
                  <Taskbar
                    globalFloats={globalChips}
                    floats={floatChips}
                    floating={pressedChips}
                    onToggleGlobalFloat={globalFloats.toggle}
                    onToggleFloat={toggleDeskFloat}
                    onSettings={() => onSettings()}
                    tray={
                      machine !== null ? undefined : (
                        <TrayHost
                          off={quickPrefs.trayOff}
                          order={quickPrefs.trayOrder}
                          screens={panelApps}
                          side="above"
                        />
                      )
                    }
                  />
                ) : undefined
              }
              floats={
                <>
                  {pool === null ? <WebviewLayer host={webviews} /> : null}
                  <div hidden data-host-hidden="">
                    {hiddenHostTabs.map((tab) => (
                      <div key={tab.key}>{bodyOf(tab, false)}</div>
                    ))}
                  </div>
                  <FloatLayer
                    layerRef={floatRef}
                    area={stageSize}
                    floats={desk.floats
                      .filter((item) => !item.minimized)
                      .map((item) => ({
                        key: item.tab.key,
                        title: item.tab.title,
                        icon: iconOfTab(item.tab),
                        dot: tabKindOf(item.tab.kind)?.dotOf?.(item.tab, host),
                        rect: item.rect,
                        pinned: item.pinned,
                        ...(globalFloats.enabled && canGoGlobal(item.tab)
                          ? { global: false }
                          : {}),
                        ...(item.tab.kind === "app_panel"
                          ? { appHead: true }
                          : {}),
                        body: bodyOf(item.tab, true),
                      }))}
                    onRaise={(key) => update((item) => restoreFloat(item, key))}
                    onRect={(key, rect) => {
                      update((item) => setFloatRect(item, key, rect));
                      rememberFloatRect(key, rect);
                    }}
                    onMinimize={(key) =>
                      update((item) => minimizeFloat(item, key))
                    }
                    onDock={(key) => {
                      update((item) => dockFloat(item, key));
                      focusTabBody(key);
                    }}
                    onGlobal={floatToGlobal}
                    onClose={close}
                    onPin={(key, pinned) =>
                      update((item) => pinFloat(item, key, pinned))
                    }
                    onOutside={(inside) =>
                      update((item) => minimizeLooseFloats(item, inside))
                    }
                  />
                </>
              }
            >
              {mainSection}
            </ShellFrame>
          </TabDragProvider>
          {closingDesk === null ||
          latestLayout.current.desks[closingDesk] === undefined ? null : (
            <DeskCloseDialog
              label={latestLayout.current.desks[closingDesk]!.label}
              summary={closeSummary(latestLayout.current.desks[closingDesk]!)}
              onCancel={() => setClosingDesk(null)}
              onConfirm={() => {
                setClosingDesk(null);
                void finishDesk(closingDesk);
              }}
            />
          )}
          {closingTabs === null ? null : (
            <TabsCloseDialog
              count={closingTabs.keys.length}
              terminals={closingTabs.terminals}
              lost={closingTabs.lost}
              onCancel={() => setClosingTabs(null)}
              onConfirm={() => {
                setClosingTabs(null);
                void finishMany(
                  closingTabs.keys,
                  closingTabs.lost.map((row) => row.key),
                );
              }}
            />
          )}
          {tabMenu === null || menuTab === undefined ? null : (
            <TabContextMenu
              at={tabMenu}
              state={menuStateOf(menuTab)}
              onSelect={(action) => runTabAction(action, menuTab.key)}
              onClose={() => setTabMenu(null)}
            />
          )}
        </div>
      </WebviewHostProvider>
    </ViewKeepsProvider>
  );
  return (
    <InboxNamesProvider value={inboxNames}>
      <AppWorkspaceProvider
        workspace={workspace}
        folders={(loaded.project?.folders ?? []).map((folder) => folder.path)}
      >
        {workspaceViews === null
          ? content
          : createPortal(content, workspaceViews.context)}
      </AppWorkspaceProvider>
    </InboxNamesProvider>
  );
}
