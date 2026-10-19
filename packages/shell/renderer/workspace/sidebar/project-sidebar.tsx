// project 창의 sidebar. 머리(launcher 단추·project 이름·접기 단추) 아래 아이콘 탭 Explorer / Agent / Artifacts / Domains
// 가운데 하나만 보이고, 접으면 바로 가기 rail이 된다. 탭이 넷이라 240px에서 글자 이름이 잘려 아이콘만 두고 이름은 tooltip이다.
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import { TabStrip } from "../../parts/tab-strip/tab-strip.tsx";
import { Icon, IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { iconPixels } from "@lophn/ui/shared";
import {
  artifactIcons,
  commonIcons,
  conversationIcons,
  workspaceIcons,
} from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import type { ProjectView, WorkspaceSource } from "../source.ts";
import { LauncherButton } from "../launcher-button.tsx";
import { AgentPanel } from "./agent-panel.tsx";
import { DomainPanel } from "./domain-panel.tsx";
import { Explorer, type TabAwareResult } from "./explorer.tsx";
import { Rail, type RailAction } from "./rail.tsx";
import type { SidebarAgent } from "./sidebar-agent.ts";
import { type PanelSession, useAgentPanel } from "./use-agent-panel.ts";
import styles from "./project-sidebar.module.css";

export type SidebarTab = "explorer" | "agent" | "artifact" | "domain";

export interface Reveal {
  readonly path: string;
  readonly nonce: number;
}

const TABS: readonly SidebarTab[] = [
  "explorer",
  "agent",
  "artifact",
  "domain",
];

const TAB_ICONS = {
  explorer: workspaceIcons.folder,
  agent: conversationIcons.dock,
  artifact: artifactIcons.kind,
  domain: commonIcons.series,
} as const;

const tabLabel = (key: SidebarTab) =>
  key === "domain"
    ? t("domain.label.sidebar-tab")
    : t(`project-workspace.label.sidebar-tab-${key}`);

interface ProjectSidebarProps {
  mode: "open" | "collapsed";
  width: number;
  project: ProjectView | null;
  /** Explorer가 폴더를 읽는 통로. */
  source: WorkspaceSource;
  /** Agent 모양의 agent 줄(`useSidebarAgents`)과 session 줄(`useSessions()`에서 옮긴 값). */
  agents: readonly SidebarAgent[];
  sessions: readonly PanelSession[];
  /** Artifacts 탭 본문. 목록은 이 panel이 읽는다. */
  artifactPanel?: ReactNode;
  /** Domains 줄 menu의 Open DOMAIN.md. 주지 않으면 아무것도 하지 않는다. */
  onOpenDomainDoc?: (domain: string) => void;
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
    agents,
    sessions,
    artifactPanel = null,
    onOpenDomainDoc,
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
  // Explorer가 아직 없을 수 있다(접힘, 다른 모양). 그려질 때 한 번 focus하고 내려놓는다.
  const [focusAsked, setFocusAsked] = useState(false);
  const hasFolders = (project?.folders.length ?? 0) > 0;
  useEffect(() => {
    if (focusExplorer === 0) return;
    setTab("explorer");
    setFocusAsked(hasFolders);
  }, [focusExplorer]);
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
            tabs={TABS.map((key) => {
              const label = tabLabel(key);
              return {
                key,
                title: "",
                icon: (
                  <Tooltip content={label}>
                    <span role="img" aria-label={label}>
                      <Icon icon={TAB_ICONS[key]} pixels={iconPixels("base")} />
                    </span>
                  </Tooltip>
                ),
              };
            })}
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
                    focusAsked={focusAsked}
                    onFocusAsked={() => setFocusAsked(false)}
                    onOpenFile={onOpenFile}
                    onMove={onMove}
                    onTrash={onTrash}
                  />
                )
              : null}
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
            {tab === "artifact" ? artifactPanel : null}
            {tab === "domain" && project !== null
              ? (
                <DomainPanel
                  key={project.id}
                  project={project.id}
                  source={source}
                  onOpenDoc={onOpenDomainDoc ?? (() => {})}
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
