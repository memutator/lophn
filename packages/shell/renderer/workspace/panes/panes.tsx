import { Fragment, type ReactNode, useState } from "react";
import {
  Icon,
  IconButton,
  iconPixels,
  type TabItem as StripTab,
  TabStrip,
  Tooltip,
} from "@lophn/design/components";
import { workspaceIcons } from "../../icons/mod.ts";
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
import { startPointerDrag } from "../drag.ts";
import styles from "./panes.module.css";

/** 칸 폭이 이보다 좁으면 본문 여백을 16px로 줄인다. */
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
  /** 탭을 다른 칸으로 옮긴다. 한 칸에서 1로 옮기면 칸을 나눈다. */
  onMove: (key: string, toPane: number) => void;
  /** 경계 drag가 끝나거나 두 번 눌렀을 때의 비율. */
  onRatio: (ratio: number) => void;
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
    bodyWidth,
    windowWidth,
    onSelect,
    onClose,
    onFocus,
    onMove,
    onRatio,
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
              focused={view.focusedPane === index}
              split={layout.visiblePanes === 2}
              wide={wide}
              end={end(index, position)}
              stripTab={stripTab}
              renderTab={renderTab}
              renderKept={renderKept}
              onSelect={(key) => onSelect(index, key)}
              onClose={(key) => onClose(index, key)}
              onFocus={() => {
                if (view.focusedPane !== index) onFocus(index);
              }}
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
  split: boolean;
  wide: boolean;
  end: ReactNode;
  stripTab: (tab: TabItem) => StripTab;
  renderTab?: (tab: TabItem, active: boolean) => ReactNode | null;
  renderKept?: (tab: TabItem, shown: boolean) => ReactNode | null;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onFocus: () => void;
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
    stripTab,
    renderTab,
    renderKept,
    onSelect,
    onClose,
    onFocus,
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
    >
      <TabStrip
        tabs={pane.tabs.map(stripTab)}
        selected={pane.selected ?? ""}
        focused={split && focused}
        onSelect={onSelect}
        onClose={onClose}
        end={end}
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
