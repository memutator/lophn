// 새 설계 page들이 같이 쓰는 project 화면 조각. 실제 TopBar·Breadcrumbs·LauncherButton·Tooltip과 design
// component를 그대로 쓰고, 실제 sidebar·tab strip·menu는 source 없이 그릴 수 없거나 새 설계의
// 항목(Saved views, Context·Search·Agent 탭 종류, 바로 가기 rail)이 없어서 같은 CSS Module로 같은
// 모양의 마크업을 다시 짠 look-alike다. 앱 코드는 고치지 않는다.
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import {
  Icon,
  IconButton,
  iconPixels,
  type IconProps,
  Menu,
  Tooltip,
  Tree,
  type TreeNode,
} from "@lophn/design/components";
import {
  conversationIcons,
  lophnSpaceIcons,
  paletteIcons,
  workspaceIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";

import { LauncherButton } from "../../../../packages/shell/renderer/workspace/launcher-button.tsx";
import { TAB_MIN } from "../../../../packages/shell/renderer/workspace/model.ts";
import tabStyles from "../../../../packages/shell/renderer/workspace/tab-strip/tab-strip.module.css";
import sideStyles from "../../../../packages/shell/renderer/workspace/sidebar/sidebar.module.css";
import menuStyles from "../../../../packages/design/components/menu/menu.module.css";
import { ProfileAvatar } from "./agent-avatar.tsx";
import { AGENT_ROWS, type AgentProfile, type ChatInit } from "./agents-data.ts";
import type { FileInit } from "./project-files/file-data.ts";
import styles from "./compose.module.css";
import agentStyles from "./agents.module.css";

/** `public`으로 내놓는 type·field·relation 표시. */
export function Mark({ children }: { children: ReactNode }) {
  return <span className={styles.mark}>{children}</span>;
}

export function Mono({ children }: { children: ReactNode }) {
  return <span className={styles.mono}>{children}</span>;
}

export type TabKind =
  | "document"
  | "context"
  | "contexts"
  | "search"
  | "terminal"
  | "agent"
  | "agents"
  | "operator";

const KIND_ICON: Record<TabKind, IconProps["icon"]> = {
  document: workspaceIcons.documentEditor,
  context: workspaceIcons.context,
  contexts: workspaceIcons.context,
  search: paletteIcons.search,
  terminal: workspaceIcons.terminal,
  agent: conversationIcons.dock,
  agents: lophnSpaceIcons.roles,
  operator: lophnSpaceIcons.roles,
};

const KIND_LABEL: Record<TabKind, string> = {
  document: "Document editor",
  context: "Context",
  contexts: "Contexts",
  search: "Search",
  terminal: "Terminal",
  agent: "Agent",
  agents: "Agents",
  operator: "Operator",
};

export interface TabSpec {
  readonly key: string;
  readonly kind: TabKind;
  readonly title: string;
  /** 종류 글자를 바꾼다. */
  readonly label?: string;
  /** Context 탭이 여는 하위 탭, 문서 탭의 경로 같은 탭 하나의 설정. */
  readonly sub?: string;
  /** 이미 열린 Context 탭을 다른 하위 탭으로 다시 열 때 올린다. 본문이 새로 그려진다. */
  readonly rev?: number;
  /** 대화 탭의 시작 상태(어느 대화인지, 열린 menu). */
  readonly chat?: ChatInit;
  /** 탭 본문을 직접 준다. 있으면 종류별 본문 대신 이것을 그린다. */
  readonly body?: ReactNode;
  /** 문서 탭의 시작 상태(저장 상태, 밖에서 바뀐 안내, 검색 결과로 열린 줄). */
  readonly file?: FileInit;
  /** project 키워드 검색 탭(`sub`가 "files")이 채워 둔 검색어와 폴더. */
  readonly find?: {
    readonly query: string;
    readonly folder?: string;
    /** 방금 연 결과(경로:줄). */
    readonly opened?: string;
  };
}

/** 탭 줄. 종류는 아이콘과 글자로 구별한다(실제 TabStrip과 같은 마크업·CSS). 누르면 고르고 ×로 닫는다. */
export function TabBar(
  { tabs, selected, focused = true, states, newTab, onSelect, onClose }: {
    tabs: readonly TabSpec[];
    selected: string;
    focused?: boolean;
    /** Agent 탭의 상태 점(사람을 기다림·일하는 중). 탭 key → 상태. */
    states?: Readonly<Record<string, "waiting" | "working" | null>>;
    /** 탭 줄 끝의 새 탭 단추 위치. 없으면 누를 수 없는 + 단추다. */
    newTab?: ReactNode;
    onSelect?: (key: string) => void;
    onClose?: (key: string) => void;
  },
) {
  const list = useRef<HTMLDivElement>(null);
  // 새로 열린 탭이 줄 밖이면 줄 안에서만 scroll해 보이게 한다.
  useLayoutEffect(() => {
    const element = list.current;
    const tab = element?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!element || !tab) return;
    const right = tab.offsetLeft + tab.offsetWidth;
    if (right > element.scrollLeft + element.clientWidth) {
      element.scrollLeft = right - element.clientWidth;
    } else if (tab.offsetLeft < element.scrollLeft) {
      element.scrollLeft = tab.offsetLeft;
    }
  }, [selected, tabs.length]);
  return (
    <div className={tabStyles.bar}>
      <div ref={list} className={tabStyles.list} role="tablist">
        {tabs.map((tab) => {
          const active = tab.key === selected;
          return (
            <div
              key={tab.key}
              className={[
                tabStyles.tab,
                active ? tabStyles.active : "",
                active && focused ? tabStyles.focusBar : "",
              ].join(" ")}
              role="tab"
              aria-selected={active}
              style={{ minWidth: `${TAB_MIN}px`, maxWidth: "300px" }}
              onClick={() => onSelect?.(tab.key)}
            >
              <Icon
                icon={KIND_ICON[tab.kind]}
                pixels={iconPixels("small")}
                className={tabStyles.icon}
              />
              {states?.[tab.key]
                ? (
                  <span
                    className={`${agentStyles.tabDot} ${
                      agentStyles[`state_${states[tab.key]}`]
                    }`}
                    role="img"
                    aria-label={states[tab.key] === "waiting"
                      ? "Waiting for you"
                      : "Working"}
                    title={states[tab.key] === "waiting"
                      ? "Waiting for you"
                      : "Working"}
                  />
                )
                : null}
              <span className={tabStyles.title}>{tab.title}</span>
              <span className={tabStyles.kind}>
                {tab.label ?? KIND_LABEL[tab.kind]}
              </span>
              <button
                type="button"
                className={tabStyles.close}
                aria-label="Close tab"
                onClick={(event) => {
                  event.stopPropagation();
                  onClose?.(tab.key);
                }}
              >
                <Icon
                  icon={workspaceIcons.close}
                  pixels={iconPixels("small")}
                />
              </button>
            </div>
          );
        })}
      </div>
      <div className={tabStyles.end}>
        {newTab ?? (
          <IconButton icon={lophnSpaceIcons.add} label="New tab" size="sm" />
        )}
      </div>
    </div>
  );
}

