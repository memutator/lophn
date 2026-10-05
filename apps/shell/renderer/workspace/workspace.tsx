import { type ReactNode, useEffect, useRef, useState } from "react";
import { useObservedSize } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { LophnEntry, TopBar } from "../desktop/top-bar/top-bar.tsx";
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
  normalizePane,
  type PaneState,
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
  ContextRow,
  DocumentRow,
  LayoutRead,
  ProjectView,
  WorkspaceSource,
} from "./source.ts";
import {
  type DocumentTabMeta,
  DocumentView,
  type EditorDeps,
} from "../editor/document-view.tsx";
import { closeTerminalTab, type TerminalDeps } from "../terminal/deps.ts";
import { TerminalTab } from "../terminal/terminal-tab.tsx";
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
  /** 문서 탭의 읽기·편집 통로. 없으면 문서 탭은 자리표시다. */
  editor?: EditorDeps;
  /** 터미널 탭 통로. 없으면 터미널 열기 버튼을 두지 않는다. */
  terminal?: TerminalDeps;
}

interface Loaded {
  readonly project: ProjectView | null;
  readonly documents: readonly DocumentRow[];
  readonly contexts: readonly ContextRow[];
  readonly failed: boolean;
}

interface RestoredLayout {
  readonly view: WorkspaceView | null;
  readonly infoOpen: boolean;
  readonly infoTab: InfoTab;
}

const EMPTY_LOADED: Loaded = {
  project: null,
  documents: [],
  contexts: [],
  failed: false,
};

const INFO_TABS: readonly InfoTab[] = ["info", "versions", "contexts"];

// 저장된 layout에서 화면이 쓰는 부분만 꺼낸다. 검증은 main이 이미 했다.
function viewFromLayout(layout: unknown): RestoredLayout {
  const empty: RestoredLayout = {
    view: null,
    infoOpen: false,
    infoTab: "info",
  };
  if (typeof layout !== "object" || layout === null) return empty;
  const value = layout as {
    panes?: { tabs?: TabItem[]; selected_tab?: string | null }[];
    split_ratio?: number;
    focused_pane?: number;
    information_panel?: { open?: boolean; tab?: string };
  };
  const panel = value.information_panel;
  const infoTab = INFO_TABS.find((tab) => tab === panel?.tab) ?? "info";
  const infoOpen = panel?.open === true;
  if (!Array.isArray(value.panes)) return { ...empty, infoOpen, infoTab };
  const panes: PaneState[] = value.panes.map((pane) =>
    normalizePane({
      tabs: Array.isArray(pane.tabs) ? pane.tabs : [],
      selected: pane.selected_tab ?? null,
    })
  );
  return {
    view: {
      panes,
      splitRatio: typeof value.split_ratio === "number"
        ? value.split_ratio
        : 0.5,
      focusedPane: typeof value.focused_pane === "number"
        ? value.focused_pane
        : 0,
    },
    infoOpen,
    infoTab,
  };
}

let terminalCount = 0;

function freshView(): WorkspaceView {
  return {
    panes: [{ tabs: [], selected: null }],
    splitRatio: 0.5,
    focusedPane: 0,
  };
}

