import { useEffect, useRef, useState } from "react";
import { useObservedSize } from "@lophn/design/components";
import { t } from "@lophn/wording";

import { TopBar } from "../desktop/top-bar/top-bar.tsx";
import { Breadcrumbs } from "../desktop/top-bar/breadcrumbs.tsx";
import {
  applyDrag,
  breadcrumbs,
  clampSidebar,
  type DragOutcome,
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
  { projectId, source, windowWidth, bodyWidth, onLauncher, onLophn }:
    WorkspaceProps,
) {
  const [loaded, setLoaded] = useState<Loaded>(EMPTY_LOADED);
  const [view, setView] = useState<WorkspaceView>(freshView);
  const [sidebar, setSidebar] = useState<SidebarState>({
    chosenWidth: SIDEBAR_WIDTH,
    collapsedByUser: false,
  });
  const [userChoseWidth, setUserChoseWidth] = useState(false);
  const [dragStart, setDragStart] = useState<number | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoTab, setInfoTab] = useState<InfoTab>("info");
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

  const openDocument = (document: DocumentRow) => {
    setView((current) => {
      const pane = current.focusedPane;
      const existing = current.panes[pane]!;
      if (existing.tabs.some((tab) => tab.key === document.id)) {
        return {
          ...current,
          panes: current.panes.map((item, index) =>
            index === pane ? { ...item, selected: document.id } : item
          ),
        };
      }
      const tab: TabItem = {
        key: document.id,
        kind: "document_editor",
        title: document.title,
      };
      return {
        ...current,
        panes: current.panes.map((item, index) =>
          index === pane
            ? { tabs: [...item.tabs, tab], selected: document.id }
            : item
        ),
      };
    });
  };

  const persist = (next: WorkspaceView) => {
    void source.saveLayout({
      project: projectId,
      panes: next.panes.map((pane) => ({
        tabs: pane.tabs,
        selected_tab: pane.selected,
      })),
      split_ratio: next.splitRatio,
      focused_pane: next.focusedPane,
      information_panel: { open: infoOpen, tab: infoTab },
    });
  };

  const update = (next: WorkspaceView) => {
    setView(next);
    persist(next);
  };

  return (
    <div className={styles.workspace} data-space="project" ref={frameRef}>
      <TopBar
        leading={sidebarShown.launcherInTopBar
          ? (
            <button
              type="button"
              data-launcher-back=""
              onClick={onLauncher}
            >
              {t("project-workspace.button.launcher")}
            </button>
          )
          : <Breadcrumbs crumbs={crumbs} />}
        onLophn={onLophn}
      />
      <div className={styles.row}>
        <Sidebar
          mode={sidebarShown.mode}
          width={sidebarShown.width}
          project={loaded.project}
          documents={loaded.documents}
          contexts={loaded.contexts}
          onLauncher={onLauncher}
          onToggle={() =>
            setSidebar((current) => ({
              ...current,
              collapsedByUser: sidebarShown.mode !== "collapsed",
            }))}
          onOpenDocument={openDocument}
        />
        {sidebarShown.mode === "open"
          ? (
            <SidebarResizer
              width={sidebarShown.width}
              onDrag={(next) =>
                setSidebar((current) => ({ ...current, chosenWidth: next }))}
              onCommit={(outcome) => {
                const applied = applyDrag(
                  dragStart ?? sidebar.chosenWidth,
                  sidebar.chosenWidth,
                  outcome,
                );
                setSidebar((current) => ({ ...current, chosenWidth: applied }));
                setUserChoseWidth(outcome.type === "drag-end");
                setDragStart(null);
              }}
              onStart={() => setDragStart(sidebar.chosenWidth)}
            />
          )
          : null}
        <div className={styles.main} ref={mainRef}>
          {loaded.failed
            ? (
              <p className={styles.notice} data-load-failed="">
                {t("project-workspace.error.load-failed")}
              </p>
            )
            : null}
          <Panes
            view={view}
            bodyWidth={mainSize?.width ?? bodyWidth}
            windowWidth={measuredWindow}
            onSelect={(pane, key) =>
              update({
                ...view,
                focusedPane: pane,
                panes: view.panes.map((item, index) =>
                  index === pane ? { ...item, selected: key } : item
                ),
              })}
            onClose={(pane, key) =>
              update({
                ...view,
                panes: view.panes.map((item, index) =>
                  index === pane
                    ? normalizePane({
                      tabs: item.tabs.filter((tab) => tab.key !== key),
                      selected: item.selected,
                    })
                    : item
                ),
              })}
            onFocus={(pane) => update({ ...view, focusedPane: pane })}
            onMove={(key, toPane) => update(moveTab(view, key, toPane))}
            onRatio={(ratio) => update({ ...view, splitRatio: ratio })}
          />
          <InfoPanel
            placement={infoPanelPlacement(
              infoOpen,
              bodyWidth,
              view.panes.length,
            )}
            tab={infoTab}
            onTab={setInfoTab}
          />
        </div>
      </div>
    </div>
  );
}

interface SidebarResizerProps {
  width: number;
  onStart: () => void;
  onDrag: (width: number) => void;
  onCommit: (outcome: DragOutcome) => void;
}

// sidebar 폭 drag. drag-end의 마지막 값만 적용하고 drag-cancel은 되돌린다.
function SidebarResizer(
  { width, onStart, onDrag, onCommit }: SidebarResizerProps,
) {
  return (
    <div
      data-sidebar-resizer=""
      role="separator"
      onPointerDown={(event) => {
        onStart();
        const startX = event.clientX;
        const startWidth = width;
        let last = startWidth;
        const move = (next: PointerEvent) => {
          last = clampSidebar(startWidth + next.clientX - startX);
          onDrag(last);
        };
        const up = () => {
          globalThis.removeEventListener("pointermove", move);
          globalThis.removeEventListener("pointerup", up);
          globalThis.removeEventListener("pointercancel", cancel);
          onCommit({ type: "drag-end", x: last, y: 0 });
        };
        const cancel = () => {
          globalThis.removeEventListener("pointermove", move);
          globalThis.removeEventListener("pointerup", up);
          globalThis.removeEventListener("pointercancel", cancel);
          onCommit({ type: "drag-cancel" });
        };
        globalThis.addEventListener("pointermove", move);
        globalThis.addEventListener("pointerup", up);
        globalThis.addEventListener("pointercancel", cancel);
      }}
    />
  );
}

export type { LayoutRead };
