// Lophn Workspace 틀. 화면은 Projects, Apps, Settings 셋이고 Documents와 Things to confirm은 없다.
// 실제 LophnSidebar는 일곱 형제를 고정으로 그려서 같은 CSS Module로 세 항목만 그린 look-alike를 쓴다.
import { type ReactNode, useState } from "react";
import { Icon, IconButton, iconPixels } from "@lophn/design/components";
import {
  workspaceIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";

import { TopBar } from "../../../../packages/shell/renderer/desktop/top-bar/top-bar.tsx";
import { LauncherButton } from "../../../../packages/shell/renderer/workspace/launcher-button.tsx";
import type { LophnScreen } from "../../../../packages/shell/renderer/desktop/lophn-space/model.ts";
import {
  screenIcon,
  screenLabel,
} from "../../../../packages/shell/renderer/desktop/lophn-space/screens.ts";
import sideStyles from "../../../../packages/shell/renderer/desktop/lophn-space/sidebar/sidebar.module.css";
import { ConnectDialog, ConnectDialogsStatic } from "./workspace-settings.tsx";
import { AppsScreen } from "./workspace/apps-screen.tsx";
import { ProjectsScreen } from "./workspace/projects-screen.tsx";
import {
  type PaneOverrides,
  SettingsShell,
  type WorkspacePane,
} from "./workspace/settings-shell.tsx";
import styles from "./compose.module.css";

export type WorkspaceScreen = Extract<
  LophnScreen,
  "projects" | "apps" | "settings"
>;

const SCREENS: readonly WorkspaceScreen[] = ["projects", "apps", "settings"];

export interface WorkspaceProps {
  /** 처음에 보이는 화면. 기본은 Projects. */
  readonly screen?: WorkspaceScreen;
  /** Settings의 처음 항목. */
  readonly pane?: WorkspacePane;
  /** provider 연결 창 둘을 정적으로 올린 채 시작한다. */
  readonly connectStatic?: boolean;
  /** Settings nav의 항목 본문을 바꿔 끼운다. */
  readonly panes?: PaneOverrides;
  /** Projects나 Apps 화면 본문을 바꿔 끼운다. */
  readonly body?: ReactNode;
  /** 창 위에 얹는다(dialog, toast 등). */
  readonly overlay?: ReactNode;
}

export function WorkspaceWithoutProject(
  {
    screen: initial = "projects",
    pane: initialPane = "general",
    connectStatic = false,
    panes,
    body,
    overlay,
  }: WorkspaceProps = {},
) {
  const [collapsed, setCollapsed] = useState(false);
  const [screen, setScreen] = useState<WorkspaceScreen>(initial);
  const [pane, setPane] = useState<WorkspacePane>(initialPane);
  const [connect, setConnect] = useState<string | null>(null);
  return (
    <div className={styles.window}>
      <nav
        className={`${sideStyles.sidebar} ${
          collapsed ? sideStyles.collapsed : ""
        }`}
        style={{ width: collapsed ? "56px" : "240px" }}
        data-sidebar={collapsed ? "collapsed" : "open"}
      >
        <div className={sideStyles.header}>
          {collapsed ? null : (
            <span className={sideStyles.headerContent}>
              <LauncherButton onLauncher={() => {}} />
              <span className={sideStyles.title}>Lophn Workspace</span>
            </span>
          )}
          <IconButton
            icon={workspaceIcons.sidebar}
            label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed(!collapsed)}
          />
        </div>
        <ul className={sideStyles.list} role="list">
          {SCREENS.map((item) => (
            <li key={item} className={sideStyles.li}>
              <button
                type="button"
                className={`${sideStyles.item} ${
                  item === screen ? sideStyles.active : ""
                }`}
                aria-label={collapsed ? screenLabel(item) : undefined}
                aria-current={item === screen ? "page" : undefined}
                title={screenLabel(item)}
                onClick={() => setScreen(item)}
              >
                <Icon
                  icon={screenIcon(item)}
                  pixels={iconPixels("base")}
                  className={sideStyles.icon}
                />
                {collapsed ? null : (
                  <span className={sideStyles.label}>
                    {screenLabel(item)}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <div className={styles.main}>
        <div className={styles.topBar}>
          <TopBar
            platform="linux"
            leading={
              <div className={styles.leading}>
                {collapsed ? <LauncherButton onLauncher={() => {}} /> : null}
                <span className={styles.projectName}>
                  {screenLabel(screen)}
                </span>
              </div>
            }
          />
        </div>
        {screen === "settings"
          ? (
            <SettingsShell
              pane={pane}
              onPane={setPane}
              onConnect={setConnect}
              panes={panes}
            />
          )
          : screen === "apps"
          ? (screen === initial && body !== undefined ? body : <AppsScreen />)
          : (screen === initial && body !== undefined
            ? body
            : <ProjectsScreen />)}
      </div>
      <ConnectDialog provider={connect} onClose={() => setConnect(null)} />
      {connectStatic ? <ConnectDialogsStatic /> : null}
      {overlay}
    </div>
  );
}
