// project 창의 sidebar = activity bar + panel. 왼쪽 activity bar(늘 보임)에서 Explorer / Agents / Artifacts / Domains / Workflows
// (통로가 있으면 Scheduled jobs도) 가운데 하나를 고르면 오른쪽 panel(머리: launcher 단추·project 이름)에 그 본문이 보인다. 접으면 bar만 남는다.

import { t } from "@lophn/wording";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useEffect,
  useState,
} from "react";
import type { JobsSource } from "../../desktop/settings/jobs/source.ts";
import {
  artifactIcons,
  commonIcons,
  settingsIcons,
  workspaceIcons,
} from "../../icons/mod.ts";
import type { ProjectView, WorkspaceSource } from "../source.ts";
import {
  ActivityBar,
  type ActivityEntry,
  type RailAction,
} from "./activity-bar.tsx";
import { AgentPanel } from "./agent-panel.tsx";
import { DomainPanel } from "./domain-panel.tsx";
import { Explorer, type TabAwareResult } from "./explorer.tsx";
import { useHiddenRecent } from "./hidden-recent.ts";
import { JobPanel } from "./job-panel.tsx";
import styles from "./project-sidebar.module.css";
import type { SidebarAgent } from "./sidebar-agent.ts";
import {
  type PanelItem,
  type PanelRun,
  type PanelSession,
  type PanelTerminal,
  useAgentPanel,
} from "./use-agent-panel.ts";
import { WorkflowPanel } from "./workflow-panel.tsx";

export type SidebarTab =
  | "explorer"
  | "agent"
  | "artifact"
  | "domain"
  | "workflow"
  | "jobs";

export interface Reveal {
  readonly path: string;
  readonly nonce: number;
}

