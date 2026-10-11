import { type DragEvent, Fragment, type ReactNode, useState } from "react";
import {
  Icon,
  IconButton,
  iconPixels,
  type IconProps,
  Tooltip,
  workspaceIcons,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import {
  applyDrag,
  BREAKPOINT_MD,
  type PaneState,
  ratioFromDrag,
  SPLIT_EQUAL,
  splitLayout,
  type TabItem,
  type WorkspaceView,
} from "../model.ts";
import { tabKindLabel } from "../kinds/registry.ts";
import { startPointerDrag } from "../drag.ts";
import { TabStrip } from "../tab-strip/tab-strip.tsx";
import styles from "./panes.module.css";

/** 칸 폭이 이보다 좁으면 본문 여백을 16px로 줄인다(design-system#R24). */
const PANE_PADDING_WIDE_MIN = 640;

export interface PanesProps {
  view: WorkspaceView;
  /** 칸을 그릴 본문 폭. */
  bodyWidth: number;
  /** 창 폭. 본문 여백을 정한다. */
  windowWidth: number;
  onSelect: (pane: number, key: string) => void;
  onClose: (pane: number, key: string) => void;
  onFocus: (pane: number) => void;
  /** 키보드·drag로 탭을 다른 칸으로 옮긴다. 한 칸에서 1로 옮기면 칸을 나눈다. */
  onMove: (key: string, toPane: number) => void;
  /** 경계 drag가 끝나거나 두 번 눌렀을 때의 비율. */
  onRatio: (ratio: number) => void;
  /** 정보 패널 열림과 바꾸기. 주면 마지막 칸 탭 줄 끝에 버튼을 둔다. */
  infoOpen?: boolean;
  onToggleInfo?: () => void;
  /**
   * 마지막 칸 탭 줄 끝에 둘 열기 단추. kind마다 하나이고 순서대로 놓는다(workspace#R1, R5, R14).
   */
  launchers?: readonly PaneLauncher[];
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
  /** 탭 key마다 tooltip. */
  tooltips?: Readonly<Record<string, ReactNode>>;
}

/** 탭 줄 끝의 열기 단추 하나. kind 선언의 launcher를 작업대가 풀어 넘긴다. */
export interface PaneLauncher {
  /** 단추의 `data-open-<kind>` 표시에 쓰는 kind 이름. */
  readonly kind: string;
  readonly label: string;
  readonly icon: IconProps["icon"];
  readonly onOpen: () => void;
}

interface Dragging {
  readonly pane: number;
  readonly key: string;
}

// 좌우 1칸 또는 2칸. 폭이 부족하면 한 칸 보기로 그린다(workspace#R3, R4).
export function Panes(
  {
    view,
    bodyWidth,
    windowWidth,
    onSelect,
    onClose,
    onFocus,
    onMove,
    onRatio,
    infoOpen = false,
    onToggleInfo,
    launchers = [],
    renderTab,
    renderKept,
    tooltips,
  }: PanesProps,
) {
  // 경계 drag 중 미리보기 비율. drag-end에서만 저장한다.
  const [preview, setPreview] = useState<number | null>(null);
  const [dragging, setDragging] = useState<Dragging | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const shownView = preview === null ? view : { ...view, splitRatio: preview };
  const layout = splitLayout(bodyWidth, shownView);
  const shown = layout.visiblePanes === 1 ? [layout.shownPane] : [0, 1];
  const single = view.panes.length === 1;

  const dropProps = (target: number) => ({
    onDragOver: (event: DragEvent) => {
      if (!dragging || dragging.pane === target) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      setOver(target);
    },
    onDragLeave: () =>
      setOver((current) => current === target ? null : current),
    onDrop: (event: DragEvent) => {
      event.preventDefault();
      const moving = dragging;
      setDragging(null);
      setOver(null);
      if (moving && moving.pane !== target) onMove(moving.key, target);
    },
  });

  const end = (index: number, position: number): ReactNode => {
    if (position !== shown.length - 1) return null;
    const pane = view.panes[index]!;
    const splitLabel = t("project-workspace.button.split-pane");
    const infoLabel = t("project-workspace.button.info-panel");
    return (
      <>
        {launchers.map((launcher) => (
          <Tooltip key={launcher.kind} content={launcher.label}>
            <IconButton
              icon={launcher.icon}
              label={launcher.label}
              {...{
                [`data-open-${launcher.kind.replaceAll("_", "-")}`]: "",
              }}
              onClick={launcher.onOpen}
            />
          </Tooltip>
        ))}
        {single
          ? (
            <Tooltip content={splitLabel}>
              <IconButton
                icon={workspaceIcons.splitPane}
                label={splitLabel}
                data-split-pane=""
                disabled={pane.tabs.length < 2}
                onClick={() => {
                  if (pane.selected) onMove(pane.selected, 1);
                }}
              />
            </Tooltip>
          )
          : null}
        {onToggleInfo
          ? (
            <Tooltip content={infoLabel}>
              <IconButton
                icon={workspaceIcons.infoPanel}
                label={infoLabel}
                data-info-toggle=""
                aria-pressed={infoOpen}
                onClick={onToggleInfo}
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
              focused={view.focusedPane === index}
              split={layout.visiblePanes === 2}
              wide={wide}
              end={end(index, position)}
              renderTab={renderTab}
              renderKept={renderKept}
              dropTarget={dragging !== null && dragging.pane !== index}
              over={over === index}
              dropProps={dropProps(index)}
              tooltips={tooltips}
              onSelect={(key) => onSelect(index, key)}
              onClose={(key) => onClose(index, key)}
              onFocus={() => {
                if (view.focusedPane !== index) onFocus(index);
              }}
              onMove={(key, direction) => {
                const target = direction === "left" ? index - 1 : index + 1;
                if (target >= 0 && target < 2) onMove(key, target);
              }}
              onDragTab={(key) =>
                setDragging(key ? { pane: index, key } : null)}
            >
              {single && dragging !== null && view.panes[0]!.tabs.length > 1
                ? (
                  <div
                    className={styles.sideDrop}
                    data-side-drop=""
                    data-over={over === 1 ? "" : undefined}
                    {...dropProps(1)}
                  >
                    {over === 1
                      ? (
                        <span className={styles.dropLabel}>
                          {t("project-workspace.label.drop-side")}
                        </span>
                      )
                      : null}
                  </div>
                )
                : null}
            </PaneView>
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
  split: boolean;
  wide: boolean;
  end: ReactNode;
  dropTarget: boolean;
  over: boolean;
  dropProps: {
    onDragOver: (event: DragEvent) => void;
    onDragLeave: () => void;
    onDrop: (event: DragEvent) => void;
  };
  children?: ReactNode;
  renderTab?: (tab: TabItem, active: boolean) => ReactNode | null;
  renderKept?: (tab: TabItem, shown: boolean) => ReactNode | null;
  tooltips?: Readonly<Record<string, ReactNode>>;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onFocus: () => void;
  onMove: (key: string, direction: "left" | "right") => void;
  onDragTab: (key: string | null) => void;
}

function PaneView(
  {
    index,
    pane,
    width,
    focused,
    split,
    wide,
    end,
    dropTarget,
    over,
    dropProps,
    children,
    renderTab,
    renderKept,
    tooltips,
    onSelect,
    onClose,
    onFocus,
    onMove,
    onDragTab,
  }: PaneViewProps,
) {
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
      onPointerDown={onFocus}
      onFocusCapture={onFocus}
      {...(dropTarget ? dropProps : {})}
    >
      <TabStrip
        tabs={pane.tabs}
        selected={pane.selected}
        focused={split && focused}
        label={t("project-workspace.label.tabs")}
        onSelect={onSelect}
        onClose={onClose}
        onMoveToPane={onMove}
        onDragTab={onDragTab}
        end={end}
        tooltips={tooltips}
      />
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
                <p className={styles.meta}>
                  {tabKindLabel(selected.kind)}
                </p>
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
      {dropTarget && over
        ? (
          <div className={styles.drop} data-drop="">
            <span className={styles.dropLabel}>
              {t("project-workspace.label.drop-here")}
            </span>
          </div>
        )
        : null}
      {children}
    </section>
  );
}
