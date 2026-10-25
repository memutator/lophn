import { Fragment, type ReactNode, useState } from "react";
import {
  type TabItem as StripTab,
  TabStrip,
} from "../../parts/tab-strip/tab-strip.tsx";
import { Icon, IconButton } from "@lophn/ui/primitives";
import { Menu, MenuIcon, Tooltip } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import { workspaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import {
  applyDrag,
  BREAKPOINT_MD,
  type CloseScope,
  type PaneState,
  ratioFromDrag,
  SPLIT_EQUAL,
  splitLayout,
  type TabItem,
  type WorkspaceView,
} from "../model.ts";
import { PATH_DRAG_TYPE, startPointerDrag } from "../drag.ts";
import styles from "./panes.module.css";

/** 칸 폭이 이보다 좁으면 본문 여백을 16px로 줄인다. */
const PANE_PADDING_WIDE_MIN = 640;

interface PanesProps {
  view: WorkspaceView;
  /** focus 색을 가질 칸. 맨 위 floated 패널에 focus가 있으면 null이다. */
  focusedPane: number | null;
  /** 칸을 그릴 본문 폭. */
  bodyWidth: number;
  /** 창 폭. 본문 여백을 정한다. */
  windowWidth: number;
  onSelect: (pane: number, key: string) => void;
  onClose: (pane: number, key: string) => void;
  /** 탭 menu의 Close Others·Close to the Right·Close Saved·Close All. */
  onCloseMany: (pane: number, scope: CloseScope, key: string) => void;
  /** preview 탭을 고정한다(탭 double-click, menu의 Keep Open). */
  onPin: (key: string) => void;
  /** 탭 menu의 Float. */
  onFloat: (pane: number, key: string) => void;
  /** 탭 menu의 Detach. 없으면 항목을 두지 않는다. */
  onDetach?: (pane: number, key: string) => void;
  /** Detach할 수 있는 탭인지. 없으면 모두 할 수 있다. */
  canDetach?: (tab: TabItem) => boolean;
  /** 탭이 파일이면 그 경로. 아니면 null이다. 경로 복사·Explorer에서 보기가 이 탭에만 생긴다. */
  pathOf: (tab: TabItem) => string | null;
  onCopyPath: (path: string, relative: boolean) => void;
  onReveal: (path: string) => void;
  onFocus: (pane: number) => void;
  /**
   * 탭을 옮긴다. before 탭 앞에 넣고 없으면 끝이다. 같은 칸이어도 before가 있으면 순서만 바꾼다.
   * 한 칸에서 1로 옮기면 칸을 나눈다.
   */
  onMove: (key: string, toPane: number, before?: string | null) => void;
  /** 경계 drag가 끝나거나 두 번 눌렀을 때의 비율. */
  onRatio: (ratio: number) => void;
  /** Explorer에서 끌어 온 파일을 그 칸에 연다. */
  onDropPath: (pane: number, path: string) => void;
  /** 마지막 칸 탭 줄 끝의 새 탭(+) 단추. */
  newTab?: ReactNode;
  /** 탭 줄이 그리는 탭 하나(아이콘, 이름 뒤 상태 점). */
  stripTab: (tab: TabItem) => StripTab;
  /**
   * 탭 본문을 그린다. null을 주면 기본 본문을 쓴다. active는 focus 칸의 고른
   * 탭인지다.
   */
  renderTab?: (tab: TabItem, active: boolean) => ReactNode | null;
  /**
   * 고르지 않아도 칸에 남겨 둘 탭 본문(앱 패널). null이 아니면 그 칸의 모든 그런 탭을 그리고
   * 고른 탭만 보인다. shown은 그 탭이 칸에서 보이는지다.
   */
  renderKept?: (tab: TabItem, shown: boolean) => ReactNode | null;
}

// 좌우 1칸 또는 2칸. 폭이 부족하면 한 칸 보기로 그린다.
export function Panes(
  {
    view,
    focusedPane,
    bodyWidth,
    windowWidth,
    onSelect,
    onClose,
    onCloseMany,
    onPin,
    onFloat,
    onDetach,
    canDetach,
    pathOf,
    onCopyPath,
    onReveal,
    onFocus,
    onMove,
    onRatio,
    onDropPath,
    newTab,
    stripTab,
    renderTab,
    renderKept,
  }: PanesProps,
) {
  // 경계 drag 중 미리보기 비율. drag-end에서만 저장한다.
  const [preview, setPreview] = useState<number | null>(null);
  const shownView = preview === null ? view : { ...view, splitRatio: preview };
  const layout = splitLayout(bodyWidth, shownView);
  const shown = layout.visiblePanes === 1 ? [layout.shownPane] : [0, 1];
  const single = view.panes.length === 1;

  const end = (index: number, position: number): ReactNode => {
    const pane = view.panes[index]!;
    const label = single
      ? t("project-workspace.button.split-pane")
      : t("project-workspace.button.move-pane");
    return (
      <>
        {position === shown.length - 1 ? newTab : null}
        {single || shown.length === 2
          ? (
            <Tooltip content={label}>
              <IconButton
                icon={workspaceIcons.splitPane}
                label={label}
                size="sm"
                data-split-pane=""
                disabled={single
                  ? pane.tabs.length < 2
                  : pane.selected === null}
                onClick={() => {
                  if (pane.selected) {
                    onMove(
                      pane.selected,
                      single ? 1 : 1 - index,
                    );
                  }
                }}
              />
            </Tooltip>
          )
          : null}
      </>
    );
  };

  return (
    <div className={styles.panes} data-panes={layout.visiblePanes}>
      {shown.map((index, position) => {
        const width = position === 0 ? layout.leftWidth : layout.rightWidth;
        const wide = windowWidth >= BREAKPOINT_MD &&
          width >= PANE_PADDING_WIDE_MIN;
        return (
          <Fragment key={index}>
            {position === 1
              ? (
                <div
                  className={styles.divider}
                  data-divider=""
                  role="separator"
                  aria-orientation="vertical"
                  onDoubleClick={() => onRatio(SPLIT_EQUAL)}
                  onPointerDown={(event) => {
                    const start = view.splitRatio;
                    const startLeft = layout.leftWidth;
                    let last = start;
                    startPointerDrag(event, {
                      move: (dx) => {
                        last = ratioFromDrag(bodyWidth, startLeft + dx);
                        setPreview(last);
                      },
                      finish: (outcome) => {
                        setPreview(null);
                        const next = applyDrag(start, last, outcome);
                        if (next !== start) onRatio(next);
                      },
                    });
                  }}
                >
                  <div className={styles.grab} data-grab="" />
                </div>
              )
              : null}
            <PaneView
              index={index}
              pane={view.panes[index]!}
              width={layout.visiblePanes === 2 && position === 0 ? width : null}
              focused={focusedPane === index}
              wide={wide}
              end={end(index, position)}
              stripTab={stripTab}
              renderTab={renderTab}
              renderKept={renderKept}
              pathOf={pathOf}
              onSelect={(key) => onSelect(index, key)}
              onClose={(key) => onClose(index, key)}
              onCloseMany={(scope, key) => onCloseMany(index, scope, key)}
              onPin={onPin}
              onFloat={(key) => onFloat(index, key)}
              onDetach={onDetach && ((key) => onDetach(index, key))}
              canDetach={canDetach}
              onCopyPath={onCopyPath}
              onReveal={onReveal}
              onReorder={(key, before) => onMove(key, index, before)}
              onFocus={() => onFocus(index)}
              onDropPath={(path) => onDropPath(index, path)}
            />
          </Fragment>
        );
      })}
    </div>
  );
}

interface PaneViewProps {
  index: number;
  pane: PaneState;
  /** 두 칸의 왼쪽 칸 폭. 나머지 칸은 남은 폭을 채운다. */
  width: number | null;
  focused: boolean;
  wide: boolean;
  end: ReactNode;
  stripTab: (tab: TabItem) => StripTab;
  renderTab?: (tab: TabItem, active: boolean) => ReactNode | null;
  renderKept?: (tab: TabItem, shown: boolean) => ReactNode | null;
  pathOf: (tab: TabItem) => string | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onCloseMany: (scope: CloseScope, key: string) => void;
  onPin: (key: string) => void;
  onFloat: (key: string) => void;
  onDetach?: (key: string) => void;
  canDetach?: (tab: TabItem) => boolean;
  onCopyPath: (path: string, relative: boolean) => void;
  onReveal: (path: string) => void;
  onReorder: (key: string, before: string | null) => void;
  onFocus: () => void;
  onDropPath: (path: string) => void;
}

function PaneView(
  {
    index,
    pane,
    width,
    focused,
    wide,
    end,
    stripTab,
    renderTab,
    renderKept,
    pathOf,
    onSelect,
    onClose,
    onCloseMany,
    onPin,
    onFloat,
    onDetach,
    canDetach,
    onCopyPath,
    onReveal,
    onReorder,
    onFocus,
    onDropPath,
  }: PaneViewProps,
) {
  const [menu, setMenu] = useState<
    { key: string; x: number; y: number } | null
  >(null);
  // Explorer의 파일을 이 칸 위로 끄는 중이다.
  const [dropping, setDropping] = useState(false);
  const menuTab = menu === null
    ? undefined
    : pane.tabs.find((tab) => tab.key === menu.key);
  const menuPath = menuTab === undefined ? null : pathOf(menuTab);
  const menuItems = menuTab === undefined ? [] : [
    {
      id: "close",
      label: t("project-workspace.button.tab-close"),
      leading: <MenuIcon icon={workspaceIcons.close} />,
    },
    {
      id: "others",
      label: t("project-workspace.button.tab-close-others"),
      leading: <MenuIcon icon={workspaceIcons.closeOthers} />,
      disabled: pane.tabs.length < 2,
    },
    {
      id: "right",
      label: t("project-workspace.button.tab-close-right"),
      leading: <MenuIcon icon={workspaceIcons.closeRight} />,
      disabled: pane.tabs[pane.tabs.length - 1]?.key === menuTab.key,
    },
    {
      id: "saved",
      label: t("project-workspace.button.tab-close-saved"),
      leading: <MenuIcon icon={workspaceIcons.closeSaved} />,
    },
    {
      id: "all",
      label: t("project-workspace.button.tab-close-all"),
      leading: <MenuIcon icon={workspaceIcons.closeAll} />,
    },
    {
      id: "float",
      label: t("project-workspace.button.tab-float"),
      leading: <MenuIcon icon={workspaceIcons.float} />,
      separatorBefore: true,
    },
    ...(onDetach && (canDetach?.(menuTab) ?? true)
      ? [{
        id: "detach",
        label: t("project-workspace.button.tab-detach"),
        leading: <MenuIcon icon={workspaceIcons.detach} />,
      }]
      : []),
    ...(menuPath === null ? [] : [
      {
        id: "copy-path",
        label: t("project-workspace.button.tab-copy-path"),
        leading: <MenuIcon icon={workspaceIcons.copyPath} />,
        separatorBefore: true,
      },
      {
        id: "copy-relative-path",
        label: t("project-workspace.button.tab-copy-relative-path"),
        leading: <MenuIcon icon={workspaceIcons.copyRelativePath} />,
      },
      {
        id: "reveal",
        label: t("project-workspace.button.tab-reveal"),
        leading: <MenuIcon icon={workspaceIcons.revealInExplorer} />,
        separatorBefore: true,
      },
    ]),
    ...(menuTab.preview === true
      ? [{
        id: "keep-open",
        label: t("project-workspace.button.tab-keep-open"),
        leading: <MenuIcon icon={workspaceIcons.keepOpen} />,
        separatorBefore: true,
      }]
      : []),
  ];
  const chooseMenu = (id: string) => {
    if (menuTab === undefined) return;
    if (id === "close") onClose(menuTab.key);
    else if (id === "others") onCloseMany("others", menuTab.key);
    else if (id === "right") onCloseMany("right", menuTab.key);
    else if (id === "saved") onCloseMany("saved", menuTab.key);
    else if (id === "all") onCloseMany("all", menuTab.key);
    else if (id === "float") onFloat(menuTab.key);
    else if (id === "detach") onDetach?.(menuTab.key);
    else if (id === "keep-open") onPin(menuTab.key);
    else if (menuPath !== null) {
      if (id === "copy-path") onCopyPath(menuPath, false);
      else if (id === "copy-relative-path") onCopyPath(menuPath, true);
      else if (id === "reveal") onReveal(menuPath);
    }
  };
  const selected = pane.tabs.find((tab) => tab.key === pane.selected);
  // 앱 패널은 고르지 않아도 칸에 남는다. 다른 탭을 고르면 숨고 닫으면 빠진다.
  const kept = renderKept
    ? pane.tabs.flatMap((tab) => {
      const node = renderKept(tab, tab.key === pane.selected);
      return node === null ? [] : [{ tab, node }];
    })
    : [];
  const keptSelected = kept.some(({ tab }) => tab.key === pane.selected);
  const custom = keptSelected
    ? null
    : selected && renderTab
    ? renderTab(selected, focused)
    : null;
  return (
    <section
      className={`${styles.pane} ${width === null ? "" : styles.sized}`}
      data-pane={index}
      data-focused={focused ? "true" : "false"}
      style={width === null
        ? undefined
        : { width: `${width}px`, flexBasis: `${width}px` }}
      data-drop={dropping ? "" : undefined}
      onPointerDown={onFocus}
      onFocusCapture={onFocus}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(PATH_DRAG_TYPE)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) {
          setDropping(false);
        }
      }}
      onDrop={(event) => {
        setDropping(false);
        const path = event.dataTransfer.getData(PATH_DRAG_TYPE);
        if (path === "") return;
        event.preventDefault();
        onDropPath(path);
      }}
    >
      <TabStrip
        tabs={pane.tabs.map(stripTab)}
        selected={pane.selected ?? ""}
        focused={focused}
        onSelect={onSelect}
        onClose={onClose}
        onPin={onPin}
        onMenu={(key, at) => setMenu({ key, ...at })}
        onReorder={onReorder}
        end={end}
      />
      {menu === null || menuTab === undefined ? null : (
        <Menu
          open
          onOpenChange={(open) => {
            if (!open) setMenu(null);
          }}
          trigger={
            <span
              className={styles.menuAnchor}
              style={{ left: menu.x, top: menu.y }}
            />
          }
          items={menuItems}
          onSelect={(id) => {
            chooseMenu(id);
            setMenu(null);
          }}
        />
      )}
      <div
        className={`${styles.body} ${wide ? "" : styles.narrow} ${
          custom || keptSelected ? styles.flush : ""
        }`}
        data-pane-body=""
        role="tabpanel"
      >
        {kept.map(({ tab, node }) => (
          <div
            key={tab.key}
            className={styles.kept}
            data-kept-tab={tab.key}
            hidden={tab.key !== pane.selected}
          >
            {node}
          </div>
        ))}
        {keptSelected
          ? null
          : custom ?? (selected
            ? (
              <div className={styles.content} data-tab-body={selected.key}>
                <h1 className={styles.heading}>{selected.title}</h1>
              </div>
            )
            : (
              <div className={styles.placeholderWrap}>
                <div className={styles.placeholder} data-pane-empty="">
                  <Icon
                    icon={workspaceIcons.document}
                    pixels={iconPixels("large")}
                    className={styles.placeholderIcon}
                  />
                  <p className={styles.placeholderText}>
                    {t("project-workspace.empty.no-tabs")}
                  </p>
                </div>
              </div>
            ))}
      </div>
    </section>
  );
}