/** 등록 폴더의 디스크 파일 tree. 문서로 잡힌 것만이 아니라 모든 파일이 보인다. */
const FOLDER_TREE: readonly TreeNode[] = [
  {
    id: "assets",
    label: "assets",
    children: [{ id: "assets/chest-layout.png", label: "chest-layout.png" }],
  },
  {
    id: "docs",
    label: "docs",
    children: [{ id: "docs/notes.md", label: "notes.md" }],
  },
  {
    id: "eval",
    label: "eval",
    children: [
      {
        id: "eval/experiments",
        label: "experiments",
        children: [
          {
            id: "eval/experiments/exp-008-query-tools.md",
            label: "exp-008-query-tools.md",
          },
          {
            id: "eval/experiments/exp-012-ftb-quests-021-q8.md",
            label: "exp-012-ftb-quests-021-q8.md",
          },
        ],
      },
      {
        id: "eval/rubrics",
        label: "rubrics",
        children: [
          {
            id: "eval/rubrics/query-hygiene.json",
            label: "query-hygiene.json",
          },
        ],
      },
      {
        id: "eval/scenarios",
        label: "scenarios",
        children: [
          {
            id: "eval/scenarios/query-leave-still",
            label: "query-leave-still",
            children: [
              {
                id: "eval/scenarios/query-leave-still/r1.yaml",
                label: "r1.yaml",
              },
            ],
          },
        ],
      },
    ],
  },
  {
    id: "loop",
    label: "loop",
    children: [
      {
        id: "loop/findings",
        label: "findings",
        children: [
          { id: "loop/findings/F-009.md", label: "F-009.md" },
          { id: "loop/findings/F-010.md", label: "F-010.md" },
        ],
      },
    ],
  },
  {
    id: "reports",
    label: "reports",
    children: [{ id: "reports/weekly-12.pdf", label: "weekly-12.pdf" }],
  },
  { id: "LOPHN.md", label: "LOPHN.md" },
];

