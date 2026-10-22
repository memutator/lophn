// gallery 틀이고 renderer로 옮기지 않는다. renderer에서는 `ACTIVITY_ENTRIES`에 항목 하나를 더한다
// (`SidebarTab`에 "jobs", 항목 아이콘은 `settingsIcons.jobs`, `ProjectSidebar`의 본문 switch에 `tab === "jobs"` 한 줄).
// project 창 sidebar(`project-sidebar.tsx`의 마크업)를 복사하고 항목 여섯째 "Scheduled jobs"를 고른 상태로 그린다.
import type { ReactNode } from "react";
import { CalendarClock } from "lucide-react";
import { t } from "@lophn/wording";

import { LauncherButton } from "../../../../packages/shell/renderer/workspace/launcher-button.tsx";
import { SIDEBAR_WIDTH } from "../../../../packages/shell/renderer/workspace/model.ts";
import {
  ActivityBar,
  type ActivityEntry,
} from "../../../../packages/shell/renderer/workspace/sidebar/activity-bar.tsx";
import type { SidebarTab } from "../../../../packages/shell/renderer/workspace/sidebar/project-sidebar.tsx";
import {
  artifactIcons,
  commonIcons,
  workspaceIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";
import styles from "../../../../packages/shell/renderer/workspace/sidebar/project-sidebar.module.css";

// draft라서 SidebarTab에 없는 키를 형으로 맞춘다. renderer task가 SidebarTab에 "jobs"를 더한다.
const JOBS = "jobs" as SidebarTab;

const ENTRIES: readonly ActivityEntry[] = [
  {
    key: "explorer",
    label: t("project-workspace.label.sidebar-tab-explorer"),
    icon: workspaceIcons.folder,
  },
  {
    key: "agent",
    label: t("project-workspace.label.sidebar-tab-agent"),
    icon: commonIcons.roles,
  },
  {
    key: "artifact",
    label: t("project-workspace.label.sidebar-tab-artifact"),
    icon: artifactIcons.kind,
  },
  {
    key: "domain",
    label: t("domain.label.sidebar-tab"),
    icon: commonIcons.series,
  },
  {
    key: "workflow",
    label: t("workflow.label.sidebar-tab"),
    icon: commonIcons.workflow,
  },
  { key: JOBS, label: "Scheduled jobs", icon: CalendarClock },
];

const noop = () => {};

export function JobsSidebarFrame(
  { title, children }: { title: string; children: ReactNode },
) {
  return (
    <div
      style={{
        position: "absolute",
        inset: "var(--space-0)",
        display: "flex",
        background: "var(--color-surface-base)",
      }}
    >
      <nav
        className={styles.sidebar}
        data-sidebar="open"
        style={{
          width: `calc(${SIDEBAR_WIDTH}px + var(--layout-sidebar-collapsed))`,
        }}
        aria-label={t("project-workspace.sidebar.label")}
      >
        <ActivityBar
          entries={ENTRIES}
          selected={JOBS}
          open
          onSelect={noop}
          onRail={noop}
        />
        <div className={styles.panel}>
          <div className={styles.header}>
            <span className={styles.headerContent}>
              <LauncherButton onLauncher={noop} />
              <span className={styles.title} data-project-title="">
                {title}
              </span>
            </span>
          </div>
          <div className={styles.body} data-sidebar-tab="jobs">{children}</div>
        </div>
      </nav>
    </div>
  );
}
