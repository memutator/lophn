import { type CSSProperties, type ReactNode, useRef, useState } from "react";
import {
  TAB_MIME,
  type TabItem as StripTab,
  TabStrip,
} from "../../parts/tab-strip/tab-strip.tsx";
import { Icon, IconButton } from "@lophn/ui/primitives";
import { Menu, MenuIcon, Tooltip } from "@lophn/ui/overlay";
import { iconPixels, useObservedSize } from "@lophn/ui/shared";
import { editorIcons, workspaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/i18n";

import {
  applyDrag,
  BREAKPOINT_MD,
  type CloseScope,
  type PaneDropZone,
  type PaneState,
  type TabItem,
  type WorkspaceView,
} from "../model.ts";
import {
  arrange,
  fitsArea,
  MAX_PANES,
  nodeAt,
  type PaneSide,
  ratioFromDrag,
  SPLIT_EQUAL,
  setRatio,
} from "../layout-tree.ts";
import { PATH_DRAG_TYPE, startPointerDrag } from "../drag.ts";
import styles from "./panes.module.css";

/** 칸 폭이 이보다 좁으면 본문 여백을 16px로 줄인다. */
const PANE_PADDING_WIDE_MIN = 640;

interface PanesProps {
  view: WorkspaceView;
  /** focus 색을 가질 칸. 맨 위 floated 패널에 focus가 있으면 null이다. */
  focusedPane: number | null;
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
  /** 탭 menu의 Minimize. floated로 만들며 바로 접는다. */
  onMinimize: (pane: number, key: string) => void;
  /** 이름 바꾸기 입력의 확정. null이면 사람이 붙인 이름을 지운다. renamable 탭에만 온다. */
  onRename: (key: string, name: string | null) => void;
  /** 탭 menu의 Detach. 없으면 항목을 두지 않는다. */
  onDetach?: (pane: number, key: string) => void;
  /** Detach할 수 있는 탭인지. 없으면 모두 할 수 있다. */
  canDetach?: (tab: TabItem) => boolean;
  /** 탭이 파일이면 그 경로. 아니면 null이다. 경로 복사·Explorer에서 보기가 이 탭에만 생긴다. */
  pathOf: (tab: TabItem) => string | null;
  onCopyPath: (path: string, relative: boolean) => void;
  onReveal: (path: string) => void;
  onFocus: (pane: number) => void;
  /** 탭을 옮긴다. before 탭 앞에 넣고 없으면 끝이다. 같은 칸이어도 before가 있으면 순서만 바꾼다. */
  onMove: (key: string, toPane: number, before?: string | null) => void;
  /** 탭을 그 칸 곁의 새 칸으로 나눈다(탭 menu의 Split, 탭 줄 끝의 단추). */
  onSplit: (pane: number, key: string, side: PaneSide) => void;
  /** 경계 drag가 끝나거나 두 번 눌렀을 때의 비율. path는 layout-tree.ts의 나눔 경로다. */
  onRatio: (path: string, ratio: number) => void;
  /** Explorer에서 끌어 온 파일을 그 칸에 연다. */
  onDropPath: (pane: number, path: string) => void;
  /** 탭을 칸 본문의 가장자리·가운데에 놓았다. */
  onDropTab?: (pane: number, key: string, zone: PaneDropZone) => void;
  /** 맨 위 오른쪽 칸 탭 줄 끝의 새 탭(+) 단추. */
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

// 칸을 `view.layout` tree대로 좌우·상하로 나눠 그린다. 모든 칸이 최소 크기로 들어가지 않으면 focus 칸 하나만 그린다.
export function Panes({
  view,
  focusedPane,
  windowWidth,
  onSelect,
  onClose,
  onCloseMany,
  onPin,
  onFloat,
  onMinimize,
  onRename,
  onDetach,
  canDetach,
  pathOf,
  onCopyPath,
  onReveal,
  onFocus,
  onMove,
  onSplit,
  onRatio,
  onDropPath,
  onDropTab,
  newTab,
  stripTab,
  renderTab,
  renderKept,
}: PanesProps) {
  const ref = useRef<HTMLDivElement>(null);
  const size = useObservedSize(ref);
  // 경계 drag 중 미리보기 비율. drag-end에서만 저장한다.
  const [preview, setPreview] = useState<{
    path: string;
    ratio: number;
  } | null>(null);
  const layout =
    preview === null
      ? view.layout
      : setRatio(view.layout, preview.path, preview.ratio);
  const arranged =
    size !== undefined &&
    view.panes.length > 1 &&
    fitsArea(layout, size.width, size.height)
      ? arrange(layout, { x: 0, y: 0, ...size })
      : null;
  const focus = Math.min(view.focusedPane, view.panes.length - 1);
  const shown = arranged ? view.panes.map((_, index) => index) : [focus];
  // 새 탭 단추는 맨 위 줄에서 가장 오른쪽 칸의 탭 줄 끝에 둔다.
  const newTabPane = arranged
    ? arranged.panes.reduce(
        (best, box, index) =>
          box.y === 0 &&
          box.x + box.width >
            arranged.panes[best]!.x + arranged.panes[best]!.width
            ? index
            : best,
        0,
      )
    : focus;
  const canSplit = view.panes.length < MAX_PANES;

  return (
    <div ref={ref} className={styles.panes} data-panes={shown.length}>
      {shown.map((index) => {
        const pane = view.panes[index]!;
        const box = arranged?.panes[index];
        const edgeRight =
          box !== undefined &&
          arranged!.dividers.some(
            (divider) =>
              divider.dir === "row" &&
              divider.x === box.x + box.width &&
              divider.y < box.y + box.height &&
              divider.y + divider.height > box.y,
          );
        const edgeBottom =
          box !== undefined &&
          arranged!.dividers.some(
            (divider) =>
              divider.dir === "column" &&
              divider.y === box.y + box.height &&
              divider.x < box.x + box.width &&
              divider.x + divider.width > box.x,
          );
        const split = canSplit && pane.tabs.length >= 2;
        return (
          <PaneView
            key={index}
            index={index}
            pane={pane}
            style={
              box === undefined
                ? { inset: 0 }
                : {
                    left: box.x,
                    top: box.y,
                    width: box.width,
                    height: box.height,
                  }
            }
            edgeRight={edgeRight}
            edgeBottom={edgeBottom}
            canSplit={split}
            focused={focusedPane === index}
            wide={
              windowWidth >= BREAKPOINT_MD &&
              (box?.width ?? size?.width ?? 0) >= PANE_PADDING_WIDE_MIN
            }
            end={
              <>
                {index === newTabPane ? newTab : null}
                <Tooltip content={t("project-workspace.button.split-pane")}>
                  <IconButton
                    icon={workspaceIcons.splitPane}
                    label={t("project-workspace.button.split-pane")}
                    size="sm"
                    data-split-pane=""
                    disabled={!split || pane.selected === null}
                    onClick={() => {
                      if (pane.selected) onSplit(index, pane.selected, "right");
                    }}
                  />
                </Tooltip>
              </>
            }
            stripTab={stripTab}
            renderTab={renderTab}
            renderKept={renderKept}
            pathOf={pathOf}
            onSelect={(key) => onSelect(index, key)}
            onClose={(key) => onClose(index, key)}
            onCloseMany={(scope, key) => onCloseMany(index, scope, key)}
            onPin={onPin}
            onFloat={(key) => onFloat(index, key)}
            onMinimize={(key) => onMinimize(index, key)}
            onSplit={(key, side) => onSplit(index, key, side)}
            onRename={onRename}
            onDetach={onDetach && ((key) => onDetach(index, key))}
            canDetach={canDetach}
            onCopyPath={onCopyPath}
            onReveal={onReveal}
            onReorder={(key, before) => onMove(key, index, before)}
            onFocus={() => onFocus(index)}
            onDropPath={(path) => onDropPath(index, path)}
            onDropTab={
              onDropTab && ((key, zone) => onDropTab(index, key, zone))
            }
          />
        );
      })}
      {arranged?.dividers.map((divider) => (
        <div
          key={divider.path}
          className={styles.divider}
          data-divider=""
          data-dir={divider.dir}
          role="separator"
          aria-orientation={divider.dir === "row" ? "vertical" : "horizontal"}
          style={{
            left: divider.x,
            top: divider.y,
            width: divider.width,
            height: divider.height,
          }}
          onDoubleClick={() => onRatio(divider.path, SPLIT_EQUAL)}
          onPointerDown={(event) => {
            const start =
              nodeAt(view.layout, divider.path)?.ratio ?? SPLIT_EQUAL;
            let last = start;
            startPointerDrag(event, {
              move: (dx, dy) => {
                last = ratioFromDrag(divider, divider.dir === "row" ? dx : dy);
                setPreview({ path: divider.path, ratio: last });
              },
              finish: (outcome) => {
                setPreview(null);
                const next = applyDrag(start, last, outcome);
                if (next !== start) onRatio(divider.path, next);
              },
            });
          }}
        >
          <div className={styles.grab} data-grab="" />
        </div>
      ))}
    </div>
  );
}

interface PaneViewProps {
  index: number;
  pane: PaneState;
  /** 칸 사각형(left·top·width·height px). 한 칸 보기에서는 영역 전체다. */
  style: CSSProperties;
  /** 오른쪽·아래 가장자리에 경계 잡는 띠가 걸린다. 본문 scrollbar가 띠 밑에 깔리지 않게 비운다. */
  edgeRight: boolean;
  edgeBottom: boolean;
  /** 이 칸의 고른 탭을 곁의 새 칸으로 나눌 수 있는지. */
  canSplit: boolean;
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
  onMinimize: (key: string) => void;
  onSplit: (key: string, side: PaneSide) => void;
  onRename: (key: string, name: string | null) => void;
  onDetach?: (key: string) => void;
  canDetach?: (tab: TabItem) => boolean;
  onCopyPath: (path: string, relative: boolean) => void;
  onReveal: (path: string) => void;
  onReorder: (key: string, before: string | null) => void;
  onFocus: () => void;
  onDropPath: (path: string) => void;
  onDropTab?: (key: string, zone: PaneDropZone) => void;
}

/**
 * 칸 본문 위의 놓을 자리. 가장자리 25% 안이면 가까운 쪽 가장자리, 아니면 가운데다.
 * x·y는 본문 안 위치의 0~1 비율이다.
 */
function dropZoneAt(x: number, y: number): PaneDropZone {
  const nearX = Math.min(x, 1 - x);
  const nearY = Math.min(y, 1 - y);
  if (Math.min(nearX, nearY) >= 0.25) return "center";
  if (nearX <= nearY) return x < 0.5 ? "left" : "right";
  return y < 0.5 ? "top" : "bottom";
}

function PaneView({
  index,
  pane,
  style,
  edgeRight,
  edgeBottom,
  canSplit,
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
  onMinimize,
  onSplit,
  onRename,
  onDetach,
  canDetach,
  onCopyPath,
  onReveal,
  onReorder,
  onFocus,
  onDropPath,
  onDropTab,
}: PaneViewProps) {
  const [menu, setMenu] = useState<{
    key: string;
    x: number;
    y: number;
  } | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  // Explorer의 파일을 이 칸 위로 끄는 중이다.
  const [dropping, setDropping] = useState(false);
  // 탭을 이 칸 본문 위로 끄는 중이다. 놓으면 갈 자리.
  const [tabDrop, setTabDrop] = useState<PaneDropZone | null>(null);
  const menuTab =
    menu === null ? undefined : pane.tabs.find((tab) => tab.key === menu.key);
  const menuPath = menuTab === undefined ? null : pathOf(menuTab);
  const menuItems =
    menuTab === undefined
      ? []
      : [
          ...(stripTab(menuTab).renamable
            ? [
                {
                  id: "rename",
                  label: t("project-workspace.button.tab-rename"),
                  leading: <MenuIcon icon={editorIcons.edit} />,
                },
              ]
            : []),
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
            id: "split-right",
            label: t("project-workspace.button.tab-split-right"),
            leading: <MenuIcon icon={workspaceIcons.splitPane} />,
            disabled: !canSplit,
            separatorBefore: true,
          },
          {
            id: "split-down",
            label: t("project-workspace.button.tab-split-down"),
            leading: <MenuIcon icon={workspaceIcons.splitDown} />,
            disabled: !canSplit,
          },
          {
            id: "float",
            label: t("project-workspace.button.tab-float"),
            leading: <MenuIcon icon={workspaceIcons.float} />,
            separatorBefore: true,
          },
          {
            id: "minimize",
            label: t("project-workspace.button.tab-minimize"),
            leading: <MenuIcon icon={workspaceIcons.minimize} />,
          },
          ...(onDetach && (canDetach?.(menuTab) ?? true)
            ? [
                {
                  id: "detach",
                  label: t("project-workspace.button.tab-detach"),
                  leading: <MenuIcon icon={workspaceIcons.detach} />,
                },
              ]
            : []),
          ...(menuPath === null
            ? []
            : [
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
            ? [
                {
                  id: "keep-open",
                  label: t("project-workspace.button.tab-keep-open"),
                  leading: <MenuIcon icon={workspaceIcons.keepOpen} />,
                  separatorBefore: true,
                },
              ]
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
    else if (id === "minimize") onMinimize(menuTab.key);
    else if (id === "split-right") onSplit(menuTab.key, "right");
    else if (id === "split-down") onSplit(menuTab.key, "bottom");
    else if (id === "rename") setRenaming(menuTab.key);
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
      className={styles.pane}
      data-pane={index}
      data-focused={focused ? "true" : "false"}
      data-edge-right={edgeRight ? "" : undefined}
      data-edge-bottom={edgeBottom ? "" : undefined}
      style={style}
      data-drop={dropping ? "" : undefined}
      data-tab-drop={tabDrop ?? undefined}
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
        renaming={renaming}
        onRenaming={setRenaming}
        onRename={onRename}
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
        onDragOver={(event) => {
          if (!onDropTab || !event.dataTransfer.types.includes(TAB_MIME)) {
            return;
          }
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          const box = event.currentTarget.getBoundingClientRect();
          setTabDrop(
            dropZoneAt(
              (event.clientX - box.left) / box.width,
              (event.clientY - box.top) / box.height,
            ),
          );
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setTabDrop(null);
          }
        }}
        onDrop={(event) => {
          const key = event.dataTransfer.getData(TAB_MIME);
          if (tabDrop === null || key === "") return;
          event.preventDefault();
          const zone = tabDrop;
          setTabDrop(null);
          delete document.documentElement.dataset.tabDragging;
          onDropTab?.(key, zone);
        }}
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
          : (custom ??
            (selected ? (
              <div className={styles.content} data-tab-body={selected.key}>
                <h1 className={styles.heading}>{selected.title}</h1>
              </div>
            ) : (
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
            )))}
      </div>
    </section>
  );
}