const OPEN_BRANCHES = new Set(["eval", "eval/experiments"]);
const NO_BRANCHES = new Set<string>();

function SidebarRow(
  { icon, label, active = false, onClick }: {
    icon: IconProps["icon"];
    label: string;
    active?: boolean;
    onClick?: () => void;
  },
) {
  const className = `${sideStyles.item} ${active ? sideStyles.active : ""}`;
  const inner = (
    <>
      <Icon
        icon={icon}
        pixels={iconPixels("base")}
        className={sideStyles.icon}
      />
      <span className={sideStyles.label}>{label}</span>
    </>
  );
  return (
    <li className={sideStyles.li}>
      {onClick
        ? (
          <button type="button" className={className} onClick={onClick}>
            {inner}
          </button>
        )
        : <span className={className}>{inner}</span>}
    </li>
  );
}

interface SidebarAgent {
  readonly id: string;
  readonly name: string;
  readonly profile: AgentProfile;
}

/** lophn은 전체에 하나, Project Manager는 project마다 하나다. 그 아래에 사람이 만든 Operators가 온다. */
const SIDEBAR_AGENTS: readonly SidebarAgent[] = AGENT_ROWS.filter((row) =>
  row.operator !== true
);

const OPERATORS: readonly SidebarAgent[] = AGENT_ROWS.filter((row) =>
  row.operator === true && row.id !== "operators"
);

function AgentRowItem(
  { agent, hover, onAgent }: {
    agent: SidebarAgent;
    hover: boolean;
    onAgent: (agent: string) => void;
  },
) {
  return (
    <li
      className={`${sideStyles.li} ${agentStyles.agentRow}`}
      data-hover={hover ? "" : undefined}
    >
      <button
        type="button"
        className={sideStyles.item}
        onClick={() => onAgent(agent.id)}
      >
        <ProfileAvatar profile={agent.profile} size="sm" />
        <span className={sideStyles.label}>{agent.name}</span>
      </button>
      <span className={agentStyles.plus}>
        <IconButton
          icon={lophnSpaceIcons.add}
          label={`New session with ${agent.name}`}
          size="sm"
          onClick={() => onAgent(agent.id)}
        />
      </span>
    </li>
  );
}

/** 접힌 sidebar rail의 바로 가기. 누르면 그 탭을 연다. */
export type RailAction =
  | "terminal"
  | "search"
  | "contexts"
  | "saved"
  | "agent";

const RAIL: readonly {
  action: RailAction;
  label: string;
  icon: IconProps["icon"];
}[] = [
  { action: "terminal", label: "Terminal", icon: workspaceIcons.terminal },
  { action: "contexts", label: "Contexts", icon: workspaceIcons.context },
  { action: "saved", label: "Saved views", icon: lophnSpaceIcons.savedView },
  { action: "agent", label: "Agent", icon: conversationIcons.dock },
  { action: "search", label: "Search", icon: paletteIcons.search },
];

