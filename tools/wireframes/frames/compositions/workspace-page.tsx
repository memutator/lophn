// Part 2 C6: project 관심사를 뺀 Lophn Workspace. sidebar에는 Documents·Contexts가 없고 Projects 상세에는
// project 자체 관리만 남는다. 실제 LophnSidebar는 일곱 형제를 고정으로 그려서 같은 CSS Module로 다섯
// 항목만 그린 look-alike를 쓴다.
import { useState } from "react";
import {
  Button,
  Card,
  Icon,
  IconButton,
  iconPixels,
} from "@lophn/design/components";
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
import { Mono } from "./project-window.tsx";
import {
  ConnectDialog,
  ConnectDialogsStatic,
  type SettingsPane,
  SettingsScreen,
} from "./workspace-settings.tsx";
import styles from "./compose.module.css";

const SCREENS: readonly LophnScreen[] = [
  "projects",
  "apps",
  "things-to-confirm",
  "settings",
];

export interface WorkspaceProps {
  /** 처음에 보이는 화면. 기본은 Projects. */
  readonly screen?: LophnScreen;
  /** Settings의 처음 항목. */
  readonly pane?: SettingsPane;
  /** provider 연결 창 둘을 정적으로 올린 채 시작한다. */
  readonly connectStatic?: boolean;
}

export function WorkspaceWithoutProject(
  {
    screen: initial = "projects",
    pane: initialPane = "general",
    connectStatic = false,
  }: WorkspaceProps = {},
) {
  const [collapsed, setCollapsed] = useState(false);
  const [screen, setScreen] = useState<LophnScreen>(initial);
  const [pane, setPane] = useState<SettingsPane>(initialPane);
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
            <SettingsScreen
              pane={pane}
              onPane={setPane}
              onConnect={setConnect}
            />
          )
          : screen !== "projects"
          ? (
            <div className={styles.wsBody}>
              <p className={styles.muted}>
                {screenLabel(screen)} is not part of this wireframe.
              </p>
            </div>
          )
          : (
            <div className={styles.wsBody}>
              <div className={styles.wsList}>
                <div className={styles.selected}>
                  <Card>
                    <span className={styles.projectName}>phroner</span>
                    <p className={styles.muted}>
                      Evaluate and improve the harness loop.
                    </p>
                  </Card>
                </div>
                <Card>
                  <span className={styles.projectName}>grocery-budget</span>
                  <p className={styles.muted}>
                    Keep the monthly food spending under the plan.
                  </p>
                </Card>
              </div>
              <section className={styles.wsDetail}>
                <h1>phroner</h1>
                <dl className={styles.facts}>
                  <dt>Purpose</dt>
                  <dd>Evaluate and improve the harness loop.</dd>
                  <dt>Folder</dt>
                  <dd>
                    <Mono>/home/mina/work/phroner</Mono>
                  </dd>
                </dl>
                <div className={styles.actions}>
                  <Button variant="primary">Open project</Button>
                  <Button>Rename</Button>
                  <Button variant="danger">Archive</Button>
                </div>
              </section>
            </div>
          )}
      </div>
      <ConnectDialog provider={connect} onClose={() => setConnect(null)} />
      {connectStatic ? <ConnectDialogsStatic /> : null}
    </div>
  );
}
