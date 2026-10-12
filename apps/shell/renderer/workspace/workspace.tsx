import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
  type Clock,
  IconButton,
  type Timer,
  Tooltip,
  useObservedSize,
  workspaceIcons,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import { LophnEntry, TopBar } from "../desktop/top-bar/top-bar.tsx";
import { SpaceDecisions } from "../desktop/notification-chip/space-decisions.tsx";
import { Breadcrumbs } from "./top-path/breadcrumbs.tsx";
import { LauncherButton } from "./launcher-button.tsx";
import { startPointerDrag } from "./drag.ts";
import {
  applyDrag,
  breadcrumbs,
  clampSidebar,
  closeTab,
  INFO_PANEL_WIDTH,
  infoPanelPlacement,
  moveTab,
  SIDEBAR_WIDTH,
  type SidebarState,
  sidebarView,
  type TabItem,
  type WorkspaceView,
} from "./model.ts";
import { Sidebar } from "./sidebar/sidebar.tsx";
import { Panes } from "./panes/panes.tsx";
import { InfoPanel, type InfoTab } from "./info-panel-slot/info-panel.tsx";
import type {
  DocumentRow,
  FileRow,
  ProjectView,
  WorkspaceSource,
} from "./source.ts";
import { toStoredLayout, viewFromStored } from "./layout-map.ts";
import {
  PaletteButton,
  usePaletteEnv,
  usePaletteScope,
} from "../desktop/palette/host.tsx";
import { workspaceScope } from "../desktop/palette/workspace-scope.ts";
import type {
  CompareTarget,
  DocumentTabMeta,
  EditorDeps,
} from "../editor/document-view.tsx";
import { layoutHint, type TabPresentation } from "./view-hint.ts";
import type { AgentsSlice, ContextsSlice, TabHost } from "./kinds/host.ts";
import type { RailAction } from "./contexts/shortcut-rail.tsx";
import {
  contextEngineerSource,
  startContextEngineerSession,
} from "./contexts/context-engineer-conversation.ts";
import { useContextWatch } from "./contexts/context-watch.ts";
import { contextStamp } from "./contexts/use-context-read.ts";
import { DocumentContexts } from "./contexts/document-contexts.tsx";
import { settleContextTabs } from "./contexts/settle-tabs.ts";
import { useSidebarAgents } from "./agents/sidebar-agents.ts";
import { ViolationToast } from "./contexts/violation-toast.tsx";
import { openContext } from "./kinds/context.tsx";
import { openAgents } from "./kinds/agents.tsx";
import { openContexts } from "./kinds/contexts.tsx";
import { openSearchFor, openSearchShortcut } from "./kinds/search.tsx";
import { tabKindOf, tabKinds } from "./kinds/registry.ts";
import { openDocument as openDocumentTab } from "./kinds/document-editor.tsx";
import { openTerminal as openTerminalTab } from "./kinds/terminal.tsx";
import { DocumentInfoPanel } from "../editor/info-panel/info-panel.tsx";
import type { TerminalDeps } from "../terminal/deps.ts";
import { TrackingStrip } from "./tracking/tracking.tsx";
import type { TrackingSource } from "./tracking/source.ts";
import { NoticeCard } from "./notice-card.tsx";
import {
  DockSlot,
  DockToggle,
  useConversation,
} from "../conversation/dock-slot.tsx";
import {
  DOCK_WIDTH,
  dockPlacement,
  infoPanelShown,
} from "../conversation/model.ts";
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
  /** 이 프로젝트의 결정 대기를 things-to-confirm에서 연다. */
  onThingsToConfirm?: () => void;
  /** project의 LOPHN.md 편집을 연다(Agents 탭의 Instructions [Edit]). 없으면 그 단추는 아무것도 하지 않는다. */
  onProjectInstructions?: () => void;
  /** 문서 탭의 읽기·편집 통로. 없으면 문서 탭은 자리표시다. */
  editor?: EditorDeps;
  /** 터미널 탭 통로. 없으면 터미널 열기 버튼을 두지 않는다. */
  terminal?: TerminalDeps;
  /** 파일 추적 켜기 통로. 없으면 추적 안내 줄을 두지 않는다. */
  tracking?: TrackingSource;
  /** 앱 공간으로 연다. 없으면 패널을 못 여는 앱에는 안내 글만 둔다. */
  onOpenApp?: (app: string) => void;
  /** context 목록을 다시 읽고 toast가 닫히는 시간을 재는 timer. 시험이 시간을 세우려고 준다. */
  timer?: Timer & Clock;
}