export interface SidebarSpec {
  /** 고른 문서 행(트리 id). */
  readonly current?: string;
  /** 오른쪽 클릭 메뉴가 열린 행. 다중 선택 배경으로 보인다. */
  readonly menuFor?: string;
  /** 트리 아래에 얹는 메뉴. */
  readonly menu?: ReactNode;
  readonly savedActive?: string;
  /** 접힌 sidebar로 시작한다. */
  readonly collapsed?: boolean;
  /** rail의 이 단추 tooltip을 열어 둔 채로 그린다. */
  readonly railTooltip?: RailAction;
  /** 이 agent 줄에 hover한 것처럼 "+"를 보인다. */
  readonly hoverAgent?: string;
  /** 파일 tree를 모두 접어 그린다(Agents 묶음이 한 화면에 들어오게). */
  readonly foldersClosed?: boolean;
  /** sidebar 본문을 맨 아래로 scroll해 Agents가 보이게 한다. */
  readonly scrollToAgents?: boolean;
}

export interface SidebarProps extends SidebarSpec {
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly onRail: (action: RailAction) => void;
  readonly onOpenFile: (id: string) => void;
  readonly onOpenContext: (name: string) => void;
  readonly onAgent: (agent: string) => void;
  readonly onManage: () => void;
  /** saved view 이름을 누르면 그 결과를 연다. 없으면 Saved views 탭 단추와 같다. */
  readonly onSavedView?: (view: string) => void;
}

/**
 * project sidebar: Files(디스크 파일 tree 하나), Contexts, Saved views, Agents(lophn · Project Manager · Operators).
 * 접으면 바로 가기 rail이 된다: 펼치기 · Terminal · Contexts · Saved views · Agent · Search.
 */
export function ProjectSidebar(
  {
    current,
    menuFor,
    menu,
    savedActive,
    collapsed,
    railTooltip,
    onToggle,
    onRail,
    onOpenFile,
    onOpenContext,
    hoverAgent,
    foldersClosed = false,
    scrollToAgents = false,
    onAgent,
    onManage,
    onSavedView,
  }: SidebarProps,
) {
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";
  const body = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (scrollToAgents && body.current) {
      body.current.scrollTop = body.current.scrollHeight;
    }
  }, [scrollToAgents, collapsed]);
  return (
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
            <span className={sideStyles.title}>phroner</span>
          </span>
        )}
        <IconButton
          icon={workspaceIcons.sidebar}
          label={toggleLabel}
          aria-expanded={!collapsed}
          onClick={onToggle}
        />
      </div>
      {collapsed
        ? (
          <div className={styles.rail} role="toolbar" aria-label="Shortcuts">
            <hr className={styles.railRule} />
            {RAIL.map((item) => (
              <Tooltip
                key={item.action}
                content={item.label}
                open={railTooltip === item.action ? true : undefined}
              >
                <IconButton
                  icon={item.icon}
                  label={item.label}
                  onClick={() => onRail(item.action)}
                />
              </Tooltip>
            ))}
          </div>
        )
        : (
          <div ref={body} className={sideStyles.body}>
            <section className={sideStyles.section}>
              <h2 className={sideStyles.sectionLabel}>Files</h2>
              <div className={styles.treeBox}>
                <Tree
                  nodes={FOLDER_TREE}
                  expanded={foldersClosed ? NO_BRANCHES : OPEN_BRANCHES}
                  onExpandedChange={() => {}}
                  currentId={current}
                  selectedIds={menuFor === undefined
                    ? undefined
                    : new Set([menuFor])}
                  onOpen={onOpenFile}
                  label="Files"
                />
                {menu}
              </div>
            </section>
            <section className={sideStyles.section}>
              <h2 className={sideStyles.sectionLabel}>Contexts</h2>
              <ul className={sideStyles.list} role="list">
                <SidebarRow
                  icon={workspaceIcons.context}
                  label="eval"
                  onClick={() => onOpenContext("eval")}
                />
                <SidebarRow
                  icon={workspaceIcons.context}
                  label="harness"
                  onClick={() => onOpenContext("harness")}
                />
              </ul>
            </section>
            <section className={sideStyles.section}>
              <h2 className={sideStyles.sectionLabel}>Saved views</h2>
              <ul className={sideStyles.list} role="list">
                <SidebarRow
                  icon={lophnSpaceIcons.savedView}
                  label="Running experiments"
                  active={savedActive === "running"}
                  onClick={() =>
                    (onSavedView ?? (() => onRail("saved")))("running")}
                />
                <SidebarRow
                  icon={lophnSpaceIcons.savedView}
                  label="Findings for C-049"
                  active={savedActive === "c-049"}
                  onClick={() =>
                    (onSavedView ?? (() => onRail("saved")))("c-049")}
                />
              </ul>
            </section>
            <section className={sideStyles.section}>
              <h2
                className={`${sideStyles.sectionLabel} ${agentStyles.agentsHead}`}
              >
                <span>Agents</span>
                <button
                  type="button"
                  className={agentStyles.manage}
                  onClick={onManage}
                >
                  Manage
                </button>
              </h2>
              <ul className={sideStyles.list} role="list">
                {SIDEBAR_AGENTS.map((agent) => (
                  <AgentRowItem
                    key={agent.id}
                    agent={agent}
                    hover={hoverAgent === agent.id}
                    onAgent={onAgent}
                  />
                ))}
                {OPERATORS.length === 0
                  ? null
                  : <li className={agentStyles.subLabel}>Operators</li>}
                {OPERATORS.map((agent) => (
                  <AgentRowItem
                    key={agent.id}
                    agent={agent}
                    hover={hoverAgent === agent.id}
                    onAgent={onAgent}
                  />
                ))}
              </ul>
            </section>
          </div>
        )}
    </nav>
  );
}

