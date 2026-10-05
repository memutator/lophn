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

function freshView(): WorkspaceView {
  return {
    panes: [{ tabs: [], selected: null }],
    splitRatio: 0.5,
    focusedPane: 0,
  };
}

// 프로젝트 작업대. sidebar·상단 경로·탭 줄·두 칸을 한 화면에 모은다.
export function Workspace(
  { projectId, source, windowWidth, bodyWidth, onLauncher, onLophn, editor }:
    WorkspaceProps,
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
  const infoPlacement = infoPanelPlacement(
    infoOpen,
    contentWidth,
    view.panes.length,
  );
  const panesWidth = infoPlacement === "docked"
    ? contentWidth - INFO_PANEL_WIDTH
    : contentWidth;

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
    setView(next);
    persist(next);
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

  const renderTab = editor
    ? (tab: TabItem) =>
      tab.kind === "document_editor"
        ? (
          <DocumentView
            key={tab.key}
            documentId={tab.key}
            projectId={projectId}
            source={editor.source}
            readingWidth={editor.readingWidth}
            menu={editor.menu}
            infoOpen={infoOpen}
            onToggleInfo={() => setInfo(!infoOpen, infoTab)}
            onMeta={(meta) => noteMeta(tab.key, meta)}
            onOpenDocument={(id) => {
              const row = loaded.documents.find((item) => item.id === id);
              openDocument(row ?? { id, title: tabMeta[id]?.fileName ?? id });
            }}
          />
        )
        : null
    : undefined;

  const setInfo = (open: boolean, tab: InfoTab) => {
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
            trailing={<LophnEntry onLophn={onLophn} />}
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
            infoOpen={infoOpen}
            onToggleInfo={() => setInfo(!infoOpen, infoTab)}
            onSelect={(pane, key) =>
              update({
                ...view,
                focusedPane: pane,
                panes: view.panes.map((item, index) =>
                  index === pane ? { ...item, selected: key } : item
                ),
              })}
            onClose={(pane, key) => update(closeTab(view, pane, key))}
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
        </div>
      </div>
    </div>
  );
}

export type { LayoutRead };
