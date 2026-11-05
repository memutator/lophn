// Home 오른쪽 sidebar의 본문. title bar의 panel icon tab이 고른 panel 하나(Workspaces / Jobs)를 그린다.
// Workspaces는 옛 launcher가 하던 일(project·앱 목록, 등록, 새 앱, 보관)이고 Jobs는 모든 workspace의 job이다.
import { t } from "@lophn/i18n";

import type { AppsSource } from "../../apps/source.ts";
import type { JobsSource } from "../../desktop/jobs/source.ts";
import type { ProjectsSource } from "../../desktop/workspaces/projects/source.ts";
import { shellIcons } from "../../icons/mod.ts";
import type { PanelTab } from "../../shell/panel-tabs.tsx";
import { WorkspacesPanel } from "../../shell/workspaces-panel.tsx";
import { RightSidebar } from "../../shell/right-sidebar.tsx";
import { JobPanel } from "./job-panel.tsx";

/** title bar의 panel icon tab. Jobs는 통로가 있을 때만 있다. */
export function homePanelTabs(withJobs: boolean): readonly PanelTab[] {
  return [
    {
      key: "workspaces",
      label: t("shell.heading.workspaces"),
      icon: shellIcons.app,
    },
    ...(withJobs
      ? [
          {
            key: "jobs",
            label: t("jobs.label.sidebar-tab"),
            icon: shellIcons.jobs,
          },
        ]
      : []),
  ];
}

interface HomePanelProps {
  tab: string;
  projects?: ProjectsSource;
  apps?: AppsSource;
  jobs?: JobsSource;
  onProject: (project: string) => void;
  onApp: (app: string) => void;
  onNewApp: (app: string) => void;
  /** Jobs 탭을 연다. */
  onOpenJobs: () => void;
}

export function HomePanel(props: HomePanelProps) {
  if (props.tab === "jobs" && props.jobs !== undefined) {
    return (
      <RightSidebar title={t("jobs.label.sidebar-tab")} panel="jobs">
        <JobPanel
          project={null}
          source={props.jobs}
          onOpenJobs={props.onOpenJobs}
        />
      </RightSidebar>
    );
  }
  return (
    <WorkspacesPanel
      projects={props.projects}
      apps={props.apps}
      onProject={props.onProject}
      onApp={props.onApp}
      onNewApp={props.onNewApp}
    />
  );
}
