import { Icon } from "@lophn/ui/primitives";
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
import type { AppFrameViewState } from "../../ipc/app-frame.ts";
import { useAppRuns } from "../app-frame/app-runs.ts";
import { useAnnotate } from "../app-frame/annotate/use-annotate.ts";
import { useAnnotateApi } from "../artifact/artifact-api.tsx";
import type { AppDetailSource } from "../app-frame/app-detail/source.ts";
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
import type { AppsSource } from "../apps/source.ts";
import { runToastAction } from "../desktop/connection/toasts/toast-actions.ts";
import {
  useOpenPalette,
  usePaletteEnv,
  usePaletteScope,
} from "../desktop/palette/host.tsx";
import type { ProjectsSource } from "../desktop/places/projects/source.ts";
import {
  focusTab,
  topFloat,
  workspaceScope,
} from "../desktop/palette/workspace-scope.ts";
import type { JobsSource } from "../desktop/settings/jobs/source.ts";
import type { SettingsPane } from "../desktop/settings/model.ts";
import type { EditorDeps } from "../editor/document-view.tsx";
import { dotLabel } from "../parts/tab-state-dot/tab-state-dot.tsx";
import { windowInstructions } from "./agents/core-extensions.ts";
import {
  ContentCard,
  type CardPane,
  type TabAction,
} from "../shell/content-card.tsx";
import {
  activeDesk,
  addDesk,
  allTabs,
  closeDetached,
  type CloseScope,
  closeFloat,
  closeTab,
  closeTargets,
  type Desk,
  deskTabs,
  detachTab,
  dockFloat,
  entryKey,
  findTab,
  floatTab,
  focusedKey,
  mapLayoutTabs,
  minimizeFloat,
  moveTab,
  newFloatRect,
  openDetachedTab,
  openFloatTab,
  openTab as openTabInDesk,
  type PlaceLayout,
  defaultPlaceLayout,
  pinTab,
  placeKey,
  reattachTab,
  removeDesk,
  restoreFloat,
  selectTab,
  setActiveDesk,
  setFloatRect,
  splitWith,
  stepTab,
  type PlaceRef,
  type TabItem,
  unsplit,
  updateDesk,
  whereInDesk,
} from "../shell/desk-model.ts";
import { DeskSwitcher } from "../shell/desk-switcher.tsx";
import { FloatLayer } from "../shell/float-layer.tsx";
import { PanelTabs } from "../shell/panel-tabs.tsx";
import { ShellFrame } from "../shell/shell-frame.tsx";
import { TabContextMenu, type TabMenuState } from "../shell/tab-menu.tsx";
import {
  type Side,
  type StripEntry,
  type StripTab,
  TabStrip,
} from "../shell/tab-strip.tsx";
import type { TerminalDeps } from "../terminal/deps.ts";
import {
  openBridgeUrl,
  useBridgeOpenRequests,
} from "../terminal/use-bridge-open-requests.ts";
import { NewTabMenu } from "./add-tab-menu.tsx";
import { agentOf, sessionOf } from "./agent/tab-fields.ts";
import { focusTabBody } from "./focus-tab.ts";
import { distinctAgentTab, openAgent } from "./kinds/agent.tsx";
import { openAppPanel } from "./kinds/app-panel.tsx";
import {
  appScreenKey,
  appScreenTab,
  openAppScreen,
} from "./kinds/app-screen.tsx";
import { openProjectSettings } from "./kinds/project-settings.tsx";
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
import { openWorkflow } from "./kinds/workflow.tsx";
import { NoticeCard } from "./notice-card.tsx";
import { openProjectLophn } from "./reactions/project-lophn.ts";
import { useToastHandler } from "./reactions/toast-handler.ts";
import { ArtifactPanel } from "./sidebar/artifact-panel.tsx";
import type { TabAwareResult } from "./sidebar/explorer.tsx";
import { agentRow } from "./sidebar/panel-sessions.ts";
import { sessionKey } from "../shell/left-sidebar-model.ts";
import { PlaceLeftSidebar } from "./sidebar/place-left-sidebar.tsx";
import {
  AppPlacePanel,
  appPanelTabs,
  type AppPlaceTab,
} from "./sidebar/app-panel.tsx";
import { HomePanel, homePanelTabs } from "./sidebar/home-panel.tsx";
import {
  ProjectPanel,
  panelTabs,
  type SidebarTab,
} from "./sidebar/project-sidebar.tsx";
import { usePanelTerminals } from "./sidebar/use-panel-terminals.ts";
import type {
  FileRow,
  ProjectView,
  ReadResult,
  WorkflowEntryView,
  WorkspaceSource,
} from "./source.ts";
import { useCommands, useWindowCommands } from "../commands/react.tsx";
import { useTabHostSlices } from "./use-tab-host-slices.ts";
import styles from "./place-window.module.css";

