// project 창의 sidebar. 머리(launcher 단추·project 이름·접기 단추) 아래 밑줄 글자 탭 Explorer / Context / Agent
// 가운데 하나만 보이고, 접으면 바로 가기 rail이 된다. Context 모양의 본문은 부르는 쪽이 slot으로 준다.
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { TabStrip } from "../../parts/tab-strip/tab-strip.tsx";
import { IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { workspaceIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import type { ProjectView, WorkspaceSource } from "../source.ts";
import { LauncherButton } from "../launcher-button.tsx";
import { AgentPanel } from "./agent-panel.tsx";
import { Explorer, type FileAction } from "./explorer.tsx";
import { Rail, type RailAction } from "./rail.tsx";
import type { SidebarAgent } from "./sidebar-agent.ts";
import { type PanelSession, useAgentPanel } from "./use-agent-panel.ts";
import styles from "./project-sidebar.module.css";

export type SidebarTab = "explorer" | "context" | "agent";

export interface Reveal {
  readonly path: string;
  readonly nonce: number;
}

const TABS: readonly SidebarTab[] = ["explorer", "context", "agent"];

interface ProjectSidebarProps {
  mode: "open" | "collapsed";
  width: number;
  project: ProjectView | null;
  /** Explorer가 폴더를 읽는 통로. */
  source: WorkspaceSource;
  /** Context 모양의 본문. */
  contextPanel: ReactNode;
  /** Agent 모양의 agent 줄(`useSidebarAgents`)과 session 줄(`useSessions()`에서 옮긴 값). */
  agents: readonly SidebarAgent[];
  sessions: readonly PanelSession[];
  /** 편집기에서 열려 있는 파일의 절대 경로. */
  current?: string | null;
  /** 처음 보이는 탭. 기본은 Explorer다. */
  initialTab?: SidebarTab;
  /** keep이면 고정 탭으로, 아니면 preview 탭으로 연다(한 번 클릭). */
  onOpenFile: (path: string, keep?: boolean) => void;
  /** 탭 menu의 Reveal in Explorer. 바뀔 때마다 Explorer 모양으로 바꾸고 Explorer에 그 파일을 알린다. */
  reveal?: Reveal | null;
  /** 오른쪽 클릭 menu. Rename·Delete의 실행과 확인은 부르는 쪽이 한다. */
  onFileAction: (action: FileAction, path: string) => void;
  onRail: (action: RailAction) => void;
  onAgent: (agent: SidebarAgent) => void;
  /** Agent 줄 hover의 +. 주지 않으면 `onAgent`와 같다. */
  onNewSession?: (agent: SidebarAgent) => void;
  onSession: (session: PanelSession) => void;
  onManage: () => void;
  onToggle: () => void;
  onLauncher: () => void;
  onResizeStart?: (event: ReactPointerEvent<HTMLElement>) => void;
}

export function ProjectSidebar(
  {
    mode,
    width,
    project,
    source,
    contextPanel,
    agents,
    sessions,
    current = null,
    initialTab = "explorer",
    reveal = null,
    onOpenFile,
    onFileAction,
    onRail,
    onAgent,
    onNewSession,
    onSession,
    onManage,
    onToggle,
    onLauncher,
    onResizeStart,
  }: ProjectSidebarProps,
) {
  // 고른 탭은 화면 상태일 뿐이라 저장하지 않는다.
  const [tab, setTab] = useState<SidebarTab>(initialTab);
  useEffect(() => {
    if (reveal !== null) setTab("explorer");
  }, [reveal]);
  const panel = useAgentPanel(agents, sessions);
  const collapsed = mode === "collapsed";
  const toggleLabel = collapsed
    ? t("project-workspace.button.expand-sidebar")
    : t("project-workspace.button.collapse-sidebar");
  const folders = project?.folders ?? [];
  return (
    <nav
      className={`${styles.sidebar} ${collapsed ? styles.collapsed : ""}`}
      data-sidebar={mode}
      style={{ width: `${width}px` }}
      aria-label={t("project-workspace.sidebar.label")}
    >
      <div className={styles.header}>
        {collapsed ? null : (
          <span className={styles.headerContent}>
            <LauncherButton onLauncher={onLauncher} />
            <span className={styles.title} data-project-title="">
              {project?.title ?? ""}
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
      {collapsed ? <Rail onRail={onRail} /> : (
        <>
          <TabStrip
            compact
            tabs={TABS.map((key) => ({
              key,
              title: t(`project-workspace.label.sidebar-tab-${key}`),
            }))}
            selected={tab}
            onSelect={(key) => setTab(key as SidebarTab)}
          />
          <div className={styles.body} data-sidebar-tab={tab}>
            {tab === "explorer"
              ? folders.length === 0
                ? (
                  <p className={styles.empty}>
                    {t("project-workspace.empty.no-folders")}
                  </p>
                )
                : (
                  <Explorer
                    // 프로젝트가 바뀌면 고른 루트와 펼침을 새로 시작한다.
                    key={project?.id}
                    source={source}
                    folders={folders}
                    current={current}
                    reveal={reveal}
                    onOpenFile={onOpenFile}
                    onFileAction={onFileAction}
                  />
                )
              : null}
            {tab === "context" ? contextPanel : null}
            {tab === "agent"
              ? (
                <AgentPanel
                  view={panel}
                  onAgent={onAgent}
                  onNewSession={onNewSession}
                  onSession={onSession}
                  onManage={onManage}
                />
              )
              : null}
          </div>
        </>
      )}
      {onResizeStart && !collapsed
        ? (
          <div
            className={styles.resizer}
            data-sidebar-resizer=""
            role="separator"
            aria-orientation="vertical"
            onPointerDown={onResizeStart}
          />
        )
        : null}
    </nav>
  );
}
