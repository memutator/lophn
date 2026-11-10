// title bar 오른쪽 구역의 panel icon tab(Obsidian). 고른 panel이 오른쪽 sidebar에 보인다.
import type { LucideIcon } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { Icon } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";

import { AppTabIcon } from "../app-frame/app-icon.tsx";
import styles from "./panel-tabs.module.css";

export interface PanelTab {
  readonly key: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** 앱 화면 panel이면 그 앱. icon 대신 앱 icon을 그린다. */
  readonly app?: string;
}

export interface PanelTabsProps {
  tabs: readonly PanelTab[];
  selected: string;
  onSelect: (key: string) => void;
}

export function PanelTabs({ tabs, selected, onSelect }: PanelTabsProps) {
  const list = useRef<HTMLDivElement>(null);
  // 고른 tab이 줄 밖이면 줄 안에서만 scroll해 보이게 한다.
  useLayoutEffect(() => {
    const element = list.current;
    const tab = element?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!element || !tab) return;
    if (
      tab.offsetLeft + tab.offsetWidth >
      element.scrollLeft + element.clientWidth
    ) {
      element.scrollLeft =
        tab.offsetLeft + tab.offsetWidth - element.clientWidth;
    }
    if (tab.offsetLeft < element.scrollLeft)
      element.scrollLeft = tab.offsetLeft;
  }, [selected, tabs]);

  return (
    <div
      ref={list}
      className={styles.tabs}
      role="tablist"
      // 세로 wheel도 가로로 옮긴다.
      onWheel={(event) => {
        const element = list.current;
        if (!element || Math.abs(event.deltaY) <= Math.abs(event.deltaX))
          return;
        element.scrollLeft += event.deltaY;
      }}
    >
      {tabs.map((tab) => (
        <Tooltip key={tab.key} content={tab.label}>
          <button
            type="button"
            role="tab"
            className={styles.tab}
            aria-label={tab.label}
            aria-selected={tab.key === selected}
            onClick={() => onSelect(tab.key)}
          >
            {tab.app === undefined ? (
              <Icon icon={tab.icon} pixels={16} />
            ) : (
              <AppTabIcon app={tab.app} />
            )}
          </button>
        </Tooltip>
      ))}
    </div>
  );
}
