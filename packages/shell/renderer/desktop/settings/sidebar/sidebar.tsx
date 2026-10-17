import { Icon, IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import { workspaceIcons } from "../../../icons/mod.ts";
import { t } from "@lophn/wording";

import { LauncherButton } from "../../../workspace/launcher-button.tsx";
import { SETTINGS_GROUPS, type SettingsPane } from "../model.ts";
import styles from "./sidebar.module.css";

interface SettingsSidebarProps {
  /** open·collapsed·hidden. hidden이면 그리지 않는다. */
  mode: "open" | "collapsed" | "hidden";
  width: number;
  /** 고른 항목. */
  pane: SettingsPane;
  onLauncher: () => void;
  onToggle: () => void;
  onPane: (pane: SettingsPane) => void;
}

// Settings sidebar. 항목을 묶음(General, Agents, System)별로 줄지어 놓고, 접으면 아이콘만 남는다.
export function SettingsSidebar(
  { mode, width, pane, onLauncher, onToggle, onPane }: SettingsSidebarProps,
) {
  if (mode === "hidden") return null;
  const collapsed = mode === "collapsed";
  const toggleLabel = collapsed
    ? t("project-workspace.button.expand-sidebar")
    : t("project-workspace.button.collapse-sidebar");
  return (
    <nav
      className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""}`}
      data-sidebar={mode}
      style={{ width: `${width}px` }}
      aria-label={t("settings.title.screen")}
    >
      <div className={styles.header}>
        {collapsed ? null : (
          <span className={styles.headerContent}>
            <LauncherButton onLauncher={onLauncher} />
            <span className={styles.title}>{t("settings.title.screen")}</span>
          </span>
        )}
        <Tooltip content={toggleLabel}>
          <IconButton
            icon={workspaceIcons.sidebar}
            label={toggleLabel}
            data-sidebar-toggle=""
            aria-expanded={!collapsed}
            onClick={onToggle}
          />
        </Tooltip>
      </div>
      <div className={`${styles.list} ${styles.groups}`}>
        {SETTINGS_GROUPS.map((group) => (
          <section key={group.id}>
            {collapsed
              ? null
              : <h3 className={styles.navGroup}>{t(group.label)}</h3>}
            <ul className={styles.navList} role="list">
              {group.panes.map((entry) => {
                const label = t(entry.label);
                const row = (
                  <button
                    type="button"
                    data-settings-pane={entry.id}
                    className={`${styles.item} ${styles.navRow} ${
                      entry.id === pane ? styles.active : ""
                    }`}
                    aria-current={entry.id === pane ? "page" : undefined}
                    aria-label={collapsed ? label : undefined}
                    onClick={() => onPane(entry.id)}
                  >
                    <Icon
                      icon={entry.icon}
                      pixels={iconPixels("base")}
                      className={styles.icon}
                    />
                    {collapsed
                      ? null
                      : <span className={styles.label}>{label}</span>}
                  </button>
                );
                return (
                  <li key={entry.id} className={styles.li}>
                    {collapsed ? <Tooltip content={label}>{row}</Tooltip> : row}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </nav>
  );
}
