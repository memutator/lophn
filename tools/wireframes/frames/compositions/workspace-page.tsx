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
  workspaceIcons,
} from "@lophn/design/components";

import { TopBar } from "../../../../apps/shell/renderer/desktop/top-bar/top-bar.tsx";
import { LauncherButton } from "../../../../apps/shell/renderer/workspace/launcher-button.tsx";
import type { LophnScreen } from "../../../../apps/shell/renderer/desktop/lophn-space/model.ts";
import {
  screenIcon,
  screenLabel,
} from "../../../../apps/shell/renderer/desktop/lophn-space/screens.ts";
import sideStyles from "../../../../apps/shell/renderer/desktop/lophn-space/sidebar/sidebar.module.css";
import { Mono } from "./project-window.tsx";
import styles from "./compose.module.css";

const SCREENS: readonly LophnScreen[] = [
  "projects",
  "apps",
  "things-to-confirm",
  "roles",
  "settings",
];

export function WorkspaceWithoutProject() {
  const [collapsed, setCollapsed] = useState(false);
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
          {SCREENS.map((screen) => (
            <li key={screen} className={sideStyles.li}>
              <span
                className={`${sideStyles.item} ${
                  screen === "projects" ? sideStyles.active : ""
                }`}
                aria-label={collapsed ? screenLabel(screen) : undefined}
                title={screenLabel(screen)}
              >
                <Icon
                  icon={screenIcon(screen)}
                  pixels={iconPixels("base")}
                  className={sideStyles.icon}
                />
                {collapsed ? null : (
                  <span className={sideStyles.label}>
                    {screenLabel(screen)}
                  </span>
                )}
              </span>
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
                <span className={styles.projectName}>Projects</span>
              </div>
            }
          />
        </div>
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
      </div>
    </div>
  );
}
