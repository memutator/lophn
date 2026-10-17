import { Icon, IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import { workspaceIcons } from "../../../icons/mod.ts";
import { t } from "@lophn/wording";

import { LauncherButton } from "../../../workspace/launcher-button.tsx";
import { LOPHN_SCREENS, type LophnScreen } from "../model.ts";
import { screenIcon, screenLabel } from "../screens.ts";
import { SETTINGS_GROUPS, type SettingsPane } from "../settings/model.ts";
import styles from "./sidebar.module.css";

interface LophnSidebarProps {
  /** open·collapsed·hidden. hidden이면 그리지 않는다. */
  mode: "open" | "collapsed" | "hidden";
  width: number;
  current: LophnScreen;
  /** Settings가 고른 화면일 때 고른 항목. */
  pane: SettingsPane;
  onLauncher: () => void;
  onToggle: () => void;
  onOpen: (screen: LophnScreen) => void;
  onPane: (pane: SettingsPane) => void;
}

// Lophn Workspace sidebar. 화면 셋(Projects, Apps, Settings)이 한 단이고, Settings를 고르면 그 아래에 항목 묶음이 들여 쓴 줄로 나온다.
export function LophnSidebar(
  { mode, width, current, pane, onLauncher, onToggle, onOpen, onPane }:
    LophnSidebarProps,
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
      aria-label={t("common.label.lophn-space")}
    >
      <div className={styles.header}>
        {collapsed ? null : (
          <span className={styles.headerContent}>
            <LauncherButton onLauncher={onLauncher} />
            <span className={styles.title}>
              {t("common.label.lophn-space")}
            </span>
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
      <ul className={`${styles.list} ${styles.navList}`} role="list">
        {LOPHN_SCREENS.map((screen) => {
          const label = screenLabel(screen);
          const showPanes = screen === "settings" && current === "settings" &&
            !collapsed;
          // 항목이 아래에 펼쳐지면 고른 것은 그 항목이다.
          const active = screen === current && !showPanes;
          const row = (
            <button
              type="button"
              data-screen={screen}
              className={`${styles.item} ${styles.navRow} ${
                active ? styles.active : ""
              }`}
              aria-current={screen === current ? "page" : undefined}
              aria-label={collapsed ? label : undefined}
              onClick={() => onOpen(screen)}
            >
              <Icon
                icon={screenIcon(screen)}
                pixels={iconPixels("base")}
                className={styles.icon}
              />
              {collapsed ? null : <span className={styles.label}>{label}</span>}
            </button>
          );
          return (
            <li key={screen} className={`${styles.li} ${styles.navItem}`}>
              {collapsed ? <Tooltip content={label}>{row}</Tooltip> : row}
              {showPanes
                ? (
                  <div className={styles.subList}>
                    {SETTINGS_GROUPS.map((group) => (
                      <section key={group.id}>
                        <h3 className={styles.navGroup}>{t(group.label)}</h3>
                        <ul className={styles.navList} role="list">
                          {group.panes.map((entry) => (
                            <li key={entry.id} className={styles.li}>
                              <button
                                type="button"
                                data-settings-pane={entry.id}
                                className={`${styles.item} ${styles.navRow} ${
                                  entry.id === pane ? styles.active : ""
                                }`}
                                aria-current={entry.id === pane
                                  ? "page"
                                  : undefined}
                                onClick={() =>
                                  onPane(entry.id)}
                              >
                                <Icon
                                  icon={entry.icon}
                                  pixels={iconPixels("base")}
                                  className={styles.icon}
                                />
                                <span className={styles.label}>
                                  {t(entry.label)}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ))}
                  </div>
                )
                : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