// 프로젝트 작업대. sidebar·상단 경로·탭 줄·두 칸을 한 화면에 모은다.
export function Workspace(
  {
    projectId,
    source,
    windowWidth,
    bodyWidth,
    onLauncher,
    onLophn,
    terminal,
    editor,
  }: WorkspaceProps,
) {
  const [loaded, setLoaded] = useState<Loaded>(EMPTY_LOADED);
  const [view, setView] = useState<WorkspaceView>(freshView);
  const [sidebar, setSidebar] = useState<SidebarState>({
    chosenWidth: SIDEBAR_WIDTH,
    collapsedByUser: false,
  });
  const [userChoseWidth, setUserChoseWidth] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoTab, setInfoTab] = useState<InfoTab>("info");
  // 대화 도크. 정보 패널 자리를 임시로 쓰고 닫으면 정보 패널이 돌아온다(desktop#R2, R29).
  const conversation = useConversation();
  const [dockOpen, setDockOpen] = useState(false);
  // 문서 탭의 파일 이름·제목·상대 경로. 편집기가 문서를 읽으면 채운다(editor#R4).
  const [tabMeta, setTabMeta] = useState<
    Readonly<Record<string, DocumentTabMeta>>
  >({});
  const frameRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const frameSize = useObservedSize(frameRef);
  const mainSize = useObservedSize(mainRef);
  const measuredWindow = frameSize?.width ?? windowWidth;

  useEffect(() => {
    let live = true;
    const load = async () => {
      const [project, documents, contexts, layout] = await Promise.all([
        source.project(projectId),
        source.documents(projectId),
        source.contexts(projectId),
        source.readLayout(projectId),
      ]);
      if (!live) return;
      setLoaded({
        project: project.ok ? project.value : null,
        documents: documents.ok ? documents.value : [],
        contexts: contexts.ok ? contexts.value : [],
        failed: !project.ok || !documents.ok || !contexts.ok,
      });
      if (layout.ok && layout.available) {
        const restored = viewFromLayout(layout.layout);
        if (restored.view) setView(restored.view);
        setInfoOpen(restored.infoOpen);
        setInfoTab(restored.infoTab);
      }
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

  const persist = (
    next: WorkspaceView,
    info: { open: boolean; tab: InfoTab } = { open: infoOpen, tab: infoTab },
  ) => {
    void source.saveLayout({
      project: projectId,
      panes: next.panes.map((pane) => ({
        tabs: pane.tabs,
        selected_tab: pane.selected,
      })),
      split_ratio: next.splitRatio,
      focused_pane: next.focusedPane,
      information_panel: info,
    });
  };

  const update = (next: WorkspaceView) => {
    latest.current = next;
    setView(next);
    persist(next);
  };

  // 사람이 누른 터미널 열기. 시작 폴더는 탭 화면이 main에 묻는다(shell/terminal#R1).
  const openTerminal = () => {
    if (!terminal) return;
    const key = `terminal-${Date.now().toString(36)}-${++terminalCount}`;
    terminal.store.request(key);
    const pane = view.focusedPane;
    const tab: TabItem = {
      key,
      kind: "terminal",
      title: loaded.project?.title ??
        t("project-workspace.label.kind-terminal"),
    };
    update({
      ...view,
      panes: view.panes.map((item, index) =>
        index === pane ? { tabs: [...item.tabs, tab], selected: key } : item
      ),
    });
  };

  const terminalStarted = (
    key: string,
    info: { title: string | null; folderRef: string },
  ) => {
    const current = latest.current;
    update({
      ...current,
      panes: current.panes.map((pane) => ({
        ...pane,
        tabs: pane.tabs.map((tab) =>
          tab.key === key
            ? { ...tab, title: info.title ?? tab.title, folder: info.folderRef }
            : tab
        ),
      })),
    });
  };

  // 살아 있는 터미널은 사람이 확인해야 닫는다. 취소하면 탭과 shell을 유지한다(R10).
  const close = (pane: number, key: string) => {
    const tab = view.panes[pane]?.tabs.find((item) => item.key === key);
    if (tab?.kind !== "terminal" || !terminal) {
      update(closeTab(view, pane, key));
      return;
    }
    void closeTerminalTab(terminal, key).then((remove) => {
      if (!remove) return;
      const current = latest.current;
      const at = current.panes.findIndex((item) =>
        item.tabs.some((candidate) => candidate.key === key)
      );
      if (at >= 0) update(closeTab(current, at, key));
    });
  };

  const openDocument = (document: DocumentRow) => {
    const pane = view.focusedPane;
    const existing = view.panes[pane]!;
    const has = existing.tabs.some((tab) => tab.key === document.id);
    const tab: TabItem = {
      key: document.id,
      kind: "document_editor",
      title: tabMeta[document.id]?.fileName ?? document.title,
    };
    update({
      ...view,
      panes: view.panes.map((item, index) =>
        index === pane
          ? {
            tabs: has ? item.tabs : [...item.tabs, tab],
            selected: document.id,
          }
          : item
      ),
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

  // 탭 종류마다 본문. 통로가 없는 종류는 null이라 칸이 종류 자리표시를 그린다.
  const renderTab = (tab: TabItem, active: boolean): ReactNode | null => {
    if (tab.kind === "terminal" && terminal) {
      return (
        <TerminalTab
          key={tab.key}
          tabKey={tab.key}
          project={projectId}
          folderRef={tab.folder ?? null}
          active={active}
          deps={terminal}
          onStarted={(info) => terminalStarted(tab.key, info)}
        />
      );
    }
    if (tab.kind === "document_editor" && editor) {
      return (
        <DocumentView
          key={tab.key}
          documentId={tab.key}
          projectId={projectId}
          source={editor.source}
          readingWidth={editor.readingWidth}
          menu={editor.menu}
          infoOpen={infoShown}
          onToggleInfo={() => setInfo(!infoShown, infoTab)}
          onMeta={(meta) => noteMeta(tab.key, meta)}
          onOpenDocument={(id) => {
            const row = loaded.documents.find((item) => item.id === id);
            openDocument(row ?? { id, title: tabMeta[id]?.fileName ?? id });
          }}
        />
      );
    }
    return null;
  };

  const setInfo = (open: boolean, tab: InfoTab) => {
    // 정보 패널을 사람이 열면 그 자리를 쓰던 도크는 닫힌다. 둘을 쌓지 않는다(desktop#R29).
    if (open) setDockOpen(false);
    setInfoOpen(open);
    setInfoTab(tab);
    persist(view, { open, tab });
  };

  return (
    <div className={styles.workspace} data-space="project" ref={frameRef}>
      <Sidebar
        mode={sidebarShown.mode}
        width={sidebarShown.width}
        project={loaded.project}
        documents={loaded.documents}
        contexts={loaded.contexts}
        current={focused?.selected ?? null}
        onLauncher={onLauncher}
        onToggle={() =>
          setSidebar((current) => ({
            ...current,
            collapsedByUser: sidebarShown.mode !== "collapsed",
          }))}
        onOpenDocument={openDocument}
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
              <>
                {conversation
                  ? (
                    <DockToggle
                      open={dockOpen}
                      onToggle={() => setDockOpen(!dockOpen)}
                    />
                  )
                  : null}
                <LophnEntry onLophn={onLophn} />
              </>
            }
          />
        </div>
        {loaded.failed
          ? (
            <p className={styles.notice} data-load-failed="">
              {t("project-workspace.error.load-failed")}
            </p>
          )
          : null}
        <div className={styles.content} ref={mainRef}>
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
            onOpenTerminal={terminal ? openTerminal : undefined}
            onFocus={(pane) => update({ ...view, focusedPane: pane })}
            onMove={(key, toPane) => update(moveTab(view, key, toPane))}
            onRatio={(ratio) => update({ ...view, splitRatio: ratio })}
            renderTab={renderTab}
            tooltips={tooltips}
          />
          <InfoPanel
            placement={infoPlacement}
            tab={infoTab}
            onTab={(tab) => setInfo(infoOpen, tab)}
          />
          <DockSlot
            placement={dock}
            workPlace={{ kind: "project", id: projectId }}
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
  );
}

export type { LayoutRead };