/** 이 창이 보일 수 있는 place: Home, project, 앱. */
export type WindowPlace = PlaceRef;

export interface PlaceWindowProps {
  /**
   * Home이면 project 폴더가 필요한 것(Explorer, 터미널, domain, workflow, project settings)이 없고 Places·Jobs panel이 오른쪽에 선다.
   * 앱이면 폴더 대신 앱 화면 탭이 있고 오른쪽에 App·Domain·Logs panel이 선다.
   * 창은 place마다 새로 mount된다(부르는 쪽이 key로 가른다).
   */
  place: WindowPlace;
  source: WorkspaceSource;
  /** 창 폭. 테스트가 고정하고 화면은 관측값을 넘긴다. */
  windowWidth: number;
  /** Home으로 간다. */
  onHome: () => void;
  /** card 위에 얹는 안내(core 연결이 끊긴 알림). */
  notice?: ReactNode;
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
  /** 왼쪽 sidebar의 앱 목록과 Create app의 통로. 없으면 앱 줄과 Create app이 없다. */
  apps?: AppsSource;
  /** 왼쪽 sidebar에서 project나 앱 place로 간다(Home은 onHome). */
  onPlace?: (place: Exclude<PlaceRef, { kind: "home" }>) => void;
  /** Create app으로 만든 앱의 앱 공간으로 간다. */
  onNewApp?: (app: string) => void;
  /** project 등록(이름·폴더)을 고치는 통로. Home의 Places panel이 쓰는 것과 같다. 없으면 settings 탭의 General을 쓸 수 없다. */
  projects?: ProjectsSource;
  /**
   * Agent 탭이 agent 하나의 통로를 얻는 함수(agentViewSource). 없으면
   * Agent 탭을 열지 않고 저장된 Agent 탭은 준비되지 않았다는 안내만 보인다. WorkspaceSource에 두지 않는 까닭: source.ts는 core 통로를 부르는 순수 `.ts`
   * 모듈들이 type으로 읽는데 이 type은 화면 부품(`.tsx`)의 view 값을 끌고 와 그 모듈들의 시험이 css import에서
   * 막힌다. core 구현(agent-tab-core-source.ts의 factory)은 entry(`.tsx`)가 여기에 넘긴다.
   */
  agentViewSource?: AgentTabSourceFactory;
  /** 처음 열 때 한 번 열 session(다른 project의 session toast). */
  session?: string;
  /** 앱 place의 오른쪽 App·Domain panel이 읽고 쓰는 통로. 없으면 그 panel은 준비 전 안내다. */
  appDetail?: AppDetailSource;
  /** 처음 열 때 한 번 이 place의 lophn을 연다. 앱 place는 앱 화면과 붙인 split으로 연다. */
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

// 창 폭이 이보다 좁으면 sidebar를 접은 채 시작한다.
const LEFT_OPEN_MIN = 640;
const RIGHT_OPEN_MIN = 1024;
// 이동 기록의 상한.
const TRAIL_MAX = 50;

interface Stop {
  readonly desk: string;
  readonly key: string | null;
  readonly focus: Side;
}

const sameStop = (a: Stop, b: Stop) =>
  a.desk === b.desk && a.key === b.key && a.focus === b.focus;

// place(Home, project, 앱) 창. 새 shell 틀(title bar의 desk 단추·tab 줄, 가운데 card, float 층, 양쪽 sidebar)에 desk 하나를 그린다.
// Home과 앱은 project가 없어(projectId null) 폴더가 필요한 부분을 건너뛴다.
export function PlaceWindow(props: PlaceWindowProps) {
  const { place, source, windowWidth, onHome, onSettings, terminal } = props;
  const projectId = place.kind === "project" ? place.id : null;
  const appId = place.kind === "app" ? place.id : null;
  const isHome = place.kind === "home";
  const isApp = appId !== null;
  const placeId = placeKey(place);
  const browserApi = useBrowserApi();
  const bookmarkList = useBookmarks();
  // Agent 탭의 통로. 없으면 Agent 탭을 열지 않는다.
  const agentViewSource = props.agentViewSource;
  const [loaded, setLoaded] = useState<Loaded>(EMPTY_LOADED);
  // Explorer가 보이는 연결 폴더. 화면 상태일 뿐이라 저장하지 않는다. 터미널도 이 폴더에서 열린다.
  const [explorerRoot, setExplorerRoot] = useState<string | undefined>();
  // 앱 place에서 지금 열려 있는 앱 화면 view. App panel의 Annotate가 이 view를 가리킨다.
  const [screenView, setScreenView] = useState<AppFrameViewState | null>(null);
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
    place,
    source,
    agentViewSource,
    terminalStore: terminal?.store,
    host: () => host,
    onSettings,
  });
  const sessionIds = sessionStates.map((entry) => entry.session).join();
  // 배치를 다 읽은 place. 시작 route는 이 place의 배치가 선 뒤에 연다.
  const [readyPlace, setReadyPlace] = useState<string | null>(null);
  // desk 단추의 workflow 목록. null은 아직 안 읽었거나 읽는 중이다. 실패와 읽는 중에는 합치지 않는다.
  const [workflowList, setWorkflowList] = useState<ReadResult<
    readonly WorkflowEntryView[]
  > | null>(null);
  // desk마다 tab 줄·split·float·detached가 하나씩 있다. 화면이 그리고 고치는 것은 보이는 desk뿐이다.
  const [layout, setLayout] = useState<PlaceLayout>(defaultPlaceLayout);
  const desk = activeDesk(layout);
  const [leftOpen, setLeftOpen] = useState(windowWidth >= LEFT_OPEN_MIN);
  const [rightOpen, setRightOpen] = useState(windowWidth >= RIGHT_OPEN_MIN);
  const [panel, setPanel] = useState<string>(
    isHome ? "places" : isApp ? "app" : "explorer",
  );
  // 떠 있는 안내(읽기 실패)를 닫은 상태.
  const [noticesHidden, setNoticesHidden] = useState(false);
  const hideNotices = () => setNoticesHidden(true);
  const deskCount = useRef(0);
  // float 층의 기준인 stage(card를 감싸는 칸)의 크기.
  const stageRef = useRef<HTMLDivElement>(null);
  const stageSize = useObservedSize(stageRef);

  // 앱 place의 이름. 앱 화면 탭 제목과 crumb이 쓴다.
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
  // 앱 place를 처음 열면(저장된 layout이 없으면) Main desk에 앱 화면 탭이 고른 채 있다.
  const freshLayout = (): PlaceLayout => {
    const base = defaultPlaceLayout();
    return appId === null
      ? base
      : updateDesk(base, base.active, (item) =>
          openTabInDesk(item, appScreenTab(appId, "")),
        );
  };

  useEffect(() => {
    let live = true;
    const load = async () => {
      const [project, read, files] = await Promise.all([
        projectId === null ? null : source.project(projectId),
        source.layout.readPlaceLayout(place),
        projectId === null ? null : source.files(projectId),
      ]);
      if (!live) return;
      if (project !== null && files !== null) {
        setLoaded({
          project: project.ok ? project.value : null,
          // 파일 목록은 팔레트만 쓴다. 읽지 못해도 작업대는 그대로 연다.
          files: files.ok ? files.value : [],
          failed: !project.ok,
        });
      }
      const restored =
        read.ok && read.layout !== null ? read.layout : freshLayout();
      latestLayout.current = restored;
      setLayout(restored);
      // 보이는 desk의 detached 창만 연다. 다른 desk의 것은 그 desk로 갈 때 syncDetached가 연다.
      // 거절은 무시한다. conflict는 이미 떠 있는 것이고 나머지는 탭이 layout의 detached로 남는다.
      // transfer가 없어 terminal은 PTY에 다시 붙지 못한다(재시작과 같다).
      for (const item of activeDesk(restored).detached) {
        void props.detached
          ?.open({
            project: placeId,
            tab: item.tab,
            transfer: null,
            bounds: item.bounds,
          })
          .catch(() => {});
      }
      setReadyPlace(placeId);
    };
    void load();
    return () => {
      live = false;
    };
  }, [placeId, source]);

  // 이름이나 폴더를 settings 탭에서 저장하면 crumb과 sidebar가 새 값을 보이게 다시 읽는다.
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
  // 저장 안 된 변경이 있는 탭. 탭 줄과 preview 탭 보호가 같은 session을 본다.
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

  const persist = (next: PlaceLayout) => {
    void source.layout.savePlaceLayout(
      place,
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
  const webviewTabKeys = useRef<Set<string>>(new Set());
  // 다른 창으로 넘긴 view(main이 소유를 옮긴 browser popup native view)는 여기서 닫지 않는다.
  const transferredViews = useRef<Set<string>>(new Set());
  useEffect(() => {
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
      desks
        .flatMap((item) => [
          ...item.tabs,
          ...item.floats.map((float) => float.tab),
        ])
        .filter((tab) => tab.kind === "terminal")
        .map((tab) => tab.key),
    );
    props.terminal?.displays.retain(placeId, terminals);
  }, [layout, keeps, webviews, props.terminal, placeId]);
  useEffect(
    () => () => props.terminal?.displays.retain(placeId, new Set()),
    [props.terminal, placeId],
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

  // detached 창을 보이는 desk에 맞춘다. 창이 없는 key(다른 desk에 있다가 지금 보이게 된 것)는 연다.
  const syncDetached = (next: PlaceLayout) => {
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
              project: placeId,
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
  const commit = (next: PlaceLayout, save = true, sync = false) => {
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

  // 저장된 agent 탭은 제목 없이 되살아나고, 본문을 그린 탭만 이름을 채운다. 작업대가 다시 열리면(Settings나 런처에
  // 다녀오거나 연결이 잠깐 끊기면) 고르지 않은 탭의 이름이 비므로 agent 목록의 이름으로 채운다.
  useEffect(() => {
    const nameOf = (tab: TabItem) =>
      tab.kind === "agent" && tab.title === ""
        ? sidebarAgents.agents.find((row) => row.assignment === agentOf(tab))
            ?.name
        : tab.kind === "app_screen" && tab.title === ""
          ? appName
          : undefined;
    if (!allTabs(layout).some((tab) => nameOf(tab) !== undefined)) return;
    commit(
      mapLayoutTabs(latestLayout.current, (tab) => {
        const name = nameOf(tab);
        return name === undefined ? tab : { ...tab, title: name };
      }),
      false,
    );
  }, [layout, sidebarAgents.agents, appName]);

  // desk를 바꾼다. 저장과 detached 창 맞추기는 commit이 한다.
  const switchDesk = (key: string) =>
    commit(setActiveDesk(latestLayout.current, key));

  // 사라진 workflow의 desk를 Main으로 합친다. 합치며 tab이 된 detached 탭의 창은 닫는다.
  const mergeVanished = (liveNames: readonly string[]) => {
    const current = latestLayout.current;
    const gone = Object.values(current.desks).filter(
      (item) =>
        item.workflow !== undefined && !liveNames.includes(item.workflow),
    );
    if (gone.length === 0) return;
    const next = gone.reduce((all, item) => removeDesk(all, item.key), current);
    const detachedKeys = (from: PlaceLayout) =>
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
    if (readyPlace === placeId) readWorkflows();
  }, [placeId, source, readyPlace]);

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
      update((item) =>
        openTabInDesk(item, tab, { select: false, unsaved: isUnsaved }),
      );
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
          unsaved: isUnsaved,
        }),
      ),
    );
  };

  // popup 같은 탭을 floated로 연다. stage를 못 쟀으면 tabs에 붙인다.
  const openFloatInStage: TabHost["openFloat"] = (tab, size) => {
    if (stageSize === undefined) {
      openTab(tab);
      return;
    }
    update((item) => openFloatTab(item, tab, newFloatRect(stageSize, size)));
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

  // 이 place의 lophn Agent 탭을 연다. agent 목록을 아직 읽지 못했으면 열지 않고 false다.
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
    const entry = sessionStates.find((item) => item.session === session);
    const row =
      entry === undefined
        ? undefined
        : agentRow(entry, sidebarAgents.agents, place);
    if (row === undefined || agentViewSource === undefined) return false;
    openAgent(host, { agent: row.assignment, name: row.name, session });
    return true;
  };

  // kind 선언이 배치와 통로를 건드리는 유일한 길이다. 본문·열기·닫기 확인은 모두 kind의 선언에서 오고
  // 여기서는 kind 이름으로 가르지 않는다.
  const host: TabHost = {
    place,
    projectId,
    projectTitle: loaded.project?.title,
    appName,
    appScreen: isApp ? { reportView: setScreenView } : null,
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
    projectSettings: {
      projects: props.projects,
      projectChanged: reloadProject,
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
    place,
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
    open?: object;
    terminal?: string;
  }>({});
  useEffect(() => {
    if (readyPlace !== placeId) return;
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
      // 방금 만든 앱은 앱 화면과 lophn session을 붙여 나란히 본다.
      if (appId !== null) {
        update((item) =>
          item.selected !== null &&
          item.tabs.some((tab) => tab.key === appScreenKey(appId))
            ? splitWith(item, appScreenKey(appId), item.selected)
            : item,
        );
      }
    }
  }, [
    readyPlace,
    placeId,
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
    });
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
        project: placeId,
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
    [placeId, props.detached],
  );

  // 탭 본문. 고르지 않아도 남겨 둘 kind(앱 패널, browser, artifact)는 keep이 그리고 shown으로 보임을 정한다.
  // webview는 host가 key로 한 번만 만들고 옮기지 않으므로 desk나 탭을 바꿔 다시 mount해도 page가 이어진다.
  const bodyOf = (tab: TabItem, active: boolean): ReactNode => {
    const def = tabKindOf(tab.kind);
    return (
      def?.keep?.(tab, true, host) ??
      def?.render?.(tab, active, host) ?? (
        <h1 className={styles.heading}>{tab.title}</h1>
      )
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
  const stripTab = (tab: TabItem): StripTab => ({
    key: tab.key,
    title: tab.title,
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

  // 탭 menu의 Close others·Close to the right·Close saved·Close all. 탭마다 닫기 확인(beforeClose)을 차례로
  // 거치고, 사람이 계속 편집을 고르면 거기서 멈춘다(남은 탭도 닫지 않는다).
  const closeMany = async (scope: CloseScope, key: string) => {
    for (const target of closeTargets(latestDesk(), scope, key, isUnsaved)) {
      const tab = latestDesk().tabs.find((item) => item.key === target);
      if (tab === undefined) continue;
      const confirm = tabKindOf(tab.kind)?.beforeClose?.(tab, host);
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

  // Ctrl/Cmd+Shift+E. 숫자가 바뀔 때마다 오른쪽 sidebar가 Files를 고르고 고른 줄에 focus를 준다.
  const [explorerFocus, setExplorerFocus] = useState(0);

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
  // tabs의 탭을 stage 가운데 60% 크기의 패널로 띄운다. stage를 못 쟀으면 아무것도 하지 않는다.
  const floatByKey = (key: string) => {
    if (stageSize === undefined) return;
    const rect = newFloatRect(stageSize);
    update((item) => floatTab(item, key, rect));
  };
  usePaletteScope(() =>
    workspaceScope({
      desk,
      files: loaded.files,
      bookmarks: bookmarkList.state === "ok" ? bookmarkList.bookmarks : [],
      terminal: terminal !== undefined,
      platform: palette.platform,
      keys: windowCommands?.overrides() ?? {},
      home: projectId === null,
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

  // 작업대 단축키의 command는 작업대가 갖는다. 키는 창의 keybinding service가 표(ipc/keybindings.ts)로
  // 정하고, main이 먼저 받는 것(macOS의 Cmd+W)도 같은 command id로 온다. 지금 배치는 latestLayout에서 읽는다.
  const openQuickFiles = useOpenPalette();
  const runCommand = (command: Command, arg?: number) => {
    const current = latestDesk();
    switch (command) {
      case "tab.next":
      case "tab.prev": {
        const next = stepTab(current, command === "tab.next" ? 1 : -1);
        if (next.selected !== current.selected) selectKey(next.selected!);
        return;
      }
      case "tab.nth": {
        const target =
          arg === 0 ? current.tabs.at(-1) : current.tabs[(arg ?? 1) - 1];
        if (target !== undefined && target.key !== current.selected) {
          selectKey(target.key);
        }
        return;
      }
      case "tab.close": {
        const key = focusedKey(current);
        if (key !== null) close(key);
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
        const split = current.split;
        const key = entryKey(current);
        if (split === null || key !== split.a) return;
        update((item) =>
          selectTab(item, split.a, (arg ?? 1) === 2 ? "b" : "a"),
        );
        focusTabBody(arg === 2 ? split.b : split.a);
        return;
      }
      case "pane.split": {
        if (current.split !== null) {
          update(unsplit);
          return;
        }
        splitWithNext();
        return;
      }
      case "sidebar.toggle":
        setLeftOpen((open) => !open);
        return;
      case "explorer.focus":
        if (projectId === null) return;
        setPanel("explorer");
        setRightOpen(true);
        setExplorerFocus((count) => count + 1);
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
  useCommands(
    Object.fromEntries(
      WORKSPACE_COMMANDS.map((command) => [
        command,
        (arg: unknown) => runCommand(command, arg as number | undefined),
      ]),
    ),
  );

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
  // 왼쪽 sidebar가 강조할 줄: 고른 tab의 session이나 터미널.
  const selectedSessionKey =
    currentTab === null || currentTab === undefined
      ? undefined
      : currentTab.kind === "agent"
        ? sessionKey({ kind: "session", ref: sessionOf(currentTab) ?? "" })
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
    for (const tab of allTabs(latestLayout.current)) {
      if (tab.kind !== "terminal") continue;
      const title = terminalTabTitle(tab, terminal.store);
      if (title !== tab.title) {
        host.patchTab(tab.key, { title }, { later: true });
      }
    }
  }, [terminalVersion, terminal, windowTabs]);

  // card에 그릴 탭. split이면 a, b 둘이고 아니면 고른 탭 하나다.
  const split = desk.split;
  const inSplit = split !== null && entryKey(desk) === split.a;
  const focusSide: Side = inSplit ? split.focus : "a";
  const deskTab = (key: string | null) =>
    desk.tabs.find((tab) => tab.key === key);
  const shown = (inSplit ? [split.a, split.b] : [desk.selected]).flatMap(
    (key) => deskTab(key) ?? [],
  );
  const splitWithNext = (key?: string) => {
    const current = latestDesk();
    const from = key ?? current.selected;
    const at = current.tabs.findIndex((tab) => tab.key === from);
    const next = current.tabs[at + 1] ?? current.tabs[at - 1];
    if (from === null || at < 0 || next === undefined) return;
    update((item) => splitWith(item, from, next.key));
  };

  // tab 메뉴(오른쪽 클릭과 card ⋯)가 보이는 항목.
  const menuStateOf = (tab: TabItem): TabMenuState => {
    const tabs = desk.tabs;
    const member =
      split !== null && (split.a === tab.key || split.b === tab.key);
    const lastAt = Math.max(
      ...(member ? [split.a, split.b] : [tab.key]).map((key) =>
        tabs.findIndex((item) => item.key === key),
      ),
    );
    return {
      renamable: tabKindOf(tab.kind)?.rename !== undefined,
      preview: tab.preview === true,
      file: pathOfTab(tab) !== null,
      canDetach:
        props.detached !== undefined && tabKindOf(tab.kind)?.noDetach !== true,
      inSplit: member,
      canSplit: tabs.length > 1,
      hasOthers: tabs.length > (member ? 2 : 1),
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
      case "split":
        splitWithNext(key);
        return;
      case "unsplit":
        update(unsplit);
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
  const panes: CardPane[] = shown.map((tab, index) => {
    const dot = tabKindOf(tab.kind)?.dotOf?.(tab, host) ?? null;
    return {
      key: tab.key,
      crumbs: crumbsOf(tab),
      ...(dot === null ? {} : { status: dotLabel(dot) }),
      menu: menuStateOf(tab),
      body: (
        <div key={tab.key} className={styles.tabBody} data-tab-body={tab.key}>
          {bodyOf(tab, !inSplit || focusSide === (index === 0 ? "a" : "b"))}
        </div>
      ),
    };
  });

  const onCardAction = (action: TabAction, side: Side) => {
    const tab = shown[side === "b" ? 1 : 0];
    if (tab !== undefined) runTabAction(action, tab.key);
  };

  // tab 줄의 한 칸. split은 칸 하나에 a, b 둘이 붙는다.
  const entries: StripEntry[] = desk.tabs.flatMap((tab) => {
    if (split !== null && tab.key === split.b) return [];
    const partner =
      split !== null && tab.key === split.a ? deskTab(split.b) : undefined;
    return [
      {
        key: tab.key,
        a: stripTab(tab),
        ...(partner === undefined ? {} : { b: stripTab(partner) }),
      },
    ];
  });
  const reorder = (key: string, before: string | null) => {
    const moving = new Set(
      split !== null && (key === split.a || key === split.b)
        ? [split.a, split.b]
        : [key],
    );
    const rest = desk.tabs.filter((tab) => !moving.has(tab.key));
    const at =
      before === null
        ? rest.length
        : rest.findIndex((tab) => tab.key === before);
    if (at >= 0) update((item) => moveTab(item, key, at));
  };

  // 이동 기록. ← →가 오가는 창 하나의 지나온 자리이고 저장하지 않는다.
  const here: Stop = {
    desk: layout.active,
    key: entryKey(desk),
    focus: focusSide,
  };
  const [trail, setTrail] = useState<{
    readonly stops: readonly Stop[];
    readonly at: number;
  }>({ stops: [], at: -1 });
  useEffect(() => {
    if (readyPlace !== placeId) return;
    setTrail((now) => {
      const current = now.stops[now.at];
      if (current !== undefined && sameStop(current, here)) return now;
      const stops = [...now.stops.slice(0, now.at + 1), here].slice(-TRAIL_MAX);
      return { stops, at: stops.length - 1 };
    });
  }, [readyPlace, placeId, here.desk, here.key, here.focus]);
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
                stop.key,
                item.split?.a === stop.key ? stop.focus : undefined,
              ),
      ),
    );
  };

  const deskOptions = [
    ...Object.values(layout.desks).map((item) => ({
      key: item.key,
      label: item.label,
      workflow: item.workflow !== undefined,
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

  // 앱 place의 오른쪽 panel. Annotate는 앱 화면 view를 가리키고, Logs는 이 앱의 run 기록이다.
  const annotateApi = useAnnotateApi();
  const annotating = useAnnotate(annotateApi, screenView?.view_session ?? null);
  const readRuns = useCallback(
    () => source.runs({ place: { app: appId ?? "" } }),
    [source, appId],
  );
  const runRows = useAppRuns(
    isApp ? readRuns : undefined,
    appId ?? "",
    sidebarAgents.agents,
    agentViewSource,
    isApp && rightOpen && panel === "logs",
  );

  const withJobs = props.jobs !== undefined;
  const mainSection = (
    <div className={styles.stage} ref={stageRef}>
      <ContentCard
        panes={panes}
        focus={focusSide}
        deskLabel={desk.label}
        canBack={backAt >= 0}
        canForward={forwardAt >= 0}
        onBack={() => walk(backAt)}
        onForward={() => walk(forwardAt)}
        onFocus={(side) => {
          if (split !== null) update((item) => selectTab(item, split.a, side));
        }}
        onAction={onCardAction}
        onDropPath={(path) =>
          openFile(host, path, {
            ...(desk.selected === null ? {} : { from: desk.selected }),
          })
        }
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

  return (
    <ViewKeepsProvider value={keeps}>
      <WebviewHostProvider value={webviews}>
        <div
          className={styles.workspace}
          data-space={isHome ? "home" : isApp ? "app" : "project"}
        >
          <ShellFrame
            left={leftOpen}
            onToggleLeft={() => setLeftOpen(!leftOpen)}
            right={rightOpen}
            onToggleRight={() => setRightOpen(!rightOpen)}
            onSearch={openQuickFiles}
            deskSwitcher={
              projectId === null ? undefined : (
                <DeskSwitcher
                  desks={deskOptions}
                  current={layout.active}
                  onSelect={selectDesk}
                  onNewDesk={newDesk}
                />
              )
            }
            tabs={
              <TabStrip
                entries={entries}
                selected={entryKey(desk)}
                focus={focusSide}
                minimized={desk.floats.map((item) => stripTab(item.tab))}
                floating={desk.floats
                  .filter((item) => !item.minimized)
                  .map((item) => item.tab.key)}
                onSelect={(key, side) =>
                  update((item) =>
                    selectTab(
                      item,
                      key,
                      item.split?.a === key ? side : undefined,
                    ),
                  )
                }
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
                onReorder={reorder}
                onToggleFloat={(key) =>
                  update((item) =>
                    item.floats.some((f) => f.tab.key === key && !f.minimized)
                      ? minimizeFloat(item, key)
                      : restoreFloat(item, key),
                  )
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
                    {...(source.searchSource === undefined || projectId === null
                      ? {}
                      : { onSearch: () => openSearchShortcut(host) })}
                    {...(isApp
                      ? { onAppScreen: () => openAppScreen(host) }
                      : {})}
                    {...(host.appScreens
                      ? { onAppPanel: () => openAppPanel(host) }
                      : {})}
                  />
                }
              />
            }
            panelTabs={
              <PanelTabs
                tabs={
                  isHome
                    ? homePanelTabs(withJobs)
                    : isApp
                      ? appPanelTabs()
                      : panelTabs(withJobs)
                }
                selected={panel}
                onSelect={setPanel}
              />
            }
            leftSidebar={
              <PlaceLeftSidebar
                place={place}
                source={source}
                projects={props.projects}
                apps={props.apps}
                agentViewSource={agentViewSource}
                agents={sidebarAgents.agents}
                openTitles={agentTabTitles}
                terminals={panelTerminals}
                selected={selectedSessionKey}
                canTerminal={terminal !== undefined}
                onNewSession={() => void openLophn()}
                onNewLophn={(agent) =>
                  openAgent(host, { agent: agent.assignment, name: agent.name })
                }
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
                onOpenSession={(session) =>
                  runToastAction({ kind: "session", session })
                }
                onPlace={(ref) =>
                  ref.kind === "home" ? onHome() : props.onPlace?.(ref)
                }
                onNewApp={(app) => props.onNewApp?.(app)}
                onJobs={() => onSettings("jobs")}
                onSettings={() => onSettings()}
              />
            }
            rightSidebar={
              isApp ? (
                <AppPlacePanel
                  tab={panel as AppPlaceTab}
                  app={appId}
                  name={appName ?? ""}
                  detail={props.appDetail}
                  runs={runRows}
                  {...(annotateApi === undefined || screenView === null
                    ? {}
                    : {
                        annotate: {
                          on: annotating.state?.on ?? false,
                          onToggle: () =>
                            annotating.setMode(
                              !(annotating.state?.on ?? false),
                            ),
                        },
                      })}
                  onOpenSession={(session) =>
                    runToastAction({ kind: "session", session })
                  }
                  onRunSession={(session) => {
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
                  }}
                />
              ) : projectId === null ? (
                <HomePanel
                  tab={panel}
                  projects={props.projects}
                  apps={props.apps}
                  jobs={props.jobs}
                  onProject={(project) =>
                    props.onPlace?.({ kind: "project", id: project })
                  }
                  onApp={(app) => props.onOpenApp?.(app)}
                  onNewApp={(app) => props.onNewApp?.(app)}
                  onOpenJobs={() => onSettings("jobs")}
                />
              ) : (
                <ProjectPanel
                  tab={panel as SidebarTab}
                  project={loaded.project}
                  source={source}
                  artifactPanel={
                    <ArtifactPanel
                      domains={domains}
                      onOpen={(domain, name) =>
                        openArtifact(host, domain, name)
                      }
                    />
                  }
                  jobs={props.jobs}
                  onOpenJobs={() => onSettings("jobs")}
                  current={
                    currentTab?.kind === "document_editor"
                      ? currentTab.key
                      : null
                  }
                  focusExplorer={explorerFocus}
                  reveal={reveal}
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
                  onOpenDomainDoc={(domain) => void openDomainDoc(domain)}
                  onOpenWorkflow={(workflow) => openWorkflow(host, workflow)}
                  activeWorkflow={desk.workflow}
                />
              )
            }
            floats={
              <>
                <WebviewLayer host={webviews} />
                <FloatLayer
                  floats={desk.floats
                    .filter((item) => !item.minimized)
                    .map((item) => ({
                      key: item.tab.key,
                      title: item.tab.title,
                      icon: iconOfTab(item.tab),
                      dot: tabKindOf(item.tab.kind)?.dotOf?.(item.tab, host),
                      rect: item.rect,
                      body: bodyOf(item.tab, true),
                    }))}
                  onRaise={(key) => update((item) => restoreFloat(item, key))}
                  onRect={(key, rect) =>
                    update((item) => setFloatRect(item, key, rect))
                  }
                  onMinimize={(key) =>
                    update((item) => minimizeFloat(item, key))
                  }
                  onDock={(key) => {
                    update((item) => dockFloat(item, key));
                    focusTabBody(key);
                  }}
                  onClose={close}
                />
              </>
            }
          >
            {mainSection}
          </ShellFrame>
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
}
