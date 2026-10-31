import { Tooltip } from "@lophn/ui/overlay";
import { Icon, IconButton } from "@lophn/ui/primitives";
import { iconPixels, useObservedSize } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { LOPHN_AGENT_ID } from "../../../protocol/lophn-agent/places.ts";
import {
  type DetachedEvent,
  type LophnDetachedApi,
  slimDetachedTab,
} from "../../ipc/detached.ts";
import { type Command, KEYBINDINGS } from "../../ipc/keybindings.ts";
import { ViewKeepsProvider } from "../app-frame/embedded-view.tsx";
import { useBookmarks } from "../browser/bookmarks.ts";
import { useBrowserApi } from "../browser/browser-api.tsx";
import {
  WebviewHostProvider,
  WebviewLayer,
} from "../app-frame/webview-host.tsx";
import type { AgentTabSourceFactory } from "../conversation/agent-tab-source.ts";
import { runToastAction } from "../desktop/connection/toasts/toast-actions.ts";
import { WaitingLayer } from "../desktop/connection/waiting/waiting-layer.tsx";
import {
  PaletteButton,
  useOpenPalette,
  usePaletteEnv,
  usePaletteScope,
} from "../desktop/palette/host.tsx";
import type { CatalogSource } from "../desktop/palette/catalog.ts";
import {
  focusTab,
  topFloat,
  workspaceScope,
} from "../desktop/palette/workspace-scope.ts";
import type { JobsSource } from "../desktop/settings/jobs/source.ts";
import type { SettingsPane } from "../desktop/settings/model.ts";
import { TopBar } from "../desktop/top-bar/top-bar.tsx";
import type { EditorDeps } from "../editor/document-view.tsx";
import { workspaceIcons } from "../icons/mod.ts";
import { windowInstructions } from "./agents/core-extensions.ts";
import {
  TAB_MIME,
  type TabItem as StripTab,
} from "../parts/tab-strip/tab-strip.tsx";
import type { TerminalDeps } from "../terminal/deps.ts";
import {
  openBridgeUrl,
  useBridgeOpenRequests,
} from "../terminal/use-bridge-open-requests.ts";
import { NewTabMenu } from "./add-tab-menu.tsx";
import { agentOf, sessionOf } from "./agent/tab-fields.ts";
import { startPointerDrag } from "./drag.ts";
import { Floats } from "./floats/floats.tsx";
import { distinctAgentTab, openAgent } from "./kinds/agent.tsx";
import { openAgents } from "./kinds/agents.tsx";
import { openAppPanel } from "./kinds/app-panel.tsx";
import { openArtifact } from "./kinds/artifact.tsx";
import { openBrowserTab } from "./kinds/browser.tsx";
import { openFile } from "./kinds/document-editor.tsx";
import type { TabHost } from "./kinds/host.ts";
import { tabKindOf } from "./kinds/registry.ts";
import { openSearchShortcut } from "./kinds/search.tsx";
import {
  openTerminal as openTerminalTab,
  terminalTabTitle,
} from "./kinds/terminal.tsx";
import { openWorkflow, workflowTab } from "./kinds/workflow.tsx";
import { LauncherButton } from "./launcher-button.tsx";
import { desksFromStored, toStoredLayout } from "./layout-map.ts";
import { MinimizedBar } from "./minimized/minimized-bar.tsx";
import {
  activeView,
  allDeskTabs,
  applyDrag,
  attachDetached,
  type CloseScope,
  clampSidebar,
  closeDetached,
  closeFloat,
  closeTab,
  closeTargets,
  DEFAULT_DESK,
  deskOfTab,
  desksFromView,
  detachTab,
  dockTab,
  emptyView,
  findTab,
  floatTab,
  isDetached,
  dropTabOnPane,
  isFloated,
  mapDeskTabs,
  mapTabs,
  mergeDeskIntoDefault,
  minimizeFloat,
  minimizeTab,
  moveTab,
  moveTabBy,
  openAcrossDesks,
  openDetachedTab,
  openFloat,
  openTabIn,
  pinTab,
  raiseFloat,
  reopenTab,
  restoreFloat,
  SIDEBAR_WIDTH,
  type SidebarState,
  setActiveView,
  setDeskView,
  setFloatRect,
  shiftTab,
  sidebarView,
  splitTab,
  stepTab,
  switchDesk,
  type TabItem,
  vanishedDesks,
  type WorkspaceDesks,
  type WorkspaceView,
} from "./model.ts";
import { setRatio } from "./layout-tree.ts";
import { NoticeCard } from "./notice-card.tsx";
import { Panes } from "./panes/panes.tsx";
import { openProjectLophn } from "./reactions/project-lophn.ts";
import { useToastHandler } from "./reactions/toast-handler.ts";
import type { RailAction } from "./sidebar/activity-bar.tsx";
import { ArtifactPanel } from "./sidebar/artifact-panel.tsx";
import type { TabAwareResult } from "./sidebar/explorer.tsx";
import {
  type KnownSessions,
  panelRuns,
  panelSessions,
  runOpenedSessions,
} from "./sidebar/panel-sessions.ts";
import { ProjectSidebar } from "./sidebar/project-sidebar.tsx";
import type { RunRecordView } from "./sidebar/run-list.tsx";
import { usePanelTerminals } from "./sidebar/use-panel-terminals.ts";
import type {
  FileRow,
  ProjectView,
  ReadResult,
  WorkflowEntryView,
  WorkspaceSource,
} from "./source.ts";
import { DeskSelector, PathSep } from "./top-path/desk-selector.tsx";
import { PlaceSwitcher } from "./top-path/place-selector.tsx";
import {
  type PlaceRef,
  readRecentPlaces,
  rememberPlace,
} from "./top-path/recent-places.ts";
import { usePlaceLists } from "./top-path/use-place-lists.ts";
import { focusPaneBody } from "./focus-pane.ts";
import { useCommands, useWindowCommands } from "../commands/react.tsx";
import { useTabHostSlices } from "./use-tab-host-slices.ts";
import styles from "./workspace.module.css";

