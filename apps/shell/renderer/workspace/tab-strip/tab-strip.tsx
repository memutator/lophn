import {
  type KeyboardEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  Icon,
  iconPixels,
  type IconProps,
  Tooltip,
  workspaceIcons,
} from "@lophn/design/components";
import { t } from "@lophn/wording";

import {
  revealScroll,
  TAB_KIND_LABEL,
  TAB_MAX,
  TAB_MIN,
  TAB_PINNED,
  type TabItem,
  type TabKind,
} from "../model.ts";
import styles from "./tab-strip.module.css";

const KIND_ICON: Record<TabKind, IconProps["icon"]> = {
  document_editor: workspaceIcons.documentEditor,
  document_viewer: workspaceIcons.documentViewer,
  terminal: workspaceIcons.terminal,
  app_panel: workspaceIcons.appPanel,
};

/** drag 중인 탭의 key를 실어 나르는 dataTransfer 종류. */
export const TAB_DRAG_TYPE = "application/x-lophn-tab";

export interface TabStripProps {
  tabs: readonly TabItem[];
  selected: string | null;
  /** 두 칸 중 focus 칸이면 활성 탭 위에 2px 표시를 둔다(editor#R3). */
  focused: boolean;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  /** 키보드로 다른 칸으로 옮긴다(workspace#R3). */
  onMoveToPane?: (key: string, direction: "left" | "right") => void;
  /** 탭 drag 시작과 끝. 끝나면 null이다. */
  onDragTab?: (key: string | null) => void;
  /** 줄 오른쪽 끝의 조작(칸 나누기, 정보 패널). */
  end?: ReactNode;
  label?: string;
  /** 탭 key마다 tooltip. 문서 탭은 문서 제목과 상대 경로다(editor#R4). */
  tooltips?: Readonly<Record<string, ReactNode>>;
}

// 탭 줄. 종류는 아이콘과 글자로 구별하고 넘치면 줄 안에서만 scroll한다(workspace#R1, R2).
export function TabStrip(
  {
    tabs,
    selected,
    focused,
    onSelect,
    onClose,
    onMoveToPane,
    onDragTab,
    end,
    label,
    tooltips = {},
  }: TabStripProps,
) {
  const listRef = useRef<HTMLDivElement>(null);
  // 키보드 focus가 있는 탭. 화살표는 focus만 옮기고 Enter가 연다(editor#R4).
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const current = tabs.some((tab) => tab.key === focusKey)
    ? focusKey
    : selected;
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list || selected === null) return;
    const tab = list.querySelector<HTMLElement>(
      `[data-tab="${CSS.escape(selected)}"]`,
    );
    if (!tab) return;
    list.scrollLeft = revealScroll(
      tab.offsetLeft,
      tab.offsetLeft + tab.offsetWidth,
      list.clientWidth,
      list.scrollLeft,
      list.scrollWidth,
    );
  }, [selected, tabs]);
  const closeLabel = t("project-workspace.button.close-tab");
  return (
    <div className={styles.bar} data-tab-strip="">
      <div
        ref={listRef}
        className={styles.list}
        role="tablist"
        aria-label={label}
        data-tab-list=""
        onKeyDown={(event: KeyboardEvent) => {
          if (
            event.altKey &&
            (event.key === "ArrowLeft" || event.key === "ArrowRight")
          ) {
            if (!onMoveToPane || !selected) return;
            event.preventDefault();
            onMoveToPane(
              selected,
              event.key === "ArrowLeft" ? "left" : "right",
            );
            return;
          }
          const index = tabs.findIndex((tab) => tab.key === current);
          if (index < 0) return;
          if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
            event.preventDefault();
            const step = event.key === "ArrowLeft" ? -1 : 1;
            const next = tabs[(index + step + tabs.length) % tabs.length]!;
            setFocusKey(next.key);
            listRef.current?.querySelector<HTMLElement>(
              `[data-tab="${CSS.escape(next.key)}"]`,
            )?.focus();
          } else if (event.key === "Enter") {
            event.preventDefault();
            onSelect(tabs[index]!.key);
          } else if (event.key === "Delete") {
            event.preventDefault();
            const neighbour = tabs[index + 1] ?? tabs[index - 1];
            setFocusKey(neighbour?.key ?? null);
            onClose(tabs[index]!.key);
          }
        }}
      >
        {tabs.map((tab) => {
          const active = tab.key === selected;
          const kind = t(TAB_KIND_LABEL[tab.kind]);
          const tooltip = tooltips[tab.key];
          const element = (
            <div
              key={tab.key}
              className={[
                styles.tab,
                active ? styles.active : "",
                active && focused ? styles.focusBar : "",
                tab.pinned ? styles.pinned : "",
              ].join(" ")}
              role="tab"
              aria-selected={active}
              data-tab={tab.key}
              data-kind={tab.kind}
              tabIndex={tab.key === current ? 0 : -1}
              onFocus={() => setFocusKey(tab.key)}
              style={tab.pinned
                ? { width: `${TAB_PINNED}px`, minWidth: `${TAB_PINNED}px` }
                : { minWidth: `${TAB_MIN}px`, maxWidth: `${TAB_MAX}px` }}
              draggable={onDragTab !== undefined}
              onClick={() => onSelect(tab.key)}
              onDragStart={(event) => {
                event.dataTransfer?.setData(TAB_DRAG_TYPE, tab.key);
                if (event.dataTransfer) {
                  event.dataTransfer.effectAllowed = "move";
                }
                onDragTab?.(tab.key);
              }}
              onDragEnd={() => onDragTab?.(null)}
            >
              <Icon
                icon={KIND_ICON[tab.kind]}
                pixels={iconPixels("small")}
                className={styles.icon}
              />
              {tab.pinned ? null : (
                <>
                  <span className={styles.title}>{tab.title}</span>
                  <span className={styles.kind} data-kind-label="">
                    {kind}
                  </span>
                  <Tooltip content={closeLabel}>
                    <button
                      type="button"
                      className={styles.close}
                      data-close=""
                      tabIndex={-1}
                      aria-label={closeLabel}
                      onClick={(event) => {
                        event.stopPropagation();
                        onClose(tab.key);
                      }}
                    >
                      <Icon
                        icon={workspaceIcons.close}
                        pixels={iconPixels("small")}
                      />
                    </button>
                  </Tooltip>
                </>
              )}
            </div>
          );
          return tooltip === undefined ? element : (
            <Tooltip key={tab.key} content={tooltip}>{element}</Tooltip>
          );
        })}
      </div>
      {end ? <div className={styles.end}>{end}</div> : null}
    </div>
  );
}
