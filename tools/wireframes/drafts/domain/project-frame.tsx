// project 창 틀. 실제 TopBar·Breadcrumbs·TabStrip·DocumentPane은 renderer의 것이고, sidebar는 탭이 넷(Explorer, Agent,
// Artifacts, Domains)이라 실제 `ProjectSidebar`를 못 쓴다. 머리와 탭 줄을 같은 부품과 같은 CSS로 다시 놓고 본문만 갈아 낀다.
import type { ReactNode } from "react";
import { IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { t } from "@lophn/wording";

import {
  PaletteButton,
  TopBar,
} from "../../../../packages/shell/renderer/desktop/top-bar/top-bar.tsx";
import { Breadcrumbs } from "../../../../packages/shell/renderer/workspace/top-path/breadcrumbs.tsx";
import { LauncherButton } from "../../../../packages/shell/renderer/workspace/launcher-button.tsx";
import { TabStrip } from "../../../../packages/shell/renderer/parts/tab-strip/tab-strip.tsx";
import { AgentPanel } from "../../../../packages/shell/renderer/workspace/sidebar/agent-panel.tsx";
import {
  type PanelSession,
  useAgentPanel,
} from "../../../../packages/shell/renderer/workspace/sidebar/use-agent-panel.ts";
import type { SidebarAgent } from "../../../../packages/shell/renderer/workspace/sidebar/sidebar-agent.ts";
import { workspaceIcons } from "../../../../packages/shell/renderer/icons/mod.ts";
import sidebar from "../../../../packages/shell/renderer/workspace/sidebar/project-sidebar.module.css";
import workspace from "../../../../packages/shell/renderer/workspace/workspace.module.css";
import paneStyles from "../../../../packages/shell/renderer/workspace/panes/panes.module.css";
import { GalleryConnectHost } from "../../mock/connect-host.tsx";
import { documentTab } from "../../mock/phroner-data.ts";
import { AGENTS, PROJECT_NAME } from "../../mock/domain/data.ts";
import { DocumentPane } from "../../pages/screens/documents.tsx";
import { stripTabsOf } from "../../pages/screens/project-window.tsx";

export type SidebarKey = "explorer" | "agent" | "artifact" | "domain";

const noop = () => {};
const DOC_PATH = "eval/experiments/exp-008-query-tools.md";

function tabTitle(key: SidebarKey): string {
  return key === "domain"
    ? t("domain.label.sidebar-tab")
    : t(`project-workspace.label.sidebar-tab-${key}`);
}

/** project sidebar 틀. 머리와 탭 줄은 실제 sidebar와 같고 본문은 children이다. */
export function DraftSidebar(
  { keys, selected, width = 240, children }: {
    keys: readonly SidebarKey[];
    selected: SidebarKey;
    width?: number;
    children: ReactNode;
  },
) {
  const label = t("project-workspace.button.collapse-sidebar");
  return (
    <nav
      className={sidebar.sidebar}
      style={{ width: `${width}px` }}
      aria-label={t("project-workspace.sidebar.label")}
    >
      <div className={sidebar.header}>
        <span className={sidebar.headerContent}>
          <LauncherButton onLauncher={noop} />
          <span className={sidebar.title}>{PROJECT_NAME}</span>
        </span>
        <Tooltip content={label}>
          <IconButton icon={workspaceIcons.sidebar} label={label} />
        </Tooltip>
      </div>
      <TabStrip
        compact
        tabs={keys.map((key) => ({ key, title: tabTitle(key) }))}
        selected={selected}
      />
      <div className={sidebar.body}>{children}</div>
    </nav>
  );
}

/** sidebar 본문 틀 하나만 쓰는 곳(빈 상태처럼 두 sidebar를 나란히 놓는 page)이 쓴다. */
export const SIDEBAR_KEYS: readonly SidebarKey[] = [
  "explorer",
  "agent",
  "artifact",
  "domain",
];
export const SIDEBAR_KEYS_NO_DOMAIN: readonly SidebarKey[] = [
  "explorer",
  "agent",
  "artifact",
];

/** project 창. sidebar 자리에 위의 DraftSidebar를 넣고 오른쪽 칸에는 문서 탭 하나를 둔다. */
export function DraftProjectWindow(
  { sidebar: side, children }: { sidebar: ReactNode; children?: ReactNode },
) {
  const tab = documentTab(DOC_PATH);
  return (
    <GalleryConnectHost>
      <div className={workspace.workspace}>
        {side}
        <div className={workspace.main}>
          <div className={workspace.topBar}>
            <TopBar
              platform="linux"
              leading={
                <div className={workspace.leading}>
                  <Breadcrumbs
                    crumbs={[
                      PROJECT_NAME,
                      "eval",
                      "experiments",
                      "exp-008-query-tools.md",
                    ].map(
                      (label) => ({ label }),
                    )}
                  />
                </div>
              }
              trailing={
                <div className={workspace.trailing}>
                  <PaletteButton onClick={noop} />
                </div>
              }
            />
          </div>
          <div className={paneStyles.panes}>
            <section className={paneStyles.pane}>
              <TabStrip tabs={stripTabsOf([tab])} selected={tab.key} />
              <div className={`${paneStyles.body} ${paneStyles.flush}`}>
                <DocumentPane
                  path={DOC_PATH}
                  info={null}
                  editing={false}
                  onEditing={noop}
                />
              </div>
            </section>
          </div>
        </div>
        {children}
      </div>
    </GalleryConnectHost>
  );
}

// ---- Agent 탭 본문(B의 chip 줄 아래). 실제 AgentPanel이고 값만 고정이다 ----
const MINUTE = 60_000;
const NOW = Date.now();

const SIDEBAR_AGENTS: readonly SidebarAgent[] = AGENTS.map((agent) => ({
  assignment: agent.id,
  role: agent.role,
  name: agent.name,
  profile: { kind: "icon", icon: agent.icon },
  waiting: false,
}));

const SESSIONS: readonly PanelSession[] = [
  {
    id: "s1",
    title: "Weekly report",
    agent: "lophn",
    status: "waiting",
    open: true,
    at: NOW - 2 * MINUTE,
  },
  {
    id: "s2",
    title: "Which rubric fits exp-008?",
    agent: "eval-analyst",
    status: "working",
    open: true,
    at: NOW - 12 * MINUTE,
  },
  {
    id: "s3",
    title: "Group findings by impact",
    agent: "engineer",
    status: "idle",
    open: false,
    at: NOW - 180 * MINUTE,
  },
];

export function AgentTabBody() {
  const view = useAgentPanel(SIDEBAR_AGENTS, SESSIONS);
  return (
    <AgentPanel
      view={view}
      onAgent={noop}
      onSession={noop}
      onManage={noop}
    />
  );
}
