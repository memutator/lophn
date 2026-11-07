// 오른쪽 sidebar의 panel 목록. 내장 panel과 사람이 켠 앱 sidebar 화면이 같은 모양(SidebarPanel)으로 한 목록에 선다.
// title bar의 panel icon tab과 sidebar 본문은 "지금 workspace 종류로 거른 목록"만 본다.
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { t } from "@lophn/i18n";

import { useAppViews, useAppWorkspace } from "../../app-frame/app-views.tsx";
import type { AppScreens, ScreensRead } from "../../app-frame/app-views.tsx";
import { EmbeddedView } from "../../app-frame/embedded-view.tsx";
import { ArtifactPanel } from "./artifact-panel.tsx";
import type { SidebarPanelPick } from "../../desktop/settings/quick-launch/source.ts";
import type { JobsSource } from "../../desktop/jobs/source.ts";
import { shellIcons } from "../../icons/mod.ts";
import { PanelEmpty } from "../../shell/panel-rows.tsx";
import { RightSidebar } from "../../shell/right-sidebar.tsx";
import {
  WorkspacesPanel,
  type WorkspacesPanelProps,
} from "../../shell/workspaces-panel.tsx";
import type { ProjectView, WorkspaceSource } from "../source.ts";
import { JobPanel } from "./job-panel.tsx";
import type { PanelSession } from "./panel-types.ts";
import { ExplorerPanel, type ExplorerPanelProps } from "./project-sidebar.tsx";
import { RunList, type RunRow } from "./run-list.tsx";
import { WorkflowPanel } from "./workflow-panel.tsx";

export type SidebarKind = "project" | "home" | "app";

/** panel이 그릴 때 쓰는 것. workspace 종류마다 있는 칸이 다르고, 없는 종류의 panel은 목록에서 걸러져 읽히지 않는다. */
export interface SidebarCtx {
  readonly kind: SidebarKind;
  /** Jobs panel의 통로. 없으면 Jobs panel을 두지 않는다. */
  readonly jobs?: JobsSource;
  /** Jobs panel의 줄과 [Open all jobs]. Jobs 탭을 연다. */
  readonly onOpenJobs: () => void;
  readonly project: {
    readonly view: ProjectView | null;
    readonly source: WorkspaceSource;
    readonly explorer: Omit<ExplorerPanelProps, "project" | "source">;
    readonly onOpenArtifact: (name: string) => void;
    /** Workflows 줄을 누르면 그 workflow의 탭을 연다. */
    readonly onOpenWorkflow: (workflow: string) => void;
    /** 보이는 desk가 workflow의 것이면 그 이름. Workflows 줄이 강조한다. */
    readonly activeWorkflow?: string;
  } | null;
  readonly home: WorkspacesPanelProps | null;
  readonly app: {
    readonly runs: readonly RunRow[];
    readonly onRunSession: (session: PanelSession) => void;
  } | null;
}

export interface SidebarPanel {
  readonly key: string;
  readonly label: string;
  readonly icon: LucideIcon;
  /** 앱 sidebar panel이면 그 앱. icon 대신 앱 icon을 그린다. */
  readonly app?: string;
  readonly kinds: readonly SidebarKind[];
  /** 조건이 있는 panel(Jobs). 없으면 kinds에 들면 늘 있다. */
  readonly available?: (ctx: SidebarCtx) => boolean;
  readonly render: (ctx: SidebarCtx) => ReactNode;
}