export interface WorkspaceProps {
  projectId: string;
  source: WorkspaceSource;
  /** 창 폭. 테스트가 고정하고 화면은 관측값을 넘긴다. */
  windowWidth: number;
  /** 런처로 돌아간다. */
  onLauncher: () => void;
  /** 상단 바 place switcher에서 고른 place를 이 창에서 연다. 없으면 지금 project 하나만 보인다. */
  onOpenPlace?: (place: PlaceRef) => void;
  /** switcher의 project·app 목록. 없으면 지금 project 하나만 보인다. */
  places?: CatalogSource;
  /** Settings로 간다. 항목을 주면 그 항목부터 연다. */
  onSettings: (pane?: SettingsPane) => void;
  /** sidebar Scheduled jobs 탭의 통로. 없으면 그 항목을 두지 않는다. */
  jobs?: JobsSource;
  /** 파일 탭의 읽기·편집 통로. 없으면 파일 탭은 자리표시다. */
  editor?: EditorDeps;
  /** 터미널 탭 통로. 없으면 터미널 열기 항목을 두지 않는다. */
  terminal?: TerminalDeps;
  /** detached 창 통로. 없으면 Detach 항목과 단추를 두지 않는다. */
  detached?: LophnDetachedApi;
  /** 앱 공간으로 연다. 없으면 패널을 못 여는 앱에는 안내 글만 둔다. */
  onOpenApp?: (app: string) => void;
  /**
   * Agent 탭이 agent 하나의 통로를 얻는 함수(agentViewSource). 없으면
   * Agent 탭을 열지 않고 저장된 Agent 탭은 준비되지 않았다는 안내만 보인다. WorkspaceSource에 두지 않는 까닭: source.ts는 core 통로를 부르는 순수 `.ts`
   * 모듈들이 type으로 읽는데 이 type은 화면 부품(`.tsx`)의 view 값을 끌고 와 그 모듈들의 시험이 css import에서
   * 막힌다. core 구현(agent-tab-core-source.ts의 factory)은 entry(`.tsx`)가 여기에 넘긴다.
   */
  agentViewSource?: AgentTabSourceFactory;
  /** 처음 열 때 한 번 열 session(다른 project의 session toast). */
  session?: string;
  /** 처음 열 때 한 번 이 project place의 lophn을 연다. */
  startLophn?: true;
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
// 작업대가 주인인 command id. 단축키 표에 있는 것 모두다.
const WORKSPACE_COMMANDS: readonly Command[] = [
  ...new Set(KEYBINDINGS.map((binding) => binding.command)),
];

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

// 프로젝트 작업대. sidebar·상단 경로·탭 줄·두 칸을 한 화면에 모은다.
export function Workspace(props: WorkspaceProps) {
  const { projectId, source, windowWidth, onLauncher, onSettings, terminal } =
    props;
  const browserApi = useBrowserApi();
  const bookmarkList = useBookmarks();
  // Agent 탭의 통로. 없으면 Agent 탭을 열지 않는다.
  const agentViewSource = props.agentViewSource;
  const [loaded, setLoaded] = useState<Loaded>(EMPTY_LOADED);
  // Explorer가 보이는 연결 폴더. 화면 상태일 뿐이라 저장하지 않는다. 터미널도 이 폴더에서 열린다.
  const [explorerRoot, setExplorerRoot] = useState<string | undefined>();
  const {
    domains,
    sidebarAgents,
    sessionStates,
    agentView,
    agents,
    appViews,
    keeps,
    webviews,
  } = useTabHostSlices({
    project: projectId,
    source,
    agentViewSource,
    terminalStore: terminal?.store,
    host: () => host,
    onSettings,
  });
  // sidebar session 줄의 제목과 시각. session store는 싣지 않아 agent마다 대화 source의 session 목록에서 읽는다.
  const [knownSessions, setKnownSessions] = useState<KnownSessions>(new Map());
  const sessionIds = sessionStates.map((entry) => entry.session).join();
  useEffect(() => {
    if (agentViewSource === undefined) return;
    let live = true;
    void Promise.all(
      sidebarAgents.agents.map(async (row) => {
        const read = await agentViewSource({
          assignment: row.assignment,
          place: { kind: "project", id: projectId },
        }).sessions();
        return read.ok ? read.value : [];
      }),
    ).then((lists) => {
      if (!live) return;
      setKnownSessions(
        new Map(
          lists.flat().map((entry) => [
            entry.id,
            {
              title: entry.title,
              at: Date.parse(entry.activeAt) || 0,
            },
          ]),
        ),
      );
    });
    return () => {
      live = false;
    };
  }, [agentViewSource, sidebarAgents.agents, projectId, sessionIds]);
  // sidebar의 Background 묶음. run event가 계약에 없어서 처음과 session 상태가 바뀔 때마다 다시 읽는다.
  // 이 project place에서 돈 run이다. home의 run은 런처 lophn 패널의 것이다.
  const [runRecords, setRunRecords] = useState<readonly RunRecordView[]>([]);
  useEffect(() => {
    let live = true;
    void source.runs({ place: { project: projectId } }).then((inProject) => {
      if (!live) return;
      // 실패하면 앞 값을 둔다.
      if (!inProject.ok) return;
      setRunRecords(
        [...inProject.value].sort(
          (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at),
        ),
      );
    });
    return () => {
      live = false;
    };
  }, [source, projectId, sessionStates]);
  // 배치를 다 읽은 project. 시작 route는 이 project의 배치가 선 뒤에 연다.
  const [readyProject, setReadyProject] = useState<string | null>(null);
  // 상단 바 selector의 목록. null은 아직 안 읽었거나 읽는 중이다. 실패와 읽는 중에는 합치지 않는다.
  const [workflowList, setWorkflowList] = useState<ReadResult<
    readonly WorkflowEntryView[]
  > | null>(null);
  // 상단 바 place switcher의 목록과 최근 연 place. 최근 목록은 menu를 열 때마다 다시 읽는다.
  const placeLists = usePlaceLists(props.places);
  const [recentPlaces, setRecentPlaces] = useState(readRecentPlaces);
  // 자리(desk)마다 view 하나. 화면이 그리고 고치는 것은 보이는 자리의 view뿐이다.
  const [desks, setDesks] = useState(() => desksFromView(emptyView()));
  const view = activeView(desks);
  const [sidebar, setSidebar] = useState<SidebarState>({
    chosenWidth: SIDEBAR_WIDTH,
    collapsedByUser: false,
  });
  const [userChoseWidth, setUserChoseWidth] = useState(false);
  // 떠 있는 안내(읽기 실패)를 닫은 상태. 상단 바의 안내 단추가 다시 연다.
  const [noticesHidden, setNoticesHidden] = useState(false);
  const hideNotices = () => setNoticesHidden(true);
  const hasNotices = loaded.failed;
  const frameRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const frameSize = useObservedSize(frameRef);
  const mainSize = useObservedSize(mainRef);
  const measuredWindow = frameSize?.width ?? windowWidth;

  useEffect(() => {
    let live = true;
    const load = async () => {
      const [project, layout, files] = await Promise.all([
        source.project(projectId),
        source.readLayout(projectId),
        source.files(projectId),
      ]);
      if (!live) return;
      setLoaded({
        project: project.ok ? project.value : null,
        // 파일 목록은 팔레트만 쓴다. 읽지 못해도 작업대는 그대로 연다.
        files: files.ok ? files.value : [],
        failed: !project.ok,
      });
      if (layout.ok && layout.available) {
        const restoredDesks = desksFromStored(layout.layout);
        if (restoredDesks) {
          const restored = activeView(restoredDesks);
          latestDesks.current = restoredDesks;
          latest.current = restored;
          setDesks(restoredDesks);
          setFloatFocused(false);
          // 보이는 자리의 detached 창만 연다. 다른 자리의 것은 그 자리로 갈 때 syncDetached가 연다.
          // 거절은 무시한다. conflict는 이미 떠 있는 것이고 나머지는 탭이 layout의 detached로 남는다.
          // transfer가 없어 terminal은 PTY에 다시 붙지 못한다(재시작과 같다).
          for (const item of restored.detached) {
            void props.detached
              ?.open({
                project: projectId,
                tab: item.tab,
                transfer: null,
                bounds: item.bounds,
              })
              .catch(() => {});
          }
        }
      }
      setReadyProject(projectId);
    };
    void load();
    return () => {
      live = false;
    };
  }, [projectId, source]);

  const sidebarShown = sidebarView(measuredWindow, sidebar, userChoseWidth);
  // 목록을 못 읽었거나 읽는 중이면 기본 자리와 layout에 이미 있는 workflow 자리만 보인다.
  const deskOptions = [
    { key: DEFAULT_DESK, label: t("project-workspace.label.desk-default") },
    ...(workflowList?.ok === true
      ? workflowList.value.map((entry) => ({
          key: entry.name,
          label: entry.name,
          invalid: entry.invalid,
        }))
      : Object.keys(desks.desks)
          .filter((key) => key !== DEFAULT_DESK)
          .map((key) => ({ key, label: key }))),
  ];
  const focused = view.panes[view.focusedPane];

  // 비동기 닫기·시작 결과는 그 사이 바뀐 배치에 적용한다.
  const latestDesks = useRef(desks);
  latestDesks.current = desks;
  const latest = useRef(view);
  latest.current = view;
  // 저장 안 된 변경이 있는 탭. 탭 줄의 ●와 preview 탭 보호가 같은 session을 본다.
  const editorSessions = props.editor?.sessions;
  const isUnsaved = (key: string) => editorSessions?.isUnsettled(key) ?? false;
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

  const persist = (next: WorkspaceDesks) => {
    void source.saveLayout(
      toStoredLayout({
        project: projectId,
        desks: mapDeskTabs(next, withPosition),
      }),
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
      persistRef.current(latestDesks.current);
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
      persistRef.current(latestDesks.current);
    },
    [],
  );

  // layout에서 사라진 탭의 view를 닫는다. 탭을 닫는 길이 여럿이라 길마다 닫지 않고 차이로 본다.
  // <webview>는 모든 desk의 탭이 사는 동안(보이지 않는 desk 포함) 그대로 두어 desk를 오가도 page가
  // 다시 load되지 않는다. 놓는 것은 탭 key가 layout에서 사라졌을 때뿐이다.
  const webviewTabKeys = useRef<Set<string>>(new Set());
  // 다른 창으로 넘긴 view(main이 소유를 옮긴 browser popup native view)는 여기서 닫지 않는다.
  const transferredViews = useRef<Set<string>>(new Set());
  useEffect(() => {
    const deskViews = Object.values(desks.desks);
    const detached = new Set(
      deskViews.flatMap((desk) => desk.detached.map((item) => item.tab.key)),
    );
    // 다른 자리의 탭도 layout에 있는 동안은 산다. 자리를 건너가도 app panel의 view가 이어진다.
    // detached 탭의 <webview>는 그 창이 갖는다. 여기 남기면 page가 두 창에 산다. 앱·artifact view는
    // 넘어가지 않으므로(받는 창이 다시 연다) detached가 되면 보내는 창이 닫는다.
    const allKeys = new Set(allDeskTabs(desks).map((tab) => tab.key));
    for (const key of keeps.keys()) {
      const session = keeps.lookup<{ view_session: string }>(key)?.session;
      if (
        !allKeys.has(key) ||
        (detached.has(key) &&
          (session === undefined || !transferredViews.current.has(session)))
      ) {
        keeps.release(key);
      }
    }
    const live = new Set([...allKeys].filter((key) => !detached.has(key)));
    const previous = webviewTabKeys.current;
    for (const key of webviews.keys()) {
      // 앱 view_session처럼 탭 key가 아닌 자리(card·앱 공간)는 그 화면이 닫을 때 놓는다.
      if (previous.has(key) && !live.has(key)) webviews.release(key);
    }
    webviewTabKeys.current = live;
    const terminals = new Set(
      deskViews
        .flatMap((desk) => [
          ...desk.panes.flatMap((pane) => pane.tabs),
          ...desk.floats.map((float) => float.tab),
        ])
        .filter((tab) => tab.kind === "terminal")
        .map((tab) => tab.key),
    );
    props.terminal?.displays.retain(projectId, terminals);
  }, [desks, keeps, webviews, props.terminal, projectId]);
  useEffect(
    () => () => props.terminal?.displays.retain(projectId, new Set()),
    [props.terminal, projectId],
  );
  // 떠나면 남은 것을 모두 닫는다. 자식의 cleanup이 부모 뒤에 보관하므로 한 틱 미룬다.
  useEffect(
    () => () => {
      queueMicrotask(() => {
        for (const key of keeps.keys()) keeps.release(key);
      });
    },
    [keeps],
  );

  // detached 창을 보이는 자리에 맞춘다. 창이 없는 key(다른 자리에 있다가 지금 보이게 된 것)는 연다.
  const syncDetached = (next: WorkspaceDesks) => {
    const api = props.detached;
    if (api === undefined) return;
    const items = activeView(next).detached;
    void api
      .showOnly({ keys: items.map((item) => item.tab.key) })
      .then(({ missing }) => {
        for (const key of missing) {
          const item = items.find((candidate) => candidate.tab.key === key);
          if (item === undefined) continue;
          // 거절은 무시한다. 복원과 같다.
          void api
            .open({
              project: projectId,
              tab: slimDetachedTab(item.tab),
              transfer: null,
              bounds: item.bounds,
            })
            .catch(() => {});
        }
      })
      .catch(() => {});
  };

  // 자리 state를 바꾸는 유일한 길이다. latest(보이는 자리의 view)도 같이 맞춘다.
  const commit = (next: WorkspaceDesks, save = true, sync = false) => {
    const switched = next.active !== latestDesks.current.active;
    latestDesks.current = next;
    latest.current = activeView(next);
    setDesks(next);
    if (save) persist(next);
    if (switched || sync) syncDetached(next);
  };
  const update = (next: WorkspaceView) =>
    commit(setActiveView(latestDesks.current, next));
  // 보이는 자리가 아닐 수 있는 자리의 view를 바꾼다.
  const updateAt = (at: string, next: WorkspaceView) =>
    commit(setDeskView(latestDesks.current, at, next));
  const updateRef = useRef(update);
  updateRef.current = update;

  // 저장된 agent 탭은 제목 없이 되살아나고, 본문을 그린 탭만 이름을 채운다. 작업대가 다시 열리면(Settings나 런처에
  // 다녀오거나 연결이 잠깐 끊기면) 고르지 않은 탭의 이름이 비므로 agent 목록의 이름으로 채운다.
  useEffect(() => {
    const nameOf = (tab: TabItem) =>
      tab.kind === "agent" && tab.title === ""
        ? sidebarAgents.agents.find((row) => row.assignment === agentOf(tab))
            ?.name
        : undefined;
    if (!allDeskTabs(desks).some((tab) => nameOf(tab) !== undefined)) return;
    commit(
      mapDeskTabs(latestDesks.current, (tab) => {
        const name = nameOf(tab);
        return name === undefined ? tab : { ...tab, title: name };
      }),
      false,
    );
  }, [desks, sidebarAgents.agents]);

  // focus가 맨 위 floated 패널에 있는지. 저장하지 않는다. 늘 한 곳(칸 또는 패널)만 focus 색이고
  // 접히지 않은 패널이 없으면 칸이다.
  const [floatFocused, setFloatFocused] = useState(false);
  const inFloats = floatFocused && topFloat(view) !== undefined;
  // 탭을 titlebar 위로 끄는 중이다. 놓으면 최소화된다.
  const [topDrop, setTopDrop] = useState(false);
  // 맨 위 패널이 접히거나 닫히면 focus는 칸으로 돌아간다.
  const leaveTopFloat = (key: string) => {
    if (topFloat(latest.current)?.tab.key !== key) return;
    setFloatFocused(false);
    focusPaneBody(latest.current.focusedPane);
  };

  // 자리를 바꾼다. 없는 자리면 seed로 만든다. 저장과 detached 창 맞추기는 commit이 한다.
  const switchTo = (key: string, seed: WorkspaceView) => {
    commit(switchDesk(latestDesks.current, key, seed));
    setFloatFocused(false);
  };

  // 사라진 workflow의 자리를 default로 합친다. 합치며 docked가 된 detached 탭의 창은 닫는다.
  const mergeVanished = (liveKeys: readonly string[]) => {
    const current = latestDesks.current;
    const gone = vanishedDesks(current, liveKeys);
    if (gone.length === 0) return;
    const next = gone.reduce(mergeDeskIntoDefault, current);
    const detachedKeys = (from: WorkspaceDesks) =>
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

  // selector 목록을 읽는다. project를 연 직후와 selector를 열 때 부른다. 사라진 자리는 읽기에 성공한
  // 목록으로만 합친다(실패나 읽는 중에 합치면 자리의 탭이 모두 기본 자리로 옮겨진다).
  const shownProject = useRef(projectId);
  shownProject.current = projectId;
  const readLists = () => {
    const mine = projectId;
    void source.workflows(mine).then((result) => {
      if (shownProject.current !== mine) return;
      setWorkflowList(result);
      if (result.ok) mergeVanished(result.value.map((entry) => entry.name));
    });
    placeLists.read();
    setRecentPlaces(readRecentPlaces());
  };
  const readListsOnOpen = (open: boolean) => {
    if (open) readLists();
  };
  useEffect(() => {
    setWorkflowList(null);
    if (readyProject === projectId) readLists();
  }, [projectId, source, readyProject]);

  // 파일을 고치면(저장 상태가 바뀌면) 그 preview 탭을 고정한다. 저장 안 된 탭이 preview로 사라지지 않게
  // 하는 첫 번째 장치이고, 두 번째는 openTabIn이 저장 안 된 preview 탭을 바꿔 쓰지 않는 것이다.
  useEffect(() => {
    if (editorSessions === undefined) return;
    return editorSessions.onUnsettledChange(() => {
      redrawUnsaved();
      let next = latest.current;
      for (const pane of next.panes) {
        for (const tab of pane.tabs) {
          if (tab.preview && editorSessions.isUnsettled(tab.key)) {
            next = pinTab(next, tab.key);
          }
        }
      }
      if (next !== latest.current) updateRef.current(next);
    });
  }, [editorSessions]);

  // 비동기 확인 뒤에는 그 사이 바뀐 배치에서 그 탭을 뺀다.
  const removeTab = (key: string) => {
    const at = deskOfTab(latestDesks.current, key);
    if (at === undefined) return;
    const current = latestDesks.current.desks[at]!;
    if (isDetached(current, key)) {
      void props.detached?.close({ key }).catch(() => {});
      updateAt(at, closeDetached(current, key));
      return;
    }
    if (isFloated(current, key)) {
      if (at === latestDesks.current.active) leaveTopFloat(key);
      updateAt(at, closeFloat(current, key));
      return;
    }
    const pane = current.panes.findIndex((item) =>
      item.tabs.some((candidate) => candidate.key === key),
    );
    updateAt(at, closeTab(current, pane, key));
  };

  // focus 칸 끝에 붙이고 고른다. 같은 key가 어느 칸에 있으면 새로 붙이지 않고 그 칸에서 고른다
  // (탭 key는 작업대 안에서 유일하다). preview 탭은 그 칸의 preview 자리를 바꿔 쓴다(openTabIn).
  // `select: false`면 붙이기만 하고 보던 탭을 그대로 둔다.
  const openTab: TabHost["openTab"] = (tab, options) => {
    // 사는 자리가 있는 탭(workflow)은 그 자리로 건너가서 연다. 이미 어느 자리에 열려 있으면 아래가 그 자리로 간다.
    const home = tabKindOf(tab.kind)?.homeDesk?.(tab);
    if (
      home !== undefined &&
      home !== latestDesks.current.active &&
      options?.select !== false &&
      deskOfTab(latestDesks.current, tab.key) === undefined
    ) {
      switchTo(
        home,
        openTabIn(emptyView(), tab, () => false),
      );
    }
    const all = latestDesks.current;
    const at = deskOfTab(all, tab.key);
    // detached 탭은 그 창을 앞으로 가져올 뿐 붙이지 않는다. 다른 자리의 것이면 그 자리로 건너간다.
    if (at !== undefined && isDetached(all.desks[at]!, tab.key)) {
      if (at !== all.active) commit(switchDesk(all, at, emptyView()));
      void props.detached?.focus({ key: tab.key }).catch(() => {});
      return;
    }
    const select = options?.select !== false;
    if (!select) {
      if (at !== undefined) return;
      const current = latest.current;
      const target = current.focusedPane;
      update({
        ...current,
        panes: current.panes.map((item, index) =>
          index === target
            ? {
                tabs: [...item.tabs, tab],
                selected: item.selected ?? tab.key,
              }
            : item,
        ),
      });
      return;
    }
    commit(openAcrossDesks(all, tab, isUnsaved, options?.after));
  };

  // popup 같은 탭을 floated로 연다. `.content`를 못 쟀으면 칸에 붙인다.
  const openFloatTab: TabHost["openFloat"] = (tab, size) => {
    if (mainSize === undefined) {
      openTab(tab);
      return;
    }
    setFloatFocused(true);
    update(openFloat(latest.current, tab, mainSize, size));
  };

  // 그 사이 바뀐 배치의 탭 필드를 바꾼다.
  const patchTab: TabHost["patchTab"] = (key, patch, options) => {
    const next = mapDeskTabs(latestDesks.current, (tab) =>
      tab.key === key
        ? { ...tab, ...(typeof patch === "function" ? patch(tab) : patch) }
        : tab,
    );
    if (options?.later === true) {
      commit(next, false);
      persistLater();
    } else commit(next);
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

  // domain의 DOMAIN.md를 파일 탭으로 연다. 경로는 main이 알려 주고 없는 파일은 첫 저장이 만든다.
  const openDomainDoc = async (domain: string) => {
    const reply = await windowInstructions()?.open({
      target: { layer: "domain", place: domain },
    });
    if (reply?.ok) openFile(host, reply.value.path);
  };

  // 이 project place의 lophn Agent 탭을 연다. agent 목록을 아직 읽지 못했으면 열지 않고 false다.
  const openLophn = (): boolean => {
    const row = sidebarAgents.agents.find(
      (item) => item.assignment === LOPHN_AGENT_ID,
    );
    if (agentViewSource === undefined || row === undefined) return false;
    openAgent(host, { agent: row.assignment, name: row.name });
    return true;
  };

  // session 하나를 그 agent의 탭으로 연다. session이나 agent 목록을 아직 모르면 열지 않고 false다.
  const openSessionTab = (session: string): boolean => {
    const entry = panelSessions(
      sessionStates,
      sidebarAgents.agents,
      projectId,
    ).find((item) => item.id === session);
    const row = sidebarAgents.agents.find(
      (item) => item.assignment === entry?.agent,
    );
    if (row === undefined || agentViewSource === undefined) return false;
    openAgent(host, { agent: row.assignment, name: row.name, session });
    return true;
  };

  // kind 선언이 배치와 통로를 건드리는 유일한 길이다. 본문·열기·닫기 확인은 모두 kind의 선언에서 오고
  // 여기서는 kind 이름으로 가르지 않는다.
  const host: TabHost = {
    projectId,
    projectTitle: loaded.project?.title,
    explorerRoot,
    props,
    appScreens: appViews?.screens !== undefined,
    view,
    windowTabs: () => allDeskTabs(latestDesks.current),
    viewKeeps: keeps,
    openTab,
    openFloat: openFloatTab,
    patchTab,
    removeTab,
    document: { noteReadPosition: notePosition },
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
  });

  // 시작 route(session·lophn·파일)는 이 project의 배치가 선 뒤 값마다 한 번 연다. session과 agent 목록을 아직 모르면 목록이 올 때 다시 본다.
  const started = useRef<{
    session?: string;
    lophn?: true;
    open?: object;
    terminal?: string;
  }>({});
  useEffect(() => {
    if (readyProject !== projectId) return;
    const { session, startLophn, open } = props;
    if (open !== undefined && started.current.open !== open) {
      started.current.open = open;
      openFile(host, open.path, { line: open.line });
    }
    if (session !== undefined && started.current.session !== session) {
      if (openSessionTab(session)) started.current.session = session;
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
    }
  }, [
    readyProject,
    projectId,
    props.session,
    props.startLophn,
    props.revealTerminal,
    props.open,
    sidebarAgents.agents,
    sessionIds,
  ]);

  useBridgeOpenRequests(terminal?.bridge ?? null, (request) =>
    terminal === undefined
      ? false
      : openBridgeUrl(hostRef.current, terminal.store, request),
  );
  // 알림을 누르면 그 터미널 탭을 고른다.
  useEffect(() => {
    if (terminal === undefined) return;
    return terminal.store.onSelect((key) => {
      const at = deskOfTab(latestDesks.current, key);
      if (at === undefined) return;
      if (at !== latestDesks.current.active) switchTo(at, emptyView());
      if (isDetached(latest.current, key)) {
        void props.detached?.focus({ key }).catch(() => {});
        return;
      }
      if (isFloated(latest.current, key)) {
        setFloatFocused(true);
        update(restoreFloat(latest.current, key));
        return;
      }
      const pane = latest.current.panes.findIndex((item) =>
        item.tabs.some((tab) => tab.key === key),
      );
      if (pane < 0) return;
      setFloatFocused(false);
      update({
        ...latest.current,
        focusedPane: pane,
        panes: latest.current.panes.map((item, index) =>
          index === pane ? { ...item, selected: key } : item,
        ),
      });
    });
  }, [terminal, props.detached]);

  // 탭을 OS 창으로 뗀다. 순서는 transfer, 창 열기, 성공했을 때만 layout 바꾸기다. 어느 단계에서
  // 실패해도 layout은 그대로라 탭이 사라지지 않는다.
  const detach = async (key: string) => {
    const api = props.detached;
    const first = findTab(latest.current, key);
    if (api === undefined || first === undefined) return;
    if (isDetached(latest.current, key)) return;
    const def = tabKindOf(first.kind);
    if (def?.noDetach === true) return;
    const transfer = await (def?.transfer?.(first, hostRef.current) ?? {
      value: null,
      views: [],
    });
    if (transfer === null) return;
    // transfer가 탭 값을 바꿨을 수 있고 그 사이 탭이 닫혔을 수 있다.
    const tab = findTab(mapTabs(latest.current, withPosition), key);
    if (tab === undefined) return;
    let bounds;
    try {
      ({ bounds } = await api.open({
        project: projectId,
        tab: slimDetachedTab(tab),
        transfer,
        bounds: null,
      }));
    } catch {
      return;
    }
    for (const session of transfer.views) {
      transferredViews.current.add(session);
    }
    const now = latest.current;
    if (findTab(now, key) === undefined) {
      void api.close({ key }).catch(() => {});
      return;
    }
    if (isFloated(now, key)) leaveTopFloat(key);
    else focusPaneBody(now.focusedPane);
    update(detachTab(latest.current, key, bounds));
  };

  // 최신 작업대를 보도록 ref로 건넨다. key가 있는 event는 그 탭이 있는 자리에 적용한다(보이는 자리가
  // 아니어도). 숨은 자리의 창은 숨었을 뿐이라 갑자기 사라지면(docked) 그 자리의 view가 받는다.
  const onDetachedEvent = (event: DetachedEvent) => {
    const all = latestDesks.current;
    const visible = latest.current;
    if (event.kind === "moved") {
      // main이 저장할 때 살아 있는 창의 bounds를 채운다.
      persistRef.current(all);
    } else if (event.kind === "open-tab") {
      openTab(
        distinctAgentTab(visible, event.tab as TabItem, allDeskTabs(all)),
      );
    } else if (event.kind === "opened") {
      update(openDetachedTab(visible, event.tab as TabItem, event.bounds));
    } else if (
      event.kind === "docked" ||
      event.kind === "changed" ||
      event.kind === "closed"
    ) {
      const at = deskOfTab(all, event.key);
      if (at === undefined) return;
      const current = all.desks[at]!;
      if (event.kind !== "closed" && !isDetached(current, event.key)) return;
      if (event.kind === "docked") {
        const tab = event.tab as TabItem;
        if (event.transfer !== null) {
          tabKindOf(tab.kind)?.receive?.(tab, event.transfer, hostRef.current);
        }
        updateAt(at, attachDetached(current, event.key, tab));
        if (at === all.active) {
          setFloatFocused(false);
          focusPaneBody(latest.current.focusedPane);
        }
      } else if (event.kind === "changed") {
        updateAt(at, {
          ...current,
          detached: current.detached.map((item) =>
            item.tab.key === event.key
              ? { ...item, tab: event.tab as TabItem }
              : item,
          ),
        });
      } else updateAt(at, closeDetached(current, event.key));
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
    [projectId, props.detached],
  );

  const renderTab = (tab: TabItem, active: boolean): ReactNode | null =>
    tabKindOf(tab.kind)?.render?.(tab, active, host) ?? null;

  const renderKept = (tab: TabItem, shown: boolean): ReactNode | null =>
    tabKindOf(tab.kind)?.keep?.(tab, shown, host) ?? null;

  // 탭 줄이 그리는 탭: 아이콘은 kind가 정하고(파일 종류, agent의 profile, harness vendor) 이름 뒤에 상태 점이 붙는다.
  const stripTab = (tab: TabItem): StripTab => {
    const def = tabKindOf(tab.kind);
    const icon =
      def === undefined
        ? undefined
        : (def.iconOf?.(tab, host) ?? (
            <Icon icon={def.icon} pixels={iconPixels("small")} />
          ));
    return {
      key: tab.key,
      title: tab.title,
      ...(icon === undefined ? {} : { icon }),
      dot: def?.dotOf?.(tab, host) ?? null,
      preview: tab.preview === true,
      unsaved: isUnsaved(tab.key),
      renamable: def?.rename !== undefined,
    };
  };

  // 사람이 닫은 탭. 창 전체에서 최근 몇 개를 기억해 Ctrl/Cmd+Shift+T가 되살린다. 이름 바꾸기·
  // 휴지통으로 사라진 탭은 사람이 닫은 것이 아니라서 넣지 않는다.
  const closedTabs = useRef<{ tab: TabItem; pane: number; index: number }[]>(
    [],
  );
  const rememberClosed = (key: string) => {
    const current = latest.current;
    const float = current.floats.find((item) => item.tab.key === key);
    let pane: number;
    let index: number;
    let tab: TabItem;
    if (float !== undefined) {
      // 닫은 floated 탭은 docked로 돌아온다. 끝에 붙는다.
      ({ tab } = float);
      pane = float.originPane;
      index = Number.MAX_SAFE_INTEGER;
    } else {
      pane = current.panes.findIndex((item) =>
        item.tabs.some((candidate) => candidate.key === key),
      );
      if (pane < 0) return;
      const tabs = current.panes[pane]!.tabs;
      index = tabs.findIndex((candidate) => candidate.key === key);
      tab = tabs[index]!;
    }
    if (tabKindOf(tab.kind)?.noReopen) return;
    const position = positions.current[key] ?? tab.readPosition;
    closedTabs.current = [
      {
        tab: position === undefined ? tab : { ...tab, readPosition: position },
        pane,
        index,
      },
      ...closedTabs.current.filter((item) => item.tab.key !== key),
    ].slice(0, CLOSED_TABS_MAX);
  };

  // 확인이 필요한 kind는 사람이 확인해야 닫는다. 취소하면 탭을 유지한다.
  // pane이 null이면 floated 탭이다.
  const close = (pane: number | null, key: string) => {
    const tab =
      pane === null
        ? view.floats.find((item) => item.tab.key === key)?.tab
        : view.panes[pane]?.tabs.find((item) => item.key === key);
    const confirm = tab ? tabKindOf(tab.kind)?.beforeClose?.(tab, host) : null;
    if (!confirm) {
      rememberClosed(key);
      removeTab(key);
      return;
    }
    void confirm.then((remove) => {
      if (!remove) return;
      rememberClosed(key);
      removeTab(key);
    });
  };

  // 탭 menu의 Close Others·Close to the Right·Close Saved·Close All. 탭마다 닫기 확인(beforeClose)을
  // 차례로 거치고, 사람이 계속 편집을 고르면 거기서 멈춘다(남은 탭도 닫지 않는다).
  const closeMany = async (pane: number, scope: CloseScope, key: string) => {
    const current = latest.current.panes[pane];
    if (current === undefined) return;
    for (const target of closeTargets(current, scope, key, isUnsaved)) {
      const tab = findTab(latest.current, target);
      if (tab === undefined) continue;
      const confirm = tabKindOf(tab.kind)?.beforeClose?.(tab, host);
      if (confirm && !(await confirm)) return;
      rememberClosed(target);
      removeTab(target);
    }
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

  // Explorer 자리를 열고 그 파일을 알린다. 접힌 sidebar도 펼친다.
  const [reveal, setReveal] = useState<{
    readonly path: string;
    readonly nonce: number;
  } | null>(null);
  const expandSidebar = () => {
    setSidebar((current) => ({ ...current, collapsedByUser: false }));
    setUserChoseWidth(true);
  };
  const revealInExplorer = (path: string) => {
    expandSidebar();
    setReveal({ path, nonce: Date.now() });
  };
  // 접힘 단추와 Ctrl/Cmd+B. 창이 좁아 접혀 있던 것도 펼치면 사람이 고른 것으로 친다.
  const toggleSidebar = () => {
    if (sidebarShown.mode === "collapsed") expandSidebar();
    else setSidebar((current) => ({ ...current, collapsedByUser: true }));
  };
  // Ctrl/Cmd+Shift+E. 숫자가 바뀔 때마다 sidebar가 Explorer를 고르고 고른 줄에 focus를 준다.
  const [explorerFocus, setExplorerFocus] = useState(0);

  // path 자신이거나 그 폴더 안에 있는 열린 파일 탭.
  const tabsAt = (path: string) =>
    allDeskTabs(latestDesks.current).filter(
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
    const result = await source.addFolder(projectId);
    if (!result.ok) return false;
    if (result.value !== null) {
      const view = result.value;
      setLoaded((state) => ({ ...state, project: view }));
    }
    return true;
  };
  const removeProjectFolder = async (path: string): Promise<boolean> => {
    const result = await source.removeFolder(projectId, path);
    if (!result.ok) return false;
    const view = result.value;
    setLoaded((state) => ({ ...state, project: view }));
    if (explorerRoot === path) setExplorerRoot(undefined);
    return true;
  };

  // activity bar 아래쪽 바로 가기 단추. 통로가 없는 단추는 열 탭이 없어 아무것도 하지 않는다.
  const onRail = (action: RailAction) => {
    if (action === "terminal") openTerminalTab(host);
    else if (action === "browser") {
      if (browserApi !== null) openBrowserTab(host);
    } else if (action === "agent") openLophn();
    else openSearchShortcut(host);
  };

  const pickFile = filePicker();

  // 창 팔레트의 작업대 행. 고르면 이 작업대 안의 대상으로만 간다.
  const palette = usePaletteEnv();
  const windowCommands = useWindowCommands();
  usePaletteScope(() =>
    workspaceScope({
      view,
      files: loaded.files,
      bookmarks: bookmarkList.state === "ok" ? bookmarkList.bookmarks : [],
      terminal: terminal !== undefined,
      platform: palette.platform,
      keys: windowCommands?.overrides() ?? {},
      search: palette.search
        ? (query) => palette.search!(query, { kind: "project", id: projectId })
        : undefined,
      go: (target) => {
        if (target.kind === "tab") {
          setFloatFocused(false);
          update({
            ...view,
            focusedPane: target.pane,
            panes: view.panes.map((item, index) =>
              index === target.pane ? { ...item, selected: target.key } : item,
            ),
          });
        } else if (target.kind === "document") openDocumentRow(target.document);
        else if (target.kind === "bookmark") openBrowserTab(host, target.url);
        else if (target.action === "launcher") onLauncher();
        else if (target.action === "settings") onSettings();
        else if (target.action === "terminal") openTerminalTab(host);
        else if (target.action === "float") {
          const tab = focusTab(latest.current);
          if (tab !== undefined && mainSize !== undefined) {
            setFloatFocused(true);
            update(floatTab(latest.current, tab.key, mainSize));
          }
        } else if (target.action === "dock") {
          const top = topFloat(latest.current);
          if (top === undefined) return;
          setFloatFocused(false);
          update(dockTab(latest.current, top.tab.key));
          focusPaneBody(latest.current.focusedPane);
        } else if (target.action === "minimize") {
          const top = topFloat(latest.current);
          if (top !== undefined) {
            leaveTopFloat(top.tab.key);
            update(minimizeFloat(latest.current, top.tab.key));
          }
        }
      },
    }),
  );

  // 작업대 단축키의 command는 작업대가 갖는다. 키는 창의 keybinding service가 표(ipc/keybindings.ts)로
  // 정하고, main이 먼저 받는 것(macOS의 Cmd+W)도 같은 command id로 온다. 지금 배치는 latest에서 읽는다.
  const openQuickFiles = useOpenPalette();
  const runCommand = (command: Command, arg?: number) => {
    const current = latest.current;
    const at = current.focusedPane;
    const pane = current.panes[at];
    if (pane === undefined) return;
    const select = (paneAt: number, key: string) => {
      setFloatFocused(false);
      update({
        ...latest.current,
        focusedPane: paneAt,
        panes: latest.current.panes.map((item, index) =>
          index === paneAt ? { ...item, selected: key } : item,
        ),
      });
      focusPaneBody(paneAt);
    };
    switch (command) {
      case "tab.next":
      case "tab.prev": {
        const next = stepTab(pane, command === "tab.next" ? 1 : -1);
        if (next !== null && next !== pane.selected) select(at, next);
        return;
      }
      case "tab.nth": {
        const target = arg === 0 ? pane.tabs.at(-1) : pane.tabs[(arg ?? 1) - 1];
        if (target !== undefined && target.key !== pane.selected) {
          select(at, target.key);
        }
        return;
      }
      case "tab.close":
        if (pane.selected !== null) close(at, pane.selected);
        return;
      case "tab.reopen": {
        while (closedTabs.current.length > 0) {
          const [last, ...rest] = closedTabs.current;
          closedTabs.current = rest;
          const open =
            deskOfTab(latestDesks.current, last!.tab.key) !== undefined;
          if (open) continue;
          update(reopenTab(latest.current, last!.tab, last!.pane, last!.index));
          focusPaneBody(latest.current.focusedPane);
          return;
        }
        return;
      }
      case "tab.move-left":
      case "tab.move-right":
        if (pane.selected !== null) {
          update(
            shiftTab(
              current,
              at,
              pane.selected,
              command === "tab.move-left" ? -1 : 1,
            ),
          );
        }
        return;
      case "tab.to-prev-pane":
      case "tab.to-next-pane":
        if (pane.selected !== null) {
          update(
            moveTabBy(
              current,
              pane.selected,
              command === "tab.to-prev-pane" ? -1 : 1,
            ),
          );
          focusPaneBody(latest.current.focusedPane);
        }
        return;
      case "pane.focus": {
        const target = (arg ?? 1) - 1;
        if (current.panes[target] === undefined) return;
        if (target === at && !inFloats) return;
        setFloatFocused(false);
        if (target !== at) update({ ...current, focusedPane: target });
        focusPaneBody(target);
        return;
      }
      case "pane.split":
      case "pane.split-down":
        if (pane.selected !== null) {
          update(
            splitTab(
              current,
              pane.selected,
              at,
              command === "pane.split" ? "right" : "bottom",
            ),
          );
          focusPaneBody(latest.current.focusedPane);
        }
        return;
      case "sidebar.toggle":
        toggleSidebar();
        return;
      case "explorer.focus":
        expandSidebar();
        setExplorerFocus((count) => count + 1);
        return;
      case "search.open":
        if (source.searchSource !== undefined) {
          openSearchShortcut(hostRef.current);
        }
        return;
      case "terminal.focus": {
        if (terminal === undefined) return;
        const panes = current.panes.map((item, index) => ({ item, index }));
        // 지금 칸의 터미널을 먼저 찾고, 없으면 다른 칸의 터미널로 간다.
        const found = [...panes.slice(at), ...panes.slice(0, at)].flatMap(
          ({ item, index }) =>
            item.tabs
              .filter((tab) => tab.kind === "terminal")
              .map((tab) => ({
                index,
                key: tab.key,
              })),
        )[0];
        if (found === undefined) openTerminalTab(hostRef.current);
        else {
          select(found.index, found.key);
        }
        return;
      }
      case "files.quick-open":
        openQuickFiles();
        return;
    }
  };
  useCommands(
    Object.fromEntries(
      WORKSPACE_COMMANDS.map((command) => [
        command,
        (arg: unknown) => runCommand(command, arg as number | undefined),
      ]),
    ),
  );

  const canDetach = (tab: TabItem) => tabKindOf(tab.kind)?.noDetach !== true;
  const detachProps =
    props.detached === undefined
      ? {}
      : {
          onDetach: (_pane: number, key: string) => void detach(key),
          canDetach,
        };

  const currentTab = focused?.tabs.find((tab) => tab.key === focused.selected);

  // sidebar의 Current는 이 창에 열린 탭이고 이름과 점은 탭 줄과 같다. 다른 자리·떼어 낸 창의 탭도 이 창의 것이다.
  const windowTabs = allDeskTabs(desks);
  const agentTabTitles = new Map(
    windowTabs.flatMap((tab) => {
      if (tab.kind !== "agent") return [];
      const session = sessionOf(tab);
      return session === null ? [] : [[session, tab.title] as const];
    }),
  );
  // 탭을 닫으면 그 session의 제목은 knownSessions로만 남는다. 이름을 바꾼 탭의 마지막 제목을 Recent에도 남긴다.
  const agentTabTitleKey = [...agentTabTitles]
    .map(([session, title]) => `${session}\0${title}`)
    .join("\n");
  const latestAgentTabTitles = useRef(agentTabTitles);
  latestAgentTabTitles.current = agentTabTitles;
  useEffect(() => {
    const titles = latestAgentTabTitles.current;
    setKnownSessions((prev) => {
      let next: Map<string, { title: string | null; at: number }> | null = null;
      for (const [session, title] of titles) {
        if (title === "") continue;
        const old = prev.get(session);
        if (old?.title === title) continue;
        next ??= new Map(prev);
        next.set(session, { title, at: old?.at ?? 0 });
      }
      return next ?? prev;
    });
  }, [agentTabTitleKey]);
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
  // run이 연 session은 sidebar의 session 목록에서 빼 그 run 아래에 둔다.
  const allSessions = panelSessions(
    sessionStates,
    sidebarAgents.agents,
    projectId,
    knownSessions,
    agentTabTitles,
  );
  const runOpened = runOpenedSessions(runRecords);
  const panelTerminals = usePanelTerminals(terminal, projectId, terminalTabs);

  // 숨은 탭은 TerminalTab 화면이 없어 hook이 알린 session 이름을 못 받는다. store가 바뀔 때 여기서 이름을 맞춘다.
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
    for (const tab of allDeskTabs(latestDesks.current)) {
      if (tab.kind !== "terminal") continue;
      const title = terminalTabTitle(tab, terminal.store);
      if (title !== tab.title) {
        host.patchTab(tab.key, { title }, { later: true });
      }
    }
  }, [terminalVersion, terminal, windowTabs]);

  return (
    <ViewKeepsProvider value={keeps}>
      <WebviewHostProvider value={webviews}>
        <div className={styles.workspace} data-space="project" ref={frameRef}>
          <div
            className={styles.topBar}
            data-drop={topDrop ? "" : undefined}
            onDragOver={(event) => {
              if (!event.dataTransfer.types.includes(TAB_MIME)) return;
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              setTopDrop(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) {
                setTopDrop(false);
              }
            }}
            onDrop={(event) => {
              setTopDrop(false);
              delete document.documentElement.dataset.tabDragging;
              const key = event.dataTransfer.getData(TAB_MIME);
              if (key === "") return;
              event.preventDefault();
              if (isFloated(latest.current, key)) {
                leaveTopFloat(key);
                update(minimizeFloat(latest.current, key));
              } else if (mainSize !== undefined) {
                update(minimizeTab(latest.current, key, mainSize));
              }
            }}
          >
            <TopBar
              rail={<LauncherButton onLauncher={onLauncher} />}
              leading={
                <span className={styles.leading}>
                  <PlaceSwitcher
                    active={{ kind: "project", id: projectId }}
                    activeName={loaded.project?.title}
                    projects={placeLists.projects}
                    apps={placeLists.apps}
                    recent={recentPlaces}
                    onOpenChange={readListsOnOpen}
                    onSelect={(place) => {
                      if (place.kind !== "project" || place.id !== projectId) {
                        props.onOpenPlace?.(place);
                      }
                    }}
                  />
                  {deskOptions.length > 1 ? (
                    <>
                      <PathSep />
                      <DeskSelector
                        options={deskOptions}
                        active={desks.active}
                        onOpenChange={readListsOnOpen}
                        onSelect={(key) =>
                          switchTo(
                            key,
                            openTabIn(
                              emptyView(),
                              workflowTab(key),
                              () => false,
                            ),
                          )
                        }
                      />
                    </>
                  ) : null}
                  <MinimizedBar
                    items={view.floats.filter((item) => item.minimized)}
                    stripTab={stripTab}
                    onRestore={(key) => {
                      setFloatFocused(true);
                      update(restoreFloat(latest.current, key));
                    }}
                    onDock={(key) => {
                      update(dockTab(latest.current, key));
                      focusPaneBody(latest.current.focusedPane);
                    }}
                    onClose={(key) => close(null, key)}
                  />
                </span>
              }
              trailing={
                <span className={styles.trailing}>
                  <WaitingLayer
                    onOpenSession={(session) =>
                      runToastAction({ kind: "session", session })
                    }
                  />
                  {noticesHidden && hasNotices ? (
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
                  ) : null}
                  <PaletteButton />
                </span>
              }
            />
          </div>
          <div className={styles.main}>
            {sidebarShown.mode === "hidden" ? null : (
              <ProjectSidebar
                mode={sidebarShown.mode === "collapsed" ? "collapsed" : "open"}
                width={sidebarShown.width}
                project={loaded.project}
                source={source}
                agents={sidebarAgents.agents}
                sessions={allSessions.filter((item) => !runOpened.has(item.id))}
                terminals={panelTerminals}
                runs={panelRuns(
                  runRecords,
                  sidebarAgents.agents,
                  projectId,
                  allSessions,
                )}
                artifactPanel={
                  <ArtifactPanel
                    domains={domains}
                    onOpen={(domain, name) => openArtifact(host, domain, name)}
                  />
                }
                jobs={props.jobs}
                onOpenJobs={() => onSettings("jobs")}
                current={
                  currentTab?.kind === "document_editor" ? currentTab.key : null
                }
                onToggle={toggleSidebar}
                onSettings={() => onSettings()}
                reveal={reveal}
                focusExplorer={explorerFocus}
                onOpenFile={(path, keep) =>
                  openFile(host, path, { preview: keep !== true })
                }
                onMove={moveFile}
                onTrash={trashFile}
                explorerRoot={explorerRoot ?? null}
                onExplorerRoot={setExplorerRoot}
                onAddFolder={addProjectFolder}
                onRemoveFolder={removeProjectFolder}
                {...(terminal === undefined
                  ? {}
                  : {
                      onOpenTerminal: (cwd: string) =>
                        openTerminalTab(host, { cwd }),
                    })}
                onRail={onRail}
                onAgent={(agent) =>
                  openAgent(host, {
                    agent: agent.assignment,
                    name: agent.name,
                  })
                }
                onSession={(session) => {
                  const row = sidebarAgents.agents.find(
                    (agent) => agent.assignment === session.agent,
                  );
                  if (row !== undefined) {
                    openAgent(host, {
                      agent: row.assignment,
                      name: row.name,
                      session: session.id,
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
                onManage={() => openAgents(host)}
                onOpenDomainDoc={(domain) => void openDomainDoc(domain)}
                onOpenWorkflow={(workflow) => openWorkflow(host, workflow)}
                activeWorkflow={
                  desks.active === DEFAULT_DESK ? undefined : desks.active
                }
                onResizeStart={(event) => {
                  const start = sidebar.chosenWidth;
                  const startShown = sidebarShown.width;
                  let last = start;
                  startPointerDrag(event, {
                    move: (dx) => {
                      last = clampSidebar(startShown + dx);
                      setSidebar((current) => ({
                        ...current,
                        chosenWidth: last,
                      }));
                    },
                    finish: (outcome) => {
                      const applied = applyDrag(start, last, outcome);
                      setSidebar((current) => ({
                        ...current,
                        chosenWidth: applied,
                      }));
                      if (outcome.type === "drag-end") {
                        setUserChoseWidth(true);
                      }
                    },
                  });
                }}
              />
            )}
            <div className={styles.content} ref={mainRef}>
              {noticesHidden ? null : (
                <div className={styles.notices} data-notices="">
                  {loaded.failed ? (
                    <NoticeCard
                      tone="error"
                      data={{ "data-load-failed": "" }}
                      text={t("project-workspace.error.load-failed")}
                      onDismiss={hideNotices}
                    />
                  ) : null}
                </div>
              )}
              <Panes
                view={view}
                focusedPane={inFloats ? null : view.focusedPane}
                onDropTab={(pane, key, zone) => {
                  setFloatFocused(false);
                  update(dropTabOnPane(latest.current, key, pane, zone));
                  focusPaneBody(latest.current.focusedPane);
                }}
                onDropPath={(pane, path) => {
                  setFloatFocused(false);
                  update({ ...latest.current, focusedPane: pane });
                  openFile(host, path);
                }}
                windowWidth={measuredWindow}
                onSelect={(pane, key) => {
                  setFloatFocused(false);
                  update({
                    ...view,
                    focusedPane: pane,
                    panes: view.panes.map((item, index) =>
                      index === pane ? { ...item, selected: key } : item,
                    ),
                  });
                }}
                onClose={close}
                onCloseMany={(pane, scope, key) =>
                  void closeMany(pane, scope, key)
                }
                onPin={(key) => update(pinTab(latest.current, key))}
                onFloat={(_pane, key) => {
                  if (mainSize === undefined) return;
                  setFloatFocused(true);
                  update(floatTab(latest.current, key, mainSize));
                }}
                onMinimize={(_pane, key) => {
                  if (mainSize === undefined) return;
                  update(minimizeTab(latest.current, key, mainSize));
                }}
                onRename={(key, name) => {
                  const tab = findTab(latest.current, key);
                  if (tab !== undefined) {
                    tabKindOf(tab.kind)?.rename?.(tab, name, host);
                  }
                }}
                {...detachProps}
                pathOf={pathOfTab}
                onCopyPath={copyPath}
                onReveal={revealInExplorer}
                onFocus={(pane) => {
                  setFloatFocused(false);
                  if (pane !== latest.current.focusedPane) {
                    update({ ...latest.current, focusedPane: pane });
                  }
                }}
                onMove={(key, toPane, before) =>
                  update(moveTab(view, key, toPane, before))
                }
                onSplit={(pane, key, side) => {
                  setFloatFocused(false);
                  update(splitTab(latest.current, key, pane, side));
                  focusPaneBody(latest.current.focusedPane);
                }}
                onRatio={(path, ratio) =>
                  update({
                    ...latest.current,
                    layout: setRatio(latest.current.layout, path, ratio),
                  })
                }
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
                      : { onBrowser: () => openBrowserTab(host) })}
                    {...(agentView === null
                      ? {}
                      : {
                          agents: sidebarAgents.agents.map((agent) => ({
                            id: agent.assignment,
                            name: agent.name,
                            profile: agent.profile,
                          })),
                          onAgent: (id: string) => {
                            const row = sidebarAgents.agents.find(
                              (agent) => agent.assignment === id,
                            );
                            if (row !== undefined) {
                              openAgent(host, { agent: id, name: row.name });
                            }
                          },
                        })}
                    {...(source.searchSource === undefined
                      ? {}
                      : {
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
              <Floats
                floats={view.floats}
                focused={inFloats}
                area={mainSize}
                stripTab={stripTab}
                renderTab={renderTab}
                renderKept={renderKept}
                onRaise={(key) => {
                  setFloatFocused(true);
                  const next = raiseFloat(latest.current, key);
                  if (next !== latest.current) update(next);
                }}
                onRect={(key, rect) => {
                  if (mainSize === undefined) return;
                  update(setFloatRect(latest.current, key, rect, mainSize));
                }}
                onMinimize={(key) => {
                  leaveTopFloat(key);
                  update(minimizeFloat(latest.current, key));
                }}
                onDock={(key) => {
                  setFloatFocused(false);
                  update(dockTab(latest.current, key));
                  focusPaneBody(latest.current.focusedPane);
                }}
                onClose={(key) => close(null, key)}
                {...(props.detached === undefined
                  ? {}
                  : {
                      onDetach: (key: string) => void detach(key),
                      canDetach,
                    })}
                webviews={<WebviewLayer host={webviews} />}
              />
            </div>
          </div>
        </div>
      </WebviewHostProvider>
    </ViewKeepsProvider>
  );
}

export type { LayoutRead } from "./source.ts";
