import {
  Icon,
  IconButton,
  iconPixels,
  Tooltip,
} from "@lophn/design/components";
import { workspaceIcons } from "../../../icons/mod.ts";
import { t } from "@lophn/wording";

import { LauncherButton } from "../../../workspace/launcher-button.tsx";
import { LOPHN_SCREENS, type LophnScreen } from "../model.ts";
import { screenIcon, screenLabel } from "../screens.ts";
import styles from "./sidebar.module.css";

export interface LophnSidebarProps {
  /** open·collapsed·hidden. hidden이면 그리지 않는다. */
  mode: "open" | "collapsed" | "hidden";
  width: number;
  current: LophnScreen;
  onLauncher: () => void;
  onToggle: () => void;
  onOpen: (screen: LophnScreen) => void;
}

// lophn 공간 sidebar. 여섯 형제만 한 단으로 두고 분류 전·거처 같은 중간 계층이 없다(desktop#R28).
export function LophnSidebar(
  { mode, width, current, onLauncher, onToggle, onOpen }: LophnSidebarProps,
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
      <ul className={styles.list} role="list">
        {LOPHN_SCREENS.map((screen) => {
          const label = screenLabel(screen);
          const active = screen === current;
          const row = (
            <button
              type="button"
              data-screen={screen}
              className={`${styles.item} ${active ? styles.active : ""}`}
              aria-current={active ? "page" : undefined}
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
            <li key={screen} className={styles.li}>
              {collapsed ? <Tooltip content={label}>{row}</Tooltip> : row}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
