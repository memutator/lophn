import { t } from "@lophn/wording";

import {
  type PaneState,
  SPLIT_EQUAL,
  splitLayout,
  type WorkspaceView,
} from "../model.ts";
import { TabStrip } from "../tab-strip/tab-strip.tsx";
import styles from "./panes.module.css";

export interface PanesProps {
  view: WorkspaceView;
  /** 칸을 그릴 본문 폭. */
  bodyWidth: number;
  /** 창 폭. 본문 여백을 정한다. */
  windowWidth: number;
  onSelect: (pane: number, key: string) => void;
  onClose: (pane: number, key: string) => void;
  onFocus: (pane: number) => void;
  /** 키보드·drag로 탭을 다른 칸으로 옮긴다. */
  onMove: (key: string, toPane: number) => void;
  /** 경계 drag로 비율을 바꾼다. */
  onRatio: (ratio: number) => void;
}

// 좌우 1칸 또는 2칸. 폭이 부족하면 한 칸 보기로 그린다(workspace#R3, R4).
export function Panes(
  { view, bodyWidth, windowWidth, onSelect, onClose, onFocus, onMove, onRatio }:
    PanesProps,
) {
  const layout = splitLayout(bodyWidth, view);
  const shown = layout.visiblePanes === 1 ? [layout.shownPane] : [0, 1];
  return (
    <div className={styles.panes} data-panes={layout.visiblePanes}>
      {shown.map((index, position) => (
        <PaneView
          key={index}
          index={index}
          pane={view.panes[index]!}
          width={position === 0 ? layout.leftWidth : layout.rightWidth}
          focused={view.focusedPane === index}
          windowWidth={windowWidth}
          divider={layout.visiblePanes === 2 && position === 0}
          onSelect={(key) => onSelect(index, key)}
          onClose={(key) => onClose(index, key)}
          onFocus={() => onFocus(index)}
          onMove={(key, direction) => {
            const target = direction === "left" ? index - 1 : index + 1;
            if (target >= 0 && target < view.panes.length) onMove(key, target);
          }}
          onRatio={onRatio}
          bodyWidth={bodyWidth}
        />
      ))}
    </div>
  );
}

interface PaneViewProps {
  index: number;
  pane: PaneState;
  width: number;
  focused: boolean;
  windowWidth: number;
  divider: boolean;
  bodyWidth: number;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  onFocus: () => void;
  onMove: (key: string, direction: "left" | "right") => void;
  onRatio: (ratio: number) => void;
}

function PaneView(
  {
    index,
    pane,
    width,
    focused,
    windowWidth,
    divider,
    bodyWidth,
    onSelect,
    onClose,
    onFocus,
    onMove,
    onRatio,
  }: PaneViewProps,
) {
  const selected = pane.tabs.find((tab) => tab.key === pane.selected);
  return (
    <>
      <section
        className={`${styles.pane} ${focused ? styles.focused : ""}`}
        data-pane={index}
        data-focused={focused ? "true" : "false"}
        style={{ width: `${width}px` }}
        onPointerDown={onFocus}
      >
        <TabStrip
          tabs={pane.tabs}
          selected={pane.selected}
          width={width}
          scroll={0}
          focused={focused}
          onSelect={onSelect}
          onClose={onClose}
          onMoveToPane={onMove}
        />
        <div
          className={`${styles.body} ${
            windowWidth < 1024 ? styles.narrow : ""
          }`}
          data-pane-body=""
        >
          {selected
            ? (
              <p className={styles.placeholder} data-tab-body={selected.key}>
                {selected.title}
              </p>
            )
            : (
              <p className={styles.empty}>
                {t("project-workspace.empty.no-tabs")}
              </p>
            )}
        </div>
      </section>
      {divider
        ? (
          <div
            className={styles.divider}
            data-divider=""
            role="separator"
            onDoubleClick={() => onRatio(SPLIT_EQUAL)}
            onPointerDown={(event) => {
              const startX = event.clientX;
              const startWidth = width;
              const move = (next: PointerEvent) => {
                const usable = bodyWidth - 1;
                const left = Math.min(
                  usable - 480,
                  Math.max(480, startWidth + next.clientX - startX),
                );
                onRatio(left / usable);
              };
              const up = () => {
                globalThis.removeEventListener("pointermove", move);
                globalThis.removeEventListener("pointerup", up);
              };
              globalThis.addEventListener("pointermove", move);
              globalThis.addEventListener("pointerup", up);
            }}
          >
            <div className={styles.grab} data-grab="" />
          </div>
        )
        : null}
    </>
  );
}
