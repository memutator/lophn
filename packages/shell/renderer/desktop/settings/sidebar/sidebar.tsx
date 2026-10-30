// Settings 공간 sidebar. project 창 sidebar의 panel 꼴로 묶음(General, Agents, System)마다 제목과 항목 줄을 모두 놓는다.
// 접히면 항목 아이콘만 activity bar 꼴로 남는다.
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/i18n";

import {
  ActivityBar,
  type ActivityEntry,
} from "../../../workspace/sidebar/activity-bar.tsx";
import styles from "../../../workspace/sidebar/project-sidebar.module.css";
import { SETTINGS_GROUPS, type SettingsPane } from "../model.ts";

const ENTRIES: readonly ActivityEntry<SettingsPane>[] = SETTINGS_GROUPS.flatMap(
  (group) =>
    group.panes.map((entry) => ({
      key: entry.id,
      label: t(entry.label),
      icon: entry.icon,
    })),
);

interface SettingsSidebarProps {
  /** open·collapsed·hidden. hidden이면 그리지 않는다. */
  mode: "open" | "collapsed" | "hidden";
  width: number;
  /** 고른 항목. */
  pane: SettingsPane;
  onPane: (pane: SettingsPane) => void;
}

export function SettingsSidebar({
  mode,
  width,
  pane,
  onPane,
}: SettingsSidebarProps) {
  if (mode === "hidden") return null;
  return (
    <nav
      className={styles.sidebar}
      data-sidebar={mode}
      style={{ width: `${width}px` }}
      aria-label={t("settings.title.screen")}
    >
      {mode === "collapsed" ? (
        <ActivityBar entries={ENTRIES} selected={pane} open onSelect={onPane} />
      ) : (
        <div className={styles.panel}>
          <div className={styles.body}>
            {SETTINGS_GROUPS.map((group) => (
              <section key={group.id} className={styles.section}>
                <h2 className={styles.sectionLabel}>{t(group.label)}</h2>
                <ul className={styles.list} role="list">
                  {group.panes.map((entry) => (
                    <li key={entry.id} className={styles.li}>
                      <button
                        type="button"
                        className={styles.item}
                        data-settings-pane={entry.id}
                        data-active={entry.id === pane || undefined}
                        aria-current={entry.id === pane ? "page" : undefined}
                        onClick={() => onPane(entry.id)}
                      >
                        <Icon icon={entry.icon} pixels={iconPixels("base")} />
                        <span className={styles.label}>{t(entry.label)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
