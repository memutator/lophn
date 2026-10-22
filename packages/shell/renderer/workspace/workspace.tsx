import { type ReactNode, useEffect, useReducer, useRef, useState } from "react";
import type { TabItem as StripTab } from "../parts/tab-strip/tab-strip.tsx";
import { Icon, IconButton } from "@lophn/ui/primitives";
import type { SettingsPane } from "../desktop/settings/model.ts";
import { Tooltip } from "@lophn/ui/overlay";
import { iconPixels, useObservedSize } from "@lophn/ui/shared";
import { workspaceIcons } from "../icons/mod.ts";
import { t } from "@lophn/wording";

import { SettingsEntry, TopBar } from "../desktop/top-bar/top-bar.tsx";
import { WaitingLayer } from "../desktop/connection/waiting/waiting-layer.tsx";
import { runToastAction } from "../desktop/connection/toasts/toast-actions.ts";
import { openProjectManager } from "./reactions/project-manager.ts";
import { useToastHandler } from "./reactions/toast-handler.ts";
import { Breadcrumbs } from "./top-path/breadcrumbs.tsx";
import { MinimizedBar } from "./minimized/minimized-bar.tsx";
import { LauncherButton } from "./launcher-button.tsx";
import { startPointerDrag } from "./drag.ts";
import {
  activeView,
  allDeskTabs,
  applyDrag,
  attachDetached,
  breadcrumbs,
  clampSidebar,
  closeDetached,
  closeFloat,
  type CloseScope,
  closeTab,
  closeTargets,
  deskOfTab,
  desksFromView,
  detachTab,
  dockTab,
  emptyView,
  findTab,
  floatTab,
  isDetached,
  isFloated,
  mapDeskTabs,
  mapTabs,
  mergeDeskIntoDefault,
  minimizeFloat,
  moveTab,
  moveTabBy,
  openAcrossDesks,
  openDetachedTab,
  openFloat,
  pinTab,
  raiseFloat,
  reopenTab,
  restoreFloat,
  setActiveView,
  setDeskView,
  setFloatRect,
  shiftTab,
  SIDEBAR_WIDTH,
  type SidebarState,
  sidebarView,
  stepTab,
  switchDesk,
  type TabItem,
  vanishedDesks,
  type WorkspaceDesks,
  type WorkspaceView,
} from "./model.ts";
import type { TabAwareResult } from "./sidebar/explorer.tsx";
import { ArtifactPanel } from "./sidebar/artifact-panel.tsx";
import { ProjectSidebar } from "./sidebar/project-sidebar.tsx";
import type { RailAction } from "./sidebar/activity-bar.tsx";
import {
  agentByRole,
  type KnownSessions,
  panelRuns,
  panelSessions,
  runOpenedSessions,
} from "./sidebar/panel-sessions.ts";
import { Panes } from "./panes/panes.tsx";
import { Floats } from "./floats/floats.tsx";
import { NewTabMenu } from "./add-tab-menu.tsx";
import type { FileRow, ProjectView, WorkspaceSource } from "./source.ts";
import type { RunRecordView } from "./sidebar/run-list.tsx";
import { desksFromStored, toStoredLayout } from "./layout-map.ts";
import {
  PaletteButton,
  useMainCommand,
  useOpenPalette,
  usePaletteEnv,
  usePaletteScope,
} from "../desktop/palette/host.tsx";
import type { Command } from "../../ipc/keybindings.ts";
import {
  type DetachedEvent,
  type LophnDetachedApi,
  slimDetachedTab,
} from "../../ipc/detached.ts";
import { focusPaneBody, useKeybindings } from "./use-keybindings.ts";
import {
  focusTab,
  topFloat,
  workspaceScope,
} from "../desktop/palette/workspace-scope.ts";
import type { EditorDeps } from "../editor/document-view.tsx";
import { windowInstructionsSource } from "../editor/instructions-entry.tsx";
import type { AgentTabSourceFactory } from "../conversation/agent-tab-source.ts";
import type { TabHost } from "./kinds/host.ts";
import { useTabHostSlices } from "./use-tab-host-slices.ts";
import { distinctAgentTab, openAgent } from "./kinds/agent.tsx";
import { openBrowserTab } from "./kinds/browser.tsx";
import { openArtifact } from "./kinds/artifact.tsx";
import { openWorkflow } from "./kinds/workflow.tsx";
import { useBrowserApi } from "../browser/browser-api.tsx";
import { useBookmarks } from "../browser/bookmarks.ts";
import { WebviewHostProvider, WebviewLayer } from "../browser/webview-host.tsx";
import { openAgents } from "./kinds/agents.tsx";
import { openSearchShortcut } from "./kinds/search.tsx";
import { tabKindOf } from "./kinds/registry.ts";
import { openFile } from "./kinds/document-editor.tsx";
import { openTerminal as openTerminalTab } from "./kinds/terminal.tsx";
import { openAppPanel } from "./kinds/app-panel.tsx";
import type { TerminalDeps } from "../terminal/deps.ts";
import { useTerminalOpenRequests } from "../terminal/use-terminal-open-requests.ts";
import {
  openBridgeUrl,
  useBridgeOpenRequests,
} from "../terminal/use-bridge-open-requests.ts";
import { openCodingTerminal } from "./kinds/terminal.tsx";
import { NoticeCard } from "./notice-card.tsx";
import {
  ViewCoversProvider,
  ViewKeepsProvider,
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
  /** Settings로 간다. 항목을 주면 그 항목부터 연다. */
  onSettings: (pane?: SettingsPane) => void;
  /** project의 LOPHN.md 편집을 연다(Agents 탭의 Instructions [Edit]). 없으면 그 단추는 아무것도 하지 않는다. */
  onProjectInstructions?: () => void;
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
  /** 처음 열 때 한 번 Project Manager를 연다. */
  projectManager?: true;
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
    onSettings,
    onProjectInstructions,
    terminal,
  } = props;
  const browserApi = useBrowserApi();
  const bookmarkList = useBookmarks();
  // Agent 탭의 통로. 없으면 Agent 탭을 열지 않는다.
  const agentViewSource = props.agentViewSource;
  const [loaded, setLoaded] = useState<Loaded>(EMPTY_LOADED);
  const {
    domains,
    sidebarAgents,
    sessionStates,
    agentView,
    agents,
    covers,
    appViews,
    keeps,
    webviews,
  } = useTabHostSlices({
    project: projectId,
    source,
    agentViewSource,
    host: () => host,
    onSettings,
    onProjectInstructions,
  });
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
  // sidebar의 Background 묶음. run event가 계약에 없어서 처음과 session 상태가 바뀔 때마다 다시 읽는다.
  // 이 project에 놓인 agent(Project Manager·Operator)의 run과 lophn의 run을 합친다.
  const [runRecords, setRunRecords] = useState<readonly RunRecordView[]>([]);
  useEffect(() => {
    let live = true;
    void Promise.all([
      source.runs({ place: { project: projectId } }),
      source.runs({ agent: { role: "lophn" } }),
    ]).then(([inProject, lophn]) => {
      if (!live) return;
      // 하나라도 실패하면 앞 값을 둔다.
      if (!inProject.ok || !lophn.ok) return;
      const byId = new Map(
        [...inProject.value, ...lophn.value].map((run) => [run.id, run]),
      );
      setRunRecords(
        [...byId.values()].sort((a, b) =>
          Date.parse(b.created_at) - Date.parse(a.created_at)
        ),
      );
    });
    return () => {
      live = false;
    };
  }, [source, projectId, sessionStates]);
  // 배치를 다 읽은 project. 시작 route는 이 project의 배치가 선 뒤에 연다.
  const [readyProject, setReadyProject] = useState<string | null>(null);
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
            void props.detached?.open({
              project: projectId,
              tab: item.tab,
              transfer: null,
              bounds: item.bounds,
            }).catch(() => {});
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
  const crumbs = breadcrumbs(loaded.project?.title ?? "", view);
  const focused = view.panes[view.focusedPane];
  const contentWidth = mainSize?.width ?? bodyWidth;

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
    void source.saveLayout(toStoredLayout({
      project: projectId,
      desks: mapDeskTabs(next, withPosition),
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

  useEffect(() => () => {
    if (positionTimer.current === null) return;
    clearTimeout(positionTimer.current);
    positionTimer.current = null;
    persistRef.current(latestDesks.current);
  }, []);

  // layout에서 사라진 탭의 view를 닫는다. 탭을 닫는 길이 여럿이라 길마다 닫지 않고 차이로 본다.
  useEffect(() => {
    // 다른 자리의 탭도 layout에 있는 동안은 산다. 자리를 건너가도 app panel의 native view가 이어진다.
    const live = new Set(allDeskTabs(desks).map((tab) => tab.key));
    for (const key of keeps.keys()) if (!live.has(key)) keeps.release(key);
    // detached 탭의 <webview>는 그 창이 갖는다. 여기 남기면 page가 두 창에 산다.
    const shown = new Set([
      ...view.panes.flatMap((pane) => pane.tabs),
      ...view.floats.map((float) => float.tab),
    ].map((tab) => tab.key));
    for (const key of webviews.keys()) {
      if (!shown.has(key)) webviews.release(key);
    }
  }, [desks, keeps, webviews]);
  // 떠나면 남은 것을 모두 닫는다. 자식의 cleanup이 부모 뒤에 보관하므로 한 틱 미룬다.
  useEffect(() => () => {
    queueMicrotask(() => {
      for (const key of keeps.keys()) keeps.release(key);
    });
  }, [keeps]);

  // detached 창을 보이는 자리에 맞춘다. 창이 없는 key(다른 자리에 있다가 지금 보이게 된 것)는 연다.
  const syncDetached = (next: WorkspaceDesks) => {
    const api = props.detached;
    if (api === undefined) return;
    const items = activeView(next).detached;
    void api.showOnly({ keys: items.map((item) => item.tab.key) }).then(
      ({ missing }) => {
        for (const key of missing) {
          const item = items.find((candidate) => candidate.tab.key === key);
          if (item === undefined) continue;
          // 거절은 무시한다. 복원과 같다.
          void api.open({
            project: projectId,
            tab: slimDetachedTab(item.tab),
            transfer: null,
            bounds: item.bounds,
          }).catch(() => {});
        }
      },
    ).catch(() => {});
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

  // focus가 맨 위 floated 패널에 있는지. 저장하지 않는다. 늘 한 곳(칸 또는 패널)만 focus 색이고
  // 접히지 않은 패널이 없으면 칸이다.
  const [floatFocused, setFloatFocused] = useState(false);
  const inFloats = floatFocused && topFloat(view) !== undefined;
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
  // 부르는 곳은 ws-wire-selector가 단다(그때 밑줄을 뗀다).
  const _mergeVanished = (liveKeys: readonly string[]) => {
    const current = latestDesks.current;
    const gone = vanishedDesks(current, liveKeys);
    if (gone.length === 0) return;
    const next = gone.reduce(mergeDeskIntoDefault, current);
    const detachedKeys = (from: WorkspaceDesks) =>
      new Set(
        Object.values(from.desks).flatMap((item) =>
          item.detached.map((entry) => entry.tab.key)
        ),
      );
    const still = detachedKeys(next);
    for (const key of detachedKeys(current)) {
      if (!still.has(key)) void props.detached?.close({ key }).catch(() => {});
    }
    commit(next, true, true);
  };

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
      item.tabs.some((candidate) => candidate.key === key)
    );
    updateAt(at, closeTab(current, pane, key));
  };

  // focus 칸 끝에 붙이고 고른다. 같은 key가 어느 칸에 있으면 새로 붙이지 않고 그 칸에서 고른다
  // (탭 key는 작업대 안에서 유일하다). preview 탭은 그 칸의 preview 자리를 바꿔 쓴다(openTabIn).
  // `select: false`면 붙이기만 하고 보던 탭을 그대로 둔다.
  const openTab: TabHost["openTab"] = (tab, options) => {
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
            : item
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
    const next = mapDeskTabs(
      latestDesks.current,
      (tab) =>
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
    const reply = await windowInstructionsSource()?.open({
      target: { layer: "domain", place: domain },
    });
    if (reply?.ok) openFile(host, reply.value.path);
  };

  // 이 project의 role로 agent를 찾아 그 Agent 탭을 연다. agent 목록을 아직 읽지 못했으면 열지 않고 false다.
  const openRole = (role: "lophn" | "project_manager"): boolean => {
    const row = agentByRole(sidebarAgents.agents, role);
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
    )
      .find((item) => item.id === session);
    const row = sidebarAgents.agents.find((item) =>
      item.assignment === entry?.agent
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

  // 시작 route(session·Project Manager·파일)는 이 project의 배치가 선 뒤 값마다 한 번 연다. session과 agent 목록을 아직 모르면 목록이 올 때 다시 본다.
  const started = useRef<{ session?: string; pm?: true; open?: object }>({});
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
      openProjectManager(reactionEnv)
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
  useBridgeOpenRequests(
    terminal?.bridge ?? null,
    (request) =>
      terminal === undefined
        ? false
        : openBridgeUrl(hostRef.current, terminal.store, request),
  );
  // 대기 목록 카드가 터미널 session을 고르면 그 탭을 고른다.
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
        item.tabs.some((tab) => tab.key === key)
      );
      if (pane < 0) return;
      setFloatFocused(false);
      update({
        ...latest.current,
        focusedPane: pane,
        panes: latest.current.panes.map((item, index) =>
          index === pane ? { ...item, selected: key } : item
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
    const transfer = await (def?.transfer?.(first, hostRef.current) ??
      { value: null, views: [] });
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
      event.kind === "docked" || event.kind === "changed" ||
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
              : item
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
  useEffect(() => () => {
    void props.detached?.close({ key: null }).catch(() => {});
  }, [projectId, props.detached]);

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
      preview: tab.preview === true,
      unsaved: isUnsaved(tab.key),
    };
  };

  // 사람이 닫은 탭. 창 전체에서 최근 몇 개를 기억해 Ctrl/Cmd+Shift+T가 되살린다. 이름 바꾸기·
  // 휴지통으로 사라진 탭은 사람이 닫은 것이 아니라서 넣지 않는다.
  const closedTabs = useRef<
    { tab: TabItem; pane: number; index: number }[]
  >([]);
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
        item.tabs.some((candidate) => candidate.key === key)
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
    const tab = pane === null
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
      path.startsWith(`${item.path.replace(/\/+$/, "")}/`)
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
  const [reveal, setReveal] = useState<
    { readonly path: string; readonly nonce: number } | null
  >(null);
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
    allDeskTabs(latestDesks.current).filter((tab) =>
      tab.kind === "document_editor" &&
      (tab.key === path || tab.key.startsWith(`${path}/`))
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

  // activity bar 아래쪽 바로 가기 단추. 통로가 없는 단추는 열 탭이 없어 아무것도 하지 않는다.
  const onRail = (action: RailAction) => {
    if (action === "terminal") openTerminalTab(host);
    else if (action === "agent") openRole("lophn");
    else openSearchShortcut(host);
  };

  const pickFile = filePicker();

  // 창 팔레트의 작업대 행. 고르면 이 작업대 안의 대상으로만 간다.
  const palette = usePaletteEnv();
  usePaletteScope(() =>
    workspaceScope({
      view,
      files: loaded.files,
      bookmarks: bookmarkList.state === "ok" ? bookmarkList.bookmarks : [],
      terminal: terminal !== undefined,
      platform: palette.platform,
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
              index === target.pane ? { ...item, selected: target.key } : item
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
    })
  );

  // 작업대 단축키. 표(ipc/keybindings.ts)가 key를 정하고 여기서는 command를 한다. main이 먼저
  // 받는 것(macOS의 Cmd+W)도 같은 command로 온다. 지금 배치는 latest에서 읽는다.
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
          index === paneAt ? { ...item, selected: key } : item
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
          const open = deskOfTab(latestDesks.current, last!.tab.key) !==
            undefined;
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
        // 이미 나뉘었으면 더 나눌 칸이 없다.
        if (current.panes.length === 1 && pane.selected !== null) {
          update(moveTab(current, pane.selected, 1));
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
        const found = [...panes.slice(at), ...panes.slice(0, at)].flatMap((
          { item, index },
        ) =>
          item.tabs.filter((tab) => tab.kind === "terminal").map((tab) => ({
            index,
            key: tab.key,
          }))
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
  const runRef = useRef(runCommand);
  runRef.current = runCommand;
  useKeybindings(
    palette.platform === "mac" ? "mac" : "other",
    (command, arg) => runRef.current(command, arg),
  );
  useMainCommand((command) => runRef.current(command));

  const canDetach = (tab: TabItem) => tabKindOf(tab.kind)?.noDetach !== true;
  const detachProps = props.detached === undefined ? {} : {
    onDetach: (_pane: number, key: string) => void detach(key),
    canDetach,
  };

  const currentTab = focused?.tabs.find((tab) => tab.key === focused.selected);

  // run이 연 session은 sidebar의 session 목록에서 빼 그 run 아래에 둔다.
  const allSessions = panelSessions(
    sessionStates,
    sidebarAgents.agents,
    projectId,
    knownSessions,
  );
  const runOpened = runOpenedSessions(runRecords);

  return (
    <ViewCoversProvider value={covers}>
      <ViewKeepsProvider value={keeps}>
        <WebviewHostProvider value={webviews}>
          <div className={styles.workspace} data-space="project" ref={frameRef}>
            {sidebarShown.mode === "hidden" ? null : (
              <ProjectSidebar
                mode={sidebarShown.mode === "collapsed" ? "collapsed" : "open"}
                width={sidebarShown.width}
                project={loaded.project}
                source={source}
                agents={sidebarAgents.agents}
                sessions={allSessions.filter((item) => !runOpened.has(item.id))}
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
                current={currentTab?.kind === "document_editor"
                  ? currentTab.key
                  : null}
                onLauncher={onLauncher}
                onToggle={toggleSidebar}
                reveal={reveal}
                focusExplorer={explorerFocus}
                onOpenFile={(path, keep) =>
                  openFile(host, path, { preview: keep !== true })}
                onMove={moveFile}
                onTrash={trashFile}
                onRail={onRail}
                onAgent={(agent) =>
                  openAgent(host, {
                    agent: agent.assignment,
                    name: agent.name,
                  })}
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
                onOpenDomainDoc={(domain) => void openDomainDoc(domain)}
                onOpenWorkflow={(workflow) => openWorkflow(host, workflow)}
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
                      <SettingsEntry onSettings={() => onSettings()} />
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
                  focusedPane={inFloats ? null : view.focusedPane}
                  bodyWidth={contentWidth}
                  windowWidth={measuredWindow}
                  onSelect={(pane, key) => {
                    setFloatFocused(false);
                    update({
                      ...view,
                      focusedPane: pane,
                      panes: view.panes.map((item, index) =>
                        index === pane ? { ...item, selected: key } : item
                      ),
                    });
                  }}
                  onClose={close}
                  onCloseMany={(pane, scope, key) =>
                    void closeMany(pane, scope, key)}
                  onPin={(key) => update(pinTab(latest.current, key))}
                  onFloat={(_pane, key) => {
                    if (mainSize === undefined) return;
                    setFloatFocused(true);
                    update(floatTab(latest.current, key, mainSize));
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
                    update(moveTab(view, key, toPane, before))}
                  onRatio={(ratio) => update({ ...view, splitRatio: ratio })}
                  newTab={
                    <NewTabMenu
                      {...(pickFile === undefined ? {} : {
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
                  {...(props.detached === undefined ? {} : {
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
    </ViewCoversProvider>
  );
}

export type { LayoutRead } from "./source.ts";
