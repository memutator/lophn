// project 창과 Settings 공간 왼쪽 끝의 icon 세로 줄. 위쪽은 panel 항목, project 창은 아래쪽에 바로 가기(Terminal, Browser,
// Agent, Search)와 맨 밑 Settings가 더 있다. 항목을 누르면 그 panel을 열고 열린 항목을 다시 누르면 접는다. 열린 항목에는
// 오른쪽 띠와 배경을 둔다.
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
import { t } from "@lophn/i18n";

import type { SidebarTab } from "./project-sidebar.tsx";
import { RailApps, type RailAppsProps } from "./rail-apps.tsx";
import styles from "./project-sidebar.module.css";

export interface ActivityEntry<K extends string = SidebarTab> {
  readonly key: K;
  readonly label: string;
  readonly icon: IconProps["icon"];
}

const RAIL_ACTIONS = ["terminal", "browser", "agent", "search"] as const;
export type RailAction = (typeof RAIL_ACTIONS)[number];

const RAIL_ICONS: Readonly<Record<RailAction, IconProps["icon"]>> = {
  terminal: workspaceIcons.terminal,
  browser: browserIcons.globe,
  agent: conversationIcons.dock,
  search: paletteIcons.search,
};

export function ActivityBar<K extends string>({
  entries,
  selected,
  open,
  onSelect,
  onRail,
  railApps,
  onSettings,
}: {
  entries: readonly ActivityEntry<K>[];
  /** 마지막으로 고른 panel. */
  selected: K;
  /** panel이 열려 있다. 접히면 열린 항목 표시가 없다. */
  open: boolean;
  onSelect: (key: K) => void;
  /** 아래쪽 바로 가기. 없으면(Settings 공간) 아래쪽 묶음이 없다. */
  onRail?: (action: RailAction) => void;
  /** 고정한 앱 패널 묶음. 없으면(앱 화면을 읽을 수 없는 창) 묶음과 + 단추가 없다. */
  railApps?: RailAppsProps;
  onSettings?: () => void;
}) {
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
                <Icon icon={entry.icon} pixels={18} />
              </button>
            </Tooltip>
          );
        })}
      </div>
      <div className={styles.activitySpacer} />
      {onRail === undefined || onSettings === undefined ? null : (
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
                onClick={() => onRail(action)}
              >
                <Icon icon={RAIL_ICONS[action]} pixels={18} />
              </button>
            </Tooltip>
          ))}
          {railApps === undefined ? null : <RailApps {...railApps} />}
          <Tooltip content={t("common.button.settings")}>
            <button
              type="button"
              className={styles.activityButton}
              aria-label={t("common.button.settings")}
              data-entry="settings"
              onClick={onSettings}
            >
              <Icon icon={settingsEntryIcon} pixels={18} />
            </button>
          </Tooltip>
        </div>
      )}
    </div>
  );
}
