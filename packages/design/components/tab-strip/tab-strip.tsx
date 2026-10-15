// 새 설계 화면들이 같이 쓰는 탭 줄. project 창의 칸 머리, 앱 공간의 pane 머리, sidebar 위쪽 모양 고르기가 모두 이것이다.
// 모양은 아이콘과 이름, 고른 탭에 밑줄, 상자 없음이다. 닫기 ×, 끝의 새 탭 위치, 상태 점, 칸 focus 표시를 갖는다.
import { type ReactNode, useLayoutEffect, useRef } from "react";
import { X } from "lucide-react";
import { t } from "@lophn/wording";
import { Icon } from "../icon.tsx";
import { iconPixels } from "../shared.ts";
import styles from "./tab-strip.module.css";

export type TabDot = "waiting" | "working" | "ended";

export interface TabItem {
  readonly key: string;
  readonly title: string;
  /** 이름 앞 아이콘. 파일 아이콘, agent profile, vendor 아이콘 등 호출자가 정한다. */
  readonly icon?: ReactNode;
  /** 이름 뒤 상태 점. */
  readonly dot?: TabDot | null;
}

const dotLabel = (dot: TabDot) => t(`common.label.tab-${dot}`);

export function TabStrip(
  { tabs, selected, focused = true, compact = false, onSelect, onClose, end }: {
    tabs: readonly TabItem[];
    selected: string;
    /** 두 칸 중 키보드가 가 있는 칸이다. 고른 탭 밑줄이 focus 색이 된다. */
    focused?: boolean;
    /** sidebar 위쪽 같은 작은 줄. 탭이 폭을 나눠 가진다. */
    compact?: boolean;
    onSelect?: (key: string) => void;
    /** 있으면 탭마다 닫기 ×가 생긴다. */
    onClose?: (key: string) => void;
    /** 줄 끝(새 탭 단추, 칸 닫기 등). */
    end?: ReactNode;
  },
) {
  const list = useRef<HTMLDivElement>(null);
  // 새로 열린 탭이 줄 밖이면 줄 안에서만 scroll해 보이게 한다.
  useLayoutEffect(() => {
    const element = list.current;
    const tab = element?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!element || !tab) return;
    const right = tab.offsetLeft + tab.offsetWidth;
    if (right > element.scrollLeft + element.clientWidth) {
      element.scrollLeft = right - element.clientWidth;
    } else if (tab.offsetLeft < element.scrollLeft) {
      element.scrollLeft = tab.offsetLeft;
    }
  }, [selected, tabs.length]);
  return (
    <div className={`${styles.bar} ${compact ? styles.compact : ""}`}>
      <div ref={list} className={styles.list} role="tablist">
        {tabs.map((tab) => {
          const active = tab.key === selected;
          return (
            <div
              key={tab.key}
              className={[
                styles.tab,
                active ? styles.active : "",
                active && focused ? styles.focused : "",
              ].join(" ")}
              role="tab"
              aria-selected={active}
              title={tab.title}
              onClick={() => onSelect?.(tab.key)}
            >
              {tab.icon === undefined
                ? null
                : <span className={styles.icon}>{tab.icon}</span>}
              <span className={styles.title}>{tab.title}</span>
              {tab.dot
                ? (
                  <span
                    className={styles.dot}
                    data-state={tab.dot}
                    role="img"
                    aria-label={dotLabel(tab.dot)}
                    title={dotLabel(tab.dot)}
                  />
                )
                : null}
              {onClose === undefined ? null : (
                <button
                  type="button"
                  className={styles.close}
                  aria-label={t("common.button.close")}
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.key);
                  }}
                >
                  <Icon
                    icon={X}
                    pixels={iconPixels("small")}
                  />
                </button>
              )}
            </div>
          );
        })}
      </div>
      {end === undefined ? null : <div className={styles.end}>{end}</div>}
    </div>
  );
}
