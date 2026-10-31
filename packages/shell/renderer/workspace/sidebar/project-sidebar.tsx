// project 창 오른쪽 sidebar의 본문. title bar의 panel icon tab이 고른 panel 하나(Files / Domain / Artifacts /
// Workflows / Jobs)를 `RightSidebar` 틀에 담는다. 틀(폭, 접힘)은 ShellFrame이 정한다. 왼쪽은 shell/left-sidebar다.

import { t } from "@lophn/i18n";
import { type ReactNode, useEffect, useState } from "react";
import type { PanelTab } from "../../shell/panel-tabs.tsx";
import { PanelEmpty } from "../../shell/panel-rows.tsx";
import { RightSidebar } from "../../shell/right-sidebar.tsx";
import type { JobsSource } from "../../desktop/settings/jobs/source.ts";
import { shellIcons } from "../../icons/mod.ts";
import type { ProjectView, WorkspaceSource } from "../source.ts";
import { DomainPanel } from "./domain-panel.tsx";
import { Explorer, type TabAwareResult } from "./explorer.tsx";
import { JobPanel } from "./job-panel.tsx";
import styles from "./project-sidebar.module.css";
import { WorkflowPanel } from "./workflow-panel.tsx";

export type SidebarTab =
  | "explorer"
  | "artifact"
  | "domain"
  | "workflow"
  | "jobs";

export interface Reveal {
  readonly path: string;
  readonly nonce: number;
}

/** title bar의 panel icon tab. Jobs는 통로가 있을 때만 있다. */
export function panelTabs(withJobs: boolean): readonly PanelTab[] {
  return [
    {
      key: "explorer",
      label: t("project-workspace.label.sidebar-tab-explorer"),
      icon: shellIcons.folder,
    },
    {
      key: "domain",
      label: t("domain.label.sidebar-tab"),
      icon: shellIcons.domain,
    },
    {
      key: "artifact",
      label: t("project-workspace.label.sidebar-tab-artifact"),
      icon: shellIcons.artifact,
    },
    {
      key: "workflow",
      label: t("workflow.label.sidebar-tab"),
      icon: shellIcons.workflow,
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

interface ProjectPanelProps {
  tab: SidebarTab;
  project: ProjectView | null;
  /** Explorer가 폴더를 읽는 통로. */
  source: WorkspaceSource;
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
  /** keep이면 고정 탭으로, 아니면 preview 탭으로 연다(한 번 클릭). */
  onOpenFile: (path: string, keep?: boolean) => void;
  /** 올라갈 때마다 Explorer에 focus를 준다(Ctrl/Cmd+Shift+E). 0은 요청 없음. */
  focusExplorer?: number;
  /** Reveal in Explorer. Explorer에 그 파일을 알린다. */
  reveal?: Reveal | null;
  /** Explorer의 이름 바꾸기·옮기기. 열린 탭 정리까지 한다. */
  onMove: (from: string, to: string) => Promise<TabAwareResult>;
  /** Explorer의 휴지통 보내기. 열린 탭 정리까지 한다. */
  onTrash: (path: string) => Promise<TabAwareResult>;
  /** Explorer가 보이는 연결 폴더(루트). 작업대가 들고 있어 터미널도 같은 폴더에서 열린다. */
  explorerRoot: string | null;
  onExplorerRoot: (path: string) => void;
  /** 연결 폴더 더하기(OS 선택기)와 빼기. 사람이 선택기를 닫는 것도 true이고 실패는 false다. */
  onAddFolder: () => Promise<boolean>;
  onRemoveFolder: (path: string) => Promise<boolean>;
  /** 폴더 오른쪽 클릭 menu의 Open in Terminal. 없으면 그 항목을 두지 않는다. */
  onOpenTerminal?: (cwd: string) => void;
}

export function ProjectPanel({
  tab,
  project,
  source,
  artifactPanel = null,
  onOpenDomainDoc,
  onOpenWorkflow,
  activeWorkflow,
  jobs,
  onOpenJobs,
  current = null,
  reveal = null,
  focusExplorer = 0,
  onOpenFile,
  onMove,
  onTrash,
  explorerRoot,
  onExplorerRoot,
  onAddFolder,
  onRemoveFolder,
  onOpenTerminal,
}: ProjectPanelProps) {
  // Explorer가 아직 없을 수 있다(다른 panel). 그려질 때 한 번 focus하고 내려놓는다.
  const [focusAsked, setFocusAsked] = useState(false);
  const hasFolders = (project?.folders.length ?? 0) > 0;
  useEffect(() => {
    if (focusExplorer !== 0) setFocusAsked(hasFolders);
  }, [focusExplorer]);
  const folders = project?.folders ?? [];
  const title = panelTabs(true).find((item) => item.key === tab)?.label ?? "";
  return (
    <RightSidebar title={title} panel={tab}>
      {tab === "explorer" ? (
        folders.length === 0 ? (
          <PanelEmpty>{t("project-workspace.empty.no-folders")}</PanelEmpty>
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
            rootPath={explorerRoot}
            onRoot={onExplorerRoot}
            onAddFolder={onAddFolder}
            onRemoveFolder={onRemoveFolder}
            onOpenTerminal={onOpenTerminal}
          />
        )
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
    </RightSidebar>
  );
}
