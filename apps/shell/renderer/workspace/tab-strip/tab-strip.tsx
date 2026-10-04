import { t } from "@lophn/wording";

import {
  TAB_KIND_LABEL,
  type TabItem,
  tabStripScroll,
  tabWidth,
} from "../model.ts";
import styles from "./tab-strip.module.css";

export interface TabStripProps {
  tabs: readonly TabItem[];
  selected: string | null;
  /** 줄 폭. 테스트가 고정하고 화면은 관측값을 넘긴다. */
  width: number;
  /** 현재 scroll offset. 선택 탭이 보이도록 가둔다. */
  scroll: number;
  focused: boolean;
  onSelect: (key: string) => void;
  onClose: (key: string) => void;
  /** 키보드로 다른 칸으로 옮긴다(workspace#R3). */
  onMoveToPane?: (key: string, direction: "left" | "right") => void;
}

// 탭 줄. 종류는 글자로 구별하고 넘치면 줄 안에서만 scroll한다(workspace#R1, R2).
export function TabStrip(
  { tabs, selected, width, scroll, focused, onSelect, onClose, onMoveToPane }:
    TabStripProps,
) {
  const layout = tabStripScroll(tabs, selected, width, scroll);
  return (
    <div
      className={styles.strip}
      role="tablist"
      data-tab-strip=""
      data-focused={focused ? "true" : "false"}
      style={{ width: `${width}px` }}
      onKeyDown={(event) => {
        if (!onMoveToPane || !selected) return;
        if (
          event.altKey &&
          (event.key === "ArrowLeft" || event.key === "ArrowRight")
        ) {
          event.preventDefault();
          onMoveToPane(selected, event.key === "ArrowLeft" ? "left" : "right");
        }
      }}
    >
      <div
        className={styles.scroll}
        data-scroll={layout.scroll}
        style={{ transform: `translateX(-${layout.scroll}px)` }}
      >
        {tabs.map((tab) => (
          <div
            key={tab.key}
            className={`${styles.tab} ${
              tab.key === selected ? styles.selected : ""
            }`}
            role="tab"
            aria-selected={tab.key === selected}
            data-tab={tab.key}
            data-kind={tab.kind}
            tabIndex={tab.key === selected ? 0 : -1}
            style={{ width: `${tabWidth(tab, width, tabs.length)}px` }}
            onClick={() => onSelect(tab.key)}
          >
            <span className={styles.kind} data-kind-label="">
              {t(TAB_KIND_LABEL[tab.kind])}
            </span>
            <span className={styles.title}>{tab.title}</span>
            <button
              type="button"
              className={styles.close}
              data-close=""
              aria-label={t("project-workspace.button.close-tab")}
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab.key);
              }}
            >
              {t("common.button.close")}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