const ACTIVITY_ENTRIES: readonly ActivityEntry[] = [
  {
    key: "explorer",
    label: t("project-workspace.label.sidebar-tab-explorer"),
    icon: workspaceIcons.folder,
  },
  {
    key: "agent",
    label: t("project-workspace.label.sidebar-tab-agent"),
    icon: commonIcons.agents,
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
];

const JOBS_ENTRY: ActivityEntry = {
  key: "jobs",
  label: t("jobs.label.sidebar-tab"),
  icon: settingsIcons.jobs,
};

interface ProjectSidebarProps {
  mode: "open" | "collapsed";
  width: number;
  project: ProjectView | null;
  /** Explorer가 폴더를 읽는 통로. */
  source: WorkspaceSource;
  /** Agent 모양의 agent 줄(`useSidebarAgents`)과 session 줄(`useSessions()`에서 옮긴 값), 터미널 coding agent session. */
  agents: readonly SidebarAgent[];
  sessions: readonly PanelSession[];
  terminals: readonly PanelTerminal[];
  /** Background(run) 묶음의 줄. 비면 묶음이 없다. */
  runs?: readonly PanelRun[];
  /** Artifacts 탭 본문. 목록은 이 panel이 읽는다. */
  artifactPanel?: ReactNode;
  /** Domains 줄 menu의 Open DOMAIN.md. 주지 않으면 아무것도 하지 않는다. */
  onOpenDomainDoc?: (domain: string) => void;
  /** Workflows 줄을 누르면 그 workflow의 탭을 연다. 주지 않으면 아무것도 하지 않는다. */
  onOpenWorkflow?: (workflow: string) => void;
  /** 보이는 desk가 workflow의 것이면 그 이름. Workflows 줄이 강조한다. */
  activeWorkflow?: string;
  /** Scheduled jobs 탭의 통로. 주지 않으면 그 항목을 두지 않는다. */
  jobs?: JobsSource;
  /** Scheduled jobs 탭의 줄과 [Open all jobs]. Settings › Scheduled jobs를 연다. */
  onOpenJobs?: () => void;
  /** 편집기에서 열려 있는 파일의 절대 경로. */
  current?: string | null;
  /** 처음 보이는 탭. 기본은 Explorer다. */
  initialTab?: SidebarTab;
  /** keep이면 고정 탭으로, 아니면 preview 탭으로 연다(한 번 클릭). */
  onOpenFile: (path: string, keep?: boolean) => void;
  /** 올라갈 때마다 Explorer 모양으로 바꾸고 고른 줄에 focus를 준다(Ctrl/Cmd+Shift+E). 0은 요청 없음. */
  focusExplorer?: number;
  /** 탭 menu의 Reveal in Explorer. 바뀔 때마다 Explorer 모양으로 바꾸고 Explorer에 그 파일을 알린다. */
  reveal?: Reveal | null;
  /** Explorer의 이름 바꾸기·옮기기. 열린 탭 정리까지 한다. */
  onMove: (from: string, to: string) => Promise<TabAwareResult>;
  /** Explorer의 휴지통 보내기. 열린 탭 정리까지 한다. */
  onTrash: (path: string) => Promise<TabAwareResult>;
  onRail: (action: RailAction) => void;
  onAgent: (agent: SidebarAgent) => void;
  /** Agent 줄 hover의 +. 주지 않으면 `onAgent`와 같다. */
  onNewSession?: (agent: SidebarAgent) => void;
  onSession: (session: PanelSession) => void;
  onTerminal: (terminal: PanelTerminal) => void;
  onManage: () => void;
  onToggle: () => void;
  onSettings: () => void;
  onResizeStart?: (event: ReactPointerEvent<HTMLElement>) => void;
}

export function ProjectSidebar({
  mode,
  width,
  project,
  source,
  agents,
  sessions,
  terminals,
  runs,
  artifactPanel = null,
  onOpenDomainDoc,
  onOpenWorkflow,
  activeWorkflow,
  jobs,
  onOpenJobs,
  current = null,
  initialTab = "explorer",
  reveal = null,
  focusExplorer = 0,
  onOpenFile,
  onMove,
  onTrash,
  onRail,
  onAgent,
  onNewSession,
  onSession,
  onTerminal,
  onManage,
  onToggle,
  onSettings,
  onResizeStart,
}: ProjectSidebarProps) {
  // 고른 탭은 화면 상태일 뿐이라 저장하지 않는다.
  const [tab, setTab] = useState<SidebarTab>(initialTab);
  useEffect(() => {
    if (reveal !== null) setTab("explorer");
  }, [reveal]);
  // Explorer가 아직 없을 수 있다(접힘, 다른 모양). 그려질 때 한 번 focus하고 내려놓는다.
  const [focusAsked, setFocusAsked] = useState(false);
  const hasFolders = (project?.folders.length ?? 0) > 0;
  useEffect(() => {
    if (focusExplorer === 0) return;
    setTab("explorer");
    setFocusAsked(hasFolders);
  }, [focusExplorer]);
  const recentHidden = useHiddenRecent(project?.id ?? null);
  const panel = useAgentPanel(
    agents,
    sessions,
    terminals,
    runs,
    recentHidden.hidden,
  );
  const removeRecent = (item: PanelItem) =>
    recentHidden.hide(
      item.kind === "session" ? item.session.id : item.terminal.key,
      item.at,
    );
  const collapsed = mode === "collapsed";
  // 접혀 있거나 열린 항목을 다시 누르면 접힘 상태가 바뀐다. 다른 항목이면 panel만 바뀐다.
  const select = (key: SidebarTab) => {
    setTab(key);
    if (collapsed || key === tab) onToggle();
  };
  const folders = project?.folders ?? [];
  return (
    <nav
      className={styles.sidebar}
      data-sidebar={mode}
      // `width`는 panel 폭이다. 열리면 activity bar 폭을 더한다. 접히면 bar만 남아 `width`가 이미 bar 폭이다.
      style={{
        width: collapsed
          ? `${width}px`
          : `calc(${width}px + var(--layout-sidebar-collapsed))`,
      }}
      aria-label={t("project-workspace.sidebar.label")}
    >
      <ActivityBar
        entries={jobs ? [...ACTIVITY_ENTRIES, JOBS_ENTRY] : ACTIVITY_ENTRIES}
        selected={tab}
        open={!collapsed}
        onSelect={select}
        onRail={onRail}
        onSettings={onSettings}
      />
      {collapsed ? null : (
        <div className={styles.panel}>
          <div className={styles.body} data-sidebar-tab={tab}>
            {tab === "explorer" ? (
              folders.length === 0 ? (
                <p className={styles.empty}>
                  {t("project-workspace.empty.no-folders")}
                </p>
              ) : (
                <Explorer
                  // 프로젝트가 바뀌면 고른 루트와 펼침을 새로 시작한다.
                  key={project?.id}
                  source={source}
                  folders={folders}
                  current={current}
                  reveal={reveal}
                  focusAsked={focusAsked}
                  onFocusAsked={() => setFocusAsked(false)}
                  onOpenFile={onOpenFile}
                  onMove={onMove}
                  onTrash={onTrash}
                />
              )
            ) : null}
            {tab === "agent" ? (
              <AgentPanel
                view={panel}
                onAgent={onAgent}
                onNewSession={onNewSession}
                onSession={onSession}
                onTerminal={onTerminal}
                onRemove={removeRecent}
                onManage={onManage}
              />
            ) : null}
            {tab === "artifact" ? artifactPanel : null}
            {tab === "domain" && project !== null ? (
              <DomainPanel
                key={project.id}
                project={project.id}
                source={source}
                onOpenDoc={onOpenDomainDoc ?? (() => {})}
              />
            ) : null}
            {tab === "workflow" && project !== null ? (
              <WorkflowPanel
                key={project.id}
                project={project.id}
                source={source}
                active={activeWorkflow}
                onOpen={onOpenWorkflow ?? (() => {})}
              />
            ) : null}
            {tab === "jobs" && project !== null && jobs ? (
              <JobPanel
                key={project.id}
                project={project.id}
                source={jobs}
                onOpenSettings={onOpenJobs ?? (() => {})}
              />
            ) : null}
          </div>
        </div>
      )}
      {onResizeStart && !collapsed ? (
        <div
          className={styles.resizer}
          data-sidebar-resizer=""
          role="separator"
          aria-orientation="vertical"
          onPointerDown={onResizeStart}
        />
      ) : null}
    </nav>
  );
}
