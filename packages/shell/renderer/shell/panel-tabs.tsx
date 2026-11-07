// title bar 오른쪽 구역의 panel icon tab(Obsidian). 고른 panel이 오른쪽 sidebar에 보인다.
import type { LucideIcon } from "lucide-react";
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
  return (
    <div className={styles.tabs} role="tablist">
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