interface Loaded {
  readonly project: ProjectView | null;
  readonly documents: readonly DocumentRow[];
  readonly files: readonly FileRow[];
  readonly failed: boolean;
}

const EMPTY_LOADED: Loaded = {
  project: null,
  documents: [],
  files: [],
  failed: false,
};

function freshView(): WorkspaceView {
  return {
    panes: [{ tabs: [], selected: null }],
    splitRatio: 0.5,
    focusedPane: 0,
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
    onThingsToConfirm,
    onProjectInstructions,
    terminal,
    editor,
    tracking,
    timer,
  } = props;
  // Contexts·Context·Search 탭의 통로. 없으면 그 탭과 여는 길을 두지 않는다.
  const contextsSource = source.contextsSource;
  // Agents 탭과 sidebar의 Agents 묶음의 통로. 없으면 그 탭과 여는 길을 두지 않는다.
  const agentsSource = source.agentsSource;
  const sidebarAgents = useSidebarAgents(agentsSource, projectId);
  // 앱 패널 view와 본문을 덮는 패널(정보 패널·대화 도크 overlay)이 같이 보는 목록.
  const covers = useMemo(createViewCovers, []);
  const appViews = useAppViews();
  const [loaded, setLoaded] = useState<Loaded>(EMPTY_LOADED);
  const [view, setView] = useState<WorkspaceView>(freshView);
  const [sidebar, setSidebar] = useState<SidebarState>({
    chosenWidth: SIDEBAR_WIDTH,
    collapsedByUser: false,
  });
  const [userChoseWidth, setUserChoseWidth] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  // 떠 있는 안내(추적 꺼짐·읽기 실패)를 닫은 상태. 상단 바의 안내 단추가 다시 연다.
  const [noticesHidden, setNoticesHidden] = useState(false);
  const hideNotices = () => setNoticesHidden(true);
  const hasNotices = loaded.failed || tracking !== undefined;
  const [infoTab, setInfoTab] = useState<InfoTab>("info");
  // 대화 도크. 정보 패널 자리를 임시로 쓰고 닫으면 정보 패널이 돌아온다(desktop#R2, R29).
  const conversation = useConversation();
  const [dockOpen, setDockOpen] = useState(
    conversation?.startOpen === true,
  );
  // 위반이 늘어 알리는 toast. context마다 하나이고 닫거나 [View]를 누르면 빠진다(workspace#R29).
  const [toasts, setToasts] = useState<
    readonly { context: string; title: string; count: number }[]
  >([]);
  // [New context]를 누른 뒤 생기는 만드는 중인 context의 탭을 남기려는 표시(workspace#R30).
  const expectDraft = useRef(false);
  const [expectingDraft, setExpectingDraft] = useState(false);
  // 도크가 누구와 말하는지. [New context]와 [Ask Context Engineer]는 Context Engineer다(R30).
  const [dockRole, setDockRole] = useState<"lophn" | "context_engineer">(
    "lophn",
  );
  const leaveDraft = useRef<(context: string, title: string) => void>(() => {});
  const watch = useContextWatch(
    contextsSource,
    projectId,
    {
      onViolations: (item, count) =>
        setToasts((current) => [
          ...current.filter((toast) => toast.context !== item.id),
          { context: item.id, title: item.title, count },
        ]),
      onDrafting: (item) => {
        if (!expectDraft.current) return;
        expectDraft.current = false;
        setExpectingDraft(false);
        leaveDraft.current(item.id, item.title);
      },
    },
    timer,
    expectingDraft && dockOpen && dockRole === "context_engineer",
  );
  // 문서 탭의 파일 이름·제목·상대 경로. 편집기가 문서를 읽으면 채운다(editor#R4).
  const [tabMeta, setTabMeta] = useState<
    Readonly<Record<string, DocumentTabMeta>>
  >({});
  // 문서 탭의 판·읽기/편집. 현재 보기 힌트만 쓰고 탭 제목(R4)에는 넣지 않는다.
  const [presentation, setPresentation] = useState<
    Readonly<Record<string, TabPresentation>>
  >({});
  // 앱 패널 탭이 연 view의 session. 탭 key로 찾고 현재 보기 힌트만 쓴다.
  const [sessions, setSessions] = useState<Readonly<Record<string, string>>>(
    {},
  );
  // 문서 탭마다 열린 버전 비교. 정보 패널의 버전 탭이 열고 문서 탭 본문 자리에 그린다(editor#R13).
  const [compares, setCompares] = useState<
    Readonly<Record<string, CompareTarget>>
  >({});
  // 복원으로 판이 바뀌면 정보 패널이 다시 읽는다.
  const [versionsTick, setVersionsTick] = useState(0);
  const frameRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const frameSize = useObservedSize(frameRef);
  const mainSize = useObservedSize(mainRef);
  const measuredWindow = frameSize?.width ?? windowWidth;

  useEffect(() => {
    let live = true;
    const load = async () => {
      const [project, documents, layout, files, contexts] = await Promise.all([
        source.project(projectId),
        source.documents(projectId),
        source.readLayout(projectId),
        source.files(projectId),
        contextsSource?.list(projectId),
      ]);
      if (!live) return;
      setLoaded({
        project: project.ok ? project.value : null,
        documents: documents.ok ? documents.value : [],
        // 파일 목록은 팔레트와 검색 결과 링크만 쓴다. 읽지 못해도 작업대는 그대로 연다.
        files: files.ok ? files.value : [],
        failed: !project.ok || !documents.ok,
      });
      if (layout.ok && layout.available) {
        const restored = viewFromStored(layout.layout);
        // 없어진 context의 탭은 다른 없는 대상처럼 빠진다. 목록을 못 읽으면 그대로 둔다(R6).
        if (restored.view) {
          setView(
            contexts?.ok
              ? settleContextTabs(restored.view, contexts.value)
              : restored.view,
          );
        }
        setInfoOpen(restored.infoOpen);
        setInfoTab(restored.infoTab);
      }
    };
    void load();
    return () => {
      live = false;
    };
  }, [projectId, source, contextsSource]);

  // 작업대 힌트. 통로가 없는 화면 테스트는 보내지 않는다. 창 신원은 main이 정한다.
  useEffect(() => {
    const bridge = (globalThis as {
      lophnWorkspace?: { report(hint: unknown): Promise<{ ok: boolean }> };
    }).lophnWorkspace;
    if (!bridge) return;
    void bridge.report(
      layoutHint({ project: projectId, view, presentation, sessions }),
    );
  }, [presentation, projectId, view, sessions]);

  // 추적을 켠 뒤 문서·파일 목록만 다시 읽는다. 열린 탭과 배치는 그대로 둔다.
  const refreshDocuments = async () => {
    const [documents, files] = await Promise.all([
      source.documents(projectId),
      source.files(projectId),
    ]);
    setLoaded((current) => ({
      ...current,
      documents: documents.ok ? documents.value : current.documents,
      files: files.ok ? files.value : current.files,
    }));
  };

  const sidebarShown = sidebarView(measuredWindow, sidebar, userChoseWidth);
  const crumbs = breadcrumbs(loaded.project?.title ?? "", view);
  const focused = view.panes[view.focusedPane];
  const contentWidth = mainSize?.width ?? bodyWidth;
  const dock = dockPlacement(dockOpen && conversation !== null, contentWidth);
  const infoShown = infoPanelShown(infoOpen, dock);
  const infoPlacement = infoPanelPlacement(
    infoShown,
    contentWidth,
    view.panes.length,
  );
  const panesWidth = dock === "docked"
    ? contentWidth - DOCK_WIDTH
    : infoPlacement === "docked"
    ? contentWidth - INFO_PANEL_WIDTH
    : contentWidth;

  // 비동기 닫기·시작 결과는 그 사이 바뀐 배치에 적용한다.
  const latest = useRef(view);
  latest.current = view;
  const infoNow = useRef({ open: infoOpen, tab: infoTab });
  infoNow.current = { open: infoOpen, tab: infoTab };
  // 문서 탭의 읽던 위치. scroll마다 배치 state를 바꾸지 않고 저장만 늦춘다.
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

  const persist = (
    next: WorkspaceView,
    info: { open: boolean; tab: InfoTab } = infoNow.current,
  ) => {
    void source.saveLayout(toStoredLayout({
      project: projectId,
      view: withPositions(next),
      informationPanel: info,
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
  // (탭 key는 작업대 안에서 유일하다).
  const openTab = (tab: TabItem) => {
    const current = latest.current;
    const holder = current.panes.findIndex((pane) =>
      pane.tabs.some((candidate) => candidate.key === tab.key)
    );
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

  const noteSession = (key: string, session: string | null) => {
    setSessions((current) => {
      if (session === null) {
        if (!(key in current)) return current;
        const { [key]: _gone, ...rest } = current;
        return rest;
      }
      return current[key] === session
        ? current
        : { ...current, [key]: session };
    });
  };

  const notePresentation = (key: string, shown: TabPresentation) => {
    setPresentation((current) => {
      const prev = current[key];
      if (
        prev !== undefined && prev.editing === shown.editing &&
        prev.version === shown.version
      ) return current;
      return { ...current, [key]: shown };
    });
  };

  // 편집기가 읽은 파일 이름으로 탭 제목을 바꾼다. 같은 이름이면 다시 저장하지 않는다.
  const noteMeta = (key: string, meta: DocumentTabMeta) => {
    setTabMeta((current) => ({ ...current, [key]: meta }));
    setView((current) => {
      const stale = current.panes.some((pane) =>
        pane.tabs.some((tab) => tab.key === key && tab.title !== meta.fileName)
      );
      if (!stale) return current;
      const next = {
        ...current,
        panes: current.panes.map((pane) => ({
          ...pane,
          tabs: pane.tabs.map((tab) =>
            tab.key === key ? { ...tab, title: meta.fileName } : tab
          ),
        })),
      };
      persist(next);
      return next;
    });
  };

  const tooltips: Record<string, ReactNode> = {};
  for (const [key, meta] of Object.entries(tabMeta)) {
    tooltips[key] = (
      <span className={styles.tabTip}>
        <span>{meta.title}</span>
        {meta.path === null
          ? null
          : <span className={styles.tabTipPath}>{meta.path}</span>}
      </span>
    );
  }

  const showCompare = (document: string, target: CompareTarget | null) => {
    setCompares((current) => {
      const next = { ...current };
      if (target === null) delete next[document];
      else next[document] = target;
      return next;
    });
  };

  // focus 칸의 활성 탭이 문서면 정보 패널이 그 문서를 보인다.
  const focusedTab = focused?.tabs.find((tab) => tab.key === focused.selected);
  const infoDocument = focusedTab?.kind === "document_editor"
    ? focusedTab.key
    : null;
  // 문서의 등록 폴더 기준 경로. 편집기가 문서를 읽기 전에는 모른다.
  const infoPath = infoDocument === null
    ? null
    : tabMeta[infoDocument]?.path ?? null;

  // CommandOrControl+Alt+B는 정보 패널을 여닫는다(editor#R6).
  const toggleInfo = useRef(() => {});
  toggleInfo.current = () => setInfo(!infoShown, infoTab);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || !event.altKey || event.shiftKey) return;
      if (event.code !== "KeyB" && event.key.toLowerCase() !== "b") return;
      event.preventDefault();
      toggleInfo.current();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const setInfo = (open: boolean, tab: InfoTab) => {
    // 정보 패널을 사람이 열면 그 자리를 쓰던 도크는 닫힌다. 둘을 쌓지 않는다(desktop#R29).
    if (open) setDockOpen(false);
    setInfoOpen(open);
    setInfoTab(tab);
    persist(view, { open, tab });
  };

  // 대화를 연다. Agent 탭은 다른 일이 맡고 지금은 오늘의 대화 도크가 들어가는 길이다(workspace#R33).
  const openConversation = () => {
    if (conversation === null) return;
    setDockRole("lophn");
    setDockOpen(true);
  };

  // Context Engineer와의 대화를 연다. 새 context를 시작하면 이 프로젝트를 작업 자리로 하는 새 세션을
  // 먼저 열어 고른다(workspace#R30). 세션을 못 열어도 대화는 열려 그 이유를 대화 화면이 보인다.
  const engineerSource = useMemo(
    () =>
      conversation === null ? null : contextEngineerSource(conversation.source),
    [conversation],
  );
  const openEngineer = async (fresh: boolean) => {
    if (conversation === null || engineerSource === null) return;
    if (fresh) {
      await startContextEngineerSession(
        engineerSource,
        conversation.drafts,
        projectId,
        conversation.now ?? Date.now,
      );
    }
    setDockRole("context_engineer");
    setDockOpen(true);
  };

  // 검색 결과·Overview 예시의 도메인 객체는 그 문서 탭으로 간다(workspace#R26). 경로는 등록 폴더
  // 기준 상대 경로이고 문서로 잡힌 파일만 탭이 된다.
  const openPath = (path: string) => {
    const file = loaded.files.find((item) => item.path === path) ??
      loaded.files.find((item) => item.path.endsWith(`/${path}`));
    if (file === undefined) return;
    openDocumentTab(host, { id: file.document, title: file.title });
  };

  const contexts: ContextsSlice | null = contextsSource === undefined ? null : {
    source: contextsSource,
    list: watch.list,
    titleOf: (id) => watch.list.find((item) => item.id === id)?.title,
    stampOf: (id) => {
      const item = watch.list.find((entry) => entry.id === id);
      return item === undefined ? undefined : contextStamp(item);
    },
    openPath,
    openSearch: (state) => openSearchFor(host, state),
    askContextEngineer: () => void openEngineer(false),
    newContext: () => {
      expectDraft.current = true;
      setExpectingDraft(true);
      void openEngineer(true);
    },
  };

  const agents: AgentsSlice | null = agentsSource === undefined ? null : {
    source: agentsSource,
    changed: sidebarAgents.reload,
    editInstructions: () => onProjectInstructions?.(),
    openLophn: onLophn,
  };

  // kind 선언이 배치와 통로를 건드리는 유일한 길이다(workspace#R14). 본문·열기·닫기 확인·열기 단추는
  // 모두 kind의 선언에서 오고 여기서는 kind 이름으로 가르지 않는다.
  const host: TabHost = {
    projectId,
    projectTitle: loaded.project?.title,
    props,
    appScreens: appViews?.screens !== undefined,
    view,
    openTab,
    patchTab,
    removeTab,
    document: {
      rows: loaded.documents,
      infoShown,
      toggleInfo: () => setInfo(!infoShown, infoTab),
      fileName: (id) => tabMeta[id]?.fileName,
      compareOf: (id) => compares[id] ?? null,
      showCompare,
      versionsChanged: () => setVersionsTick((value) => value + 1),
      noteMeta,
      notePresentation,
      noteReadPosition: notePosition,
    },
    appPanel: { noteSession },
    contexts,
    agents,
  };
  leaveDraft.current = (context, title) =>
    openContext(host, context, "overview", title);

  const renderTab = (tab: TabItem, active: boolean): ReactNode | null =>
    tabKindOf(tab.kind)?.render?.(tab, active, host) ?? null;

  const renderKept = (tab: TabItem, shown: boolean): ReactNode | null =>
    tabKindOf(tab.kind)?.keep?.(tab, shown, host) ?? null;

  // 확인이 필요한 kind는 사람이 확인해야 닫는다. 취소하면 탭을 유지한다(terminal#R10, editor#R1).
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

  const openDocument = (document: DocumentRow) =>
    openDocumentTab(host, document);

  const launchers = tabKinds().flatMap((kind) =>
    kind.launcher?.available(host)
      ? [{
        kind: kind.kind,
        label: t(kind.launcher.labelKey),
        icon: kind.icon,
        ...(kind.launcher.choices === undefined ? {} : {
          choices: kind.launcher.choices(host),
          emptyLabel: t("contexts.empty.tab-none"),
        }),
        onOpen: (choice?: string) => kind.launcher!.open(host, choice),
      }]
      : []
  );

  // 접힌 sidebar의 바로 가기 rail(workspace#R32). 통로가 없는 단추는 열 탭이 없어 아무것도 하지 않는다.
  const onRail = (action: RailAction) => {
    if (action === "terminal") openTerminalTab(host);
    else if (action === "agent") openConversation();
    else if (contexts === null) return;
    else if (action === "contexts") openContexts(host);
    else openSearchShortcut(host);
  };

  // 창 팔레트의 작업대 행(desktop#R30). 고르면 이 작업대 안의 대상으로만 간다.
  const palette = usePaletteEnv();
  usePaletteScope(() =>
    workspaceScope({
      view,
      documents: loaded.documents,
      files: loaded.files,
      contexts: watch.list,
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
        } else if (target.kind === "document") openDocument(target.document);
        else if (target.kind === "context") openContext(host, target.id);
        else if (target.action === "launcher") onLauncher();
        else if (target.action === "lophn") onLophn();
        else if (target.action === "terminal") openTerminalTab(host);
        else setInfo(!infoOpen, infoTab);
      },
    })
  );

  return (
    <ViewCoversProvider value={covers}>
      <div className={styles.workspace} data-space="project" ref={frameRef}>
        <Sidebar
          mode={sidebarShown.mode}
          width={sidebarShown.width}
          project={loaded.project}
          documents={loaded.documents}
          files={loaded.files}
          current={focused?.selected ?? null}
          onLauncher={onLauncher}
          onToggle={() =>
            setSidebar((current) => ({
              ...current,
              collapsedByUser: sidebarShown.mode !== "collapsed",
            }))}
          onOpenDocument={openDocument}
          onOpenContexts={contexts === null
            ? undefined
            : () => openContexts(host)}
          agents={agents === null ? undefined : {
            agents: sidebarAgents.agents,
            // 줄을 누르면 그 agent의 새 Agent 탭이 열린다(R34). Agent 탭은 agent-I33a가 잇는다.
            onOpenAgent: () => {},
            onManage: () => openAgents(host),
          }}
          onRail={onRail}
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
                setSidebar((current) => ({ ...current, chosenWidth: applied }));
                if (outcome.type === "drag-end") setUserChoseWidth(true);
              },
            });
          }}
        />
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
                  <SpaceDecisions
                    place={{ kind: "project", id: projectId }}
                    onOpen={onThingsToConfirm ?? onLophn}
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
                  {conversation
                    ? (
                      <DockToggle
                        open={dockOpen}
                        onToggle={() => {
                          if (!dockOpen) setDockRole("lophn");
                          setDockOpen(!dockOpen);
                        }}
                      />
                    )
                    : null}
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
                  {tracking
                    ? (
                      <TrackingStrip
                        project={projectId}
                        source={tracking}
                        onTracking={() => void refreshDocuments()}
                        onDismiss={hideNotices}
                      />
                    )
                    : null}
                </div>
              )}
            <Panes
              view={view}
              bodyWidth={panesWidth}
              windowWidth={measuredWindow}
              infoOpen={infoShown}
              onToggleInfo={() => setInfo(!infoShown, infoTab)}
              onSelect={(pane, key) =>
                update({
                  ...view,
                  focusedPane: pane,
                  panes: view.panes.map((item, index) =>
                    index === pane ? { ...item, selected: key } : item
                  ),
                })}
              onClose={close}
              launchers={launchers}
              onFocus={(pane) => update({ ...view, focusedPane: pane })}
              onMove={(key, toPane) => update(moveTab(view, key, toPane))}
              onRatio={(ratio) => update({ ...view, splitRatio: ratio })}
              renderTab={renderTab}
              renderKept={renderKept}
              tooltips={tooltips}
            />
            <InfoPanel
              placement={infoPlacement}
              tab={infoTab}
              onTab={(tab) => setInfo(infoOpen, tab)}
              onClose={() => setInfo(false, infoTab)}
            >
              {infoTab === "contexts" && contexts !== null &&
                  infoDocument !== null
                ? (
                  // 이 문서가 든 context는 새 통로가 읽고 [Open]은 그 Context 탭을 연다(workspace#R28).
                  infoPath === null ? null : (
                    <DocumentContexts
                      source={contexts.source}
                      project={projectId}
                      path={infoPath}
                      onOpenContext={(context) => openContext(host, context)}
                    />
                  )
                )
                : editor?.versions
                ? (
                  <DocumentInfoPanel
                    tab={infoTab}
                    document={infoDocument}
                    source={editor.versions}
                    viewing={infoDocument === null
                      ? null
                      : tabMeta[infoDocument]?.version ?? null}
                    refresh={versionsTick}
                    onCompare={(document, before, after) =>
                      showCompare(document, { before, after })}
                  />
                )
                : undefined}
            </InfoPanel>
            {toasts.length > 0
              ? (
                <div className={styles.toasts} data-violation-toasts="">
                  {toasts.map((toast) => (
                    <ViolationToast
                      key={toast.context}
                      title={toast.title}
                      count={toast.count}
                      timer={timer}
                      onView={() => {
                        openContext(host, toast.context, "violations");
                        setToasts((current) =>
                          current.filter((item) =>
                            item.context !== toast.context
                          )
                        );
                      }}
                      onClose={() =>
                        setToasts((current) =>
                          current.filter((item) =>
                            item.context !== toast.context
                          )
                        )}
                    />
                  ))}
                </div>
              )
              : null}
            <DockSlot
              key={dockRole}
              placement={dock}
              workPlace={{ kind: "project", id: projectId }}
              source={dockRole === "context_engineer"
                ? engineerSource ?? undefined
                : undefined}
              contexts={contextsSource === undefined ? undefined : {
                open: (id) => openContext(host, id),
                titleOf: (id) =>
                  watch.list.find((item) => item.id === id)?.title,
              }}
              onClose={() => setDockOpen(false)}
              onOpenResult={(id) => {
                const row = loaded.documents.find((item) => item.id === id);
                openDocument(
                  row ?? { id, title: tabMeta[id]?.fileName ?? id },
                );
              }}
            />
          </div>
        </div>
      </div>
    </ViewCoversProvider>
  );
}

export type { LayoutRead } from "./source.ts";
