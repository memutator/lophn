// project 창 왼쪽 끝의 icon 세로 줄. 위쪽은 panel 항목, 아래쪽은 바로 가기(Terminal, Browser, Agent, Search)와 맨 밑 Settings.
// 항목을 누르면 그 panel을 열고 열린 항목을 다시 누르면 접는다. 열린 항목에는 왼쪽 띠와 배경을 둔다.
import { Icon, type IconProps } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import {
  browserIcons,
  conversationIcons,
  paletteIcons,
  settingsEntryIcon,
  workspaceIcons,
} from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import type { SidebarTab } from "./project-sidebar.tsx";
import styles from "./project-sidebar.module.css";

export interface ActivityEntry {
  readonly key: SidebarTab;
  readonly label: string;
  readonly icon: IconProps["icon"];
}

const RAIL_ACTIONS = ["terminal", "browser", "agent", "search"] as const;
export type RailAction = typeof RAIL_ACTIONS[number];

const RAIL_ICONS: Readonly<Record<RailAction, IconProps["icon"]>> = {
  terminal: workspaceIcons.terminal,
  browser: browserIcons.globe,
  agent: conversationIcons.dock,
  search: paletteIcons.search,
};

export function ActivityBar(
  { entries, selected, open, onSelect, onRail, onSettings }: {
    entries: readonly ActivityEntry[];
    /** 마지막으로 고른 panel. */
    selected: SidebarTab;
    /** panel이 열려 있다. 접히면 열린 항목 표시가 없다. */
    open: boolean;
    onSelect: (key: SidebarTab) => void;
    onRail: (action: RailAction) => void;
    onSettings: () => void;
  },
) {
  const labels: Readonly<Record<RailAction, string>> = {
    terminal: t("project-workspace.label.rail-terminal"),
    browser: t("project-workspace.label.rail-browser"),
    agent: t("project-workspace.label.rail-agent"),
    search: t("project-workspace.label.rail-search"),
  };
  return (
    <div
      className={styles.activityBar}
      role="toolbar"
      aria-orientation="vertical"
      aria-label={t("project-workspace.label.activity-bar")}
    >
      <div className={styles.activityGroup}>
        {entries.map((entry) => {
          const active = open && entry.key === selected;
          return (
            <Tooltip key={entry.key} content={entry.label}>
              <button
                type="button"
                className={styles.activityButton}
                aria-label={entry.label}
                aria-pressed={active}
                data-active={active || undefined}
                data-activity={entry.key}
                onClick={() => onSelect(entry.key)}
              >
                <Icon icon={entry.icon} pixels={iconPixels("large")} />
              </button>
            </Tooltip>
          );
        })}
      </div>
      <div className={styles.activitySpacer} />
      <div
        className={styles.activityGroup}
        role="group"
        aria-label={t("project-workspace.label.rail-shortcuts")}
      >
        {RAIL_ACTIONS.map((action) => (
          <Tooltip key={action} content={labels[action]}>
            <button
              type="button"
              className={styles.activityButton}
              aria-label={labels[action]}
              data-rail-action={action}
              onClick={() =>
                onRail(action)}
            >
              <Icon icon={RAIL_ICONS[action]} pixels={iconPixels("large")} />
            </button>
          </Tooltip>
        ))}
        <Tooltip content={t("common.button.settings")}>
          <button
            type="button"
            className={styles.activityButton}
            aria-label={t("common.button.settings")}
            data-entry="settings"
            onClick={onSettings}
          >
            <Icon icon={settingsEntryIcon} pixels={iconPixels("large")} />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}