/** 오른쪽 클릭·+ 메뉴의 정적 모양. 실제 Menu(Radix)와 같은 CSS Module을 쓴다. */
export function StaticMenu(
  { items, head, width = 200, highlighted }: {
    items: readonly { label: string; more?: boolean }[];
    head?: string;
    width?: number;
    highlighted?: string;
  },
) {
  return (
    <div
      className={`${menuStyles.menu} ${styles.menuStatic}`}
      role="menu"
      style={{ minWidth: `${width}px` }}
    >
      {head === undefined
        ? null
        : <div className={styles.menuHead}>{head}</div>}
      {items.map((item) => (
        <div
          key={item.label}
          role="menuitem"
          className={menuStyles.item}
          data-highlighted={item.label === highlighted ? "" : undefined}
          data-more={item.more ? "" : undefined}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}

export type NewTabPick =
  | "document"
  | "terminal"
  | "agent-lophn"
  | "agent-project-manager"
  | `agent-operator:${string}`
  | `context:${string}`
  | "search";

/**
 * 탭 줄 끝의 + 메뉴. Agent 탭(lophn, Project Manager, Operator ›)과 Context ›는 같은 메뉴가 다음 단계로 바뀐다.
 * Agents(관리 탭) 항목과 New context 항목은 없다. 실제 Menu(Radix DropdownMenu)라 한 번에 한 단계만 보여
 * 같은 위치에서 단계를 바꾸는 look-alike다.
 */
export function TabMenu({ onPick }: { onPick: (pick: NewTabPick) => void }) {
  const [open, setOpen] = useState(false);
  const [level, setLevel] = useState<"root" | "context" | "operator">("root");
  const stay = useRef(false);
  const items = level === "root"
    ? [
      { id: "document", label: "Document" },
      { id: "terminal", label: "Terminal" },
      { id: "agent-lophn", label: "Agent · lophn" },
      { id: "agent-project-manager", label: "Agent · Project Manager" },
      { id: "operator", label: "Agent · Operator ›" },
      { id: "context", label: "Context ›" },
      { id: "search", label: "Search" },
    ]
    : level === "context"
    ? [
      { id: "context:eval", label: "Context · eval" },
      { id: "context:harness", label: "Context · harness" },
    ]
    : OPERATORS.map((agent) => ({
      id: `agent-operator:${agent.id}`,
      label: agent.name,
    }));
  return (
    <Menu
      open={open}
      onOpenChange={(next) => {
        // 다음 단계로 가는 항목을 고르면 Radix가 닫으려 하지만 같은 메뉴를 이어 연다.
        if (!next && stay.current) {
          stay.current = false;
          return;
        }
        if (next) setLevel("root");
        setOpen(next);
      }}
      trigger={
        <IconButton icon={lophnSpaceIcons.add} label="New tab" size="sm" />
      }
      items={items}
      onSelect={(id) => {
        if (id === "context" || id === "operator") {
          stay.current = true;
          setLevel(id);
          return;
        }
        onPick(id as NewTabPick);
      }}
    />
  );
}