function builtinPanels(): readonly SidebarPanel[] {
  return [
    {
      key: "explorer",
      label: t("project-workspace.label.sidebar-tab-explorer"),
      icon: shellIcons.folder,
      kinds: ["project"],
      render: ({ project }) =>
        project === null ? null : (
          <ExplorerPanel
            project={project.view}
            source={project.source}
            {...project.explorer}
          />
        ),
    },
    {
      key: "artifact",
      label: t("project-workspace.label.sidebar-tab-artifact"),
      icon: shellIcons.artifact,
      kinds: ["project"],
      render: ({ project }) =>
        project?.view == null ? null : (
          <RightSidebar
            title={t("project-workspace.label.sidebar-tab-artifact")}
            panel="artifact"
          >
            <ArtifactPanel
              project={project.view.id}
              onOpen={project.onOpenArtifact}
            />
          </RightSidebar>
        ),
    },
    {
      key: "workflow",
      label: t("workflow.label.sidebar-tab"),
      icon: shellIcons.workflow,
      kinds: ["project"],
      render: ({ project }) =>
        project?.view == null ? null : (
          <RightSidebar
            title={t("workflow.label.sidebar-tab")}
            panel="workflow"
          >
            <WorkflowPanel
              key={project.view.id}
              project={project.view.id}
              source={project.source}
              active={project.activeWorkflow}
              onOpen={project.onOpenWorkflow}
            />
          </RightSidebar>
        ),
    },
    {
      key: "workspaces",
      label: t("shell.heading.workspaces"),
      icon: shellIcons.app,
      kinds: ["home"],
      render: ({ home }) =>
        home === null ? null : <WorkspacesPanel {...home} />,
    },
    {
      key: "jobs",
      label: t("jobs.label.sidebar-tab"),
      icon: shellIcons.jobs,
      kinds: ["project", "home"],
      available: (ctx) => ctx.jobs !== undefined,
      render: ({ kind, project, jobs, onOpenJobs }) => {
        // project는 그 project에 걸린 job만, Home은 모든 job이다.
        const id = kind === "project" ? (project?.view?.id ?? null) : null;
        if (jobs === undefined || (kind === "project" && id === null)) {
          return null;
        }
        return (
          <RightSidebar title={t("jobs.label.sidebar-tab")} panel="jobs">
            <JobPanel
              key={id ?? "all"}
              project={id}
              source={jobs}
              onOpenJobs={onOpenJobs}
            />
          </RightSidebar>
        );
      },
    },
    {
      // Logs는 이 앱의 run 기록(tool run과 이 앱 workspace에서 돈 agent run)이다. 앱 상세는 App details 탭이다.
      key: "logs",
      label: t("app-space.heading.panel-logs"),
      icon: shellIcons.logs,
      kinds: ["app"],
      render: ({ app }) =>
        app === null ? null : (
          <RightSidebar title={t("app-space.heading.panel-logs")} panel="logs">
            {app.runs.length === 0 ? (
              <div data-runs-empty="">
                <PanelEmpty>{t("run-list.empty.none")}</PanelEmpty>
              </div>
            ) : (
              <RunList runs={app.runs} onSession={app.onRunSession} />
            )}
          </RightSidebar>
        ),
    },
  ];
}

export const appPanelKey = (app: string, screen: string) =>
  `app:${app}:${screen}`;

/** 앱 sidebar panel의 view를 숨겨 두는 보관 key. 탭 key가 아니라 창이 떠날 때까지 산다. */
export const SIDEBAR_KEEP_PREFIX = "sidebar:";

function AppSidebarBody(props: { app: string; screen: string; label: string }) {
  const deps = useAppViews();
  const workspace = useAppWorkspace();
  if (deps === null) return null;
  return (
    <RightSidebar
      title={props.label}
      panel={appPanelKey(props.app, props.screen)}
    >
      <EmbeddedView
        views={deps.views}
        app={props.app}
        mode="live"
        screen={props.screen}
        place="sidebar"
        workspace={workspace}
        label={props.label}
        keepKey={`${SIDEBAR_KEEP_PREFIX}${props.app}:${props.screen}`}
      />
    </RightSidebar>
  );
}

/** 켠 화면 가운데 설치돼 있고 `sidebar` 자리를 가진 것. 앱이 지워졌거나 화면이 없어졌으면 빠진다. */
function appPanels(
  picks: readonly SidebarPanelPick[],
  read: ScreensRead | null,
): readonly SidebarPanel[] {
  if (read === null || !read.ok) return [];
  return picks.flatMap((pick) => {
    const screen = read.value
      .find((app: AppScreens) => app.app === pick.app)
      ?.screens.find((item) => item.key === pick.screen);
    if (screen === undefined || !screen.places.includes("sidebar")) return [];
    return [
      {
        key: appPanelKey(pick.app, pick.screen),
        label: screen.label,
        icon: shellIcons.app,
        app: pick.app,
        kinds: ["project", "home", "app"],
        render: () => (
          <AppSidebarBody
            key={appPanelKey(pick.app, pick.screen)}
            app={pick.app}
            screen={pick.screen}
            label={screen.label}
          />
        ),
      } satisfies SidebarPanel,
    ];
  });
}

/** 지금 workspace 종류의 panel 목록. 내장 panel 다음에 앱 sidebar panel이 선다. */
export function sidebarPanelsFor(
  ctx: SidebarCtx,
  picks: readonly SidebarPanelPick[],
  screens: ScreensRead | null,
): readonly SidebarPanel[] {
  return [...builtinPanels(), ...appPanels(picks, screens)].filter(
    (panel) =>
      panel.kinds.includes(ctx.kind) && (panel.available?.(ctx) ?? true),
  );
}
