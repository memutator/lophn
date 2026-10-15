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
  type TreeNode,
} from "@lophn/design/components";
import {
  conversationIcons,
  lophnSpaceIcons,
  paletteIcons,
  workspaceIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";

import { LauncherButton } from "../../../../packages/shell/renderer/workspace/launcher-button.tsx";
import sideStyles from "../../../../packages/shell/renderer/workspace/sidebar/sidebar.module.css";
import menuStyles from "../../../../packages/design/components/menu/menu.module.css";
import type { ChatInit, SessionRow } from "./agents-data.ts";
import { AgentsPanel, OPERATORS } from "./project-files/agent-panel.tsx";
import { type FileInit, ROOTS } from "./project-files/file-data.ts";
import {
  FileTree,
  ModeToggle,
  RootPicker,
  type SidebarMode,
} from "./project-files/explorer.tsx";
import {
  openBranchesOf,
  PHRONER_TREE,
  treeOf,
} from "./project-files/file-tree-data.ts";
import { FileIcon } from "../chrome/file-icon.tsx";
import { menuIcon, menuLead } from "./project-files/menu-icons.tsx";
import { TabStrip } from "../chrome/tab-strip.tsx";
import { Avatar } from "./agent-avatar.tsx";
import styles from "./compose.module.css";

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

export interface TabSpec {
  readonly key: string;
  readonly kind: TabKind;
  readonly title: string;
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

// 탭 머리 아이콘: 파일은 tree와 같은 FileIcon, agent는 그 agent의 profile 아이콘, 나머지는 종류 아이콘이다.
function agentNameOf(tab: TabSpec): string {
  return tab.chat?.agent ?? tab.title.split(" · ").pop() ?? tab.title;
}

// 종류 글자를 뺀 대신, 이름이 project 이름뿐인 탭은 종류가 이름이 된다.
function tabTitle(tab: TabSpec): string {
  if (tab.title !== "phroner") return tab.title;
  const named: Partial<Record<TabKind, string>> = {
    search: "Search",
    terminal: "Terminal",
    contexts: "Contexts",
  };
  return named[tab.kind] ?? tab.title;
}

function tabIcon(tab: TabSpec): ReactNode {
  if (tab.kind === "document") {
    return <FileIcon name={tab.sub ?? tab.title} size={14} />;
  }
  if (tab.kind === "agent") {
    return <Avatar agent={agentNameOf(tab)} size="sm" />;
  }
  return <Icon icon={KIND_ICON[tab.kind]} pixels={iconPixels("small")} />;
}

/** 탭 줄. 공용 TabStrip에 project 탭을 맞춰 준다. 누르면 고르고 ×로 닫는다. 종류 글자는 두지 않는다. */
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
  return (
    <TabStrip
      tabs={tabs.map((tab) => ({
        key: tab.key,
        title: tabTitle(tab),
        icon: tabIcon(tab),
        dot: states?.[tab.key],
      }))}
      selected={selected}
      focused={focused}
      onSelect={onSelect}
      onClose={onClose}
      end={newTab ?? (
        <IconButton icon={lophnSpaceIcons.add} label="New tab" size="sm" />
      )}
    />
  );
}

/** 첫 연결 폴더의 파일 tree. */
export const FOLDER_TREE: readonly TreeNode[] = PHRONER_TREE;

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
  /** sidebar 본문을 맨 아래로 scroll한다(Agent 모양에서 Recent가 보이게). */
  readonly scrollToAgents?: boolean;
  /** 처음에 보이는 모양. 없으면 Explorer다. */
  readonly mode?: SidebarMode;
  /** Explorer가 처음에 보이는 루트(연결 폴더 id). 없으면 첫 폴더다. */
  readonly root?: string;
  /** 루트를 고르는 menu를 연 채 시작한다. */
  readonly rootMenu?: boolean;
}

export interface SidebarProps extends SidebarSpec {
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly onRail: (action: RailAction) => void;
  readonly onOpenFile: (id: string) => void;
  readonly onOpenContext: (name: string) => void;
  readonly onAgent: (agent: string) => void;
  readonly onManage: () => void;
  /** session을 누르면 그 session 탭을 연다. */
  readonly onSession?: (row: SessionRow) => void;
  /** saved view 이름을 누르면 그 결과를 연다. 없으면 Saved views 탭 단추와 같다. */
  readonly onSavedView?: (view: string) => void;
}

/**
 * project sidebar. 머리 아래의 segmented toggle이 Explorer · Context · Agent 셋 가운데 하나만 보이게 한다.
 * Explorer는 연결 폴더(루트)를 고르는 menu와 아이콘이 붙은 파일 tree, Context는 contexts와 saved views,
 * Agent는 agent마다 열린 session과 맨 아래의 Recent다. 접으면 바로 가기 rail이 된다:
 * 펼치기 · Terminal · Contexts · Saved views · Agent · Search.
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
    mode: initialMode = "explorer",
    root: initialRoot,
    rootMenu = false,
    onAgent,
    onManage,
    onSession,
    onSavedView,
  }: SidebarProps,
) {
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";
  const body = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<SidebarMode>(initialMode);
  const [root, setRoot] = useState(
    ROOTS.find((item) => item.id === initialRoot) ?? ROOTS[0],
  );
  const [rootOpen, setRootOpen] = useState(rootMenu);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(
    foldersClosed ? new Set() : openBranchesOf(root),
  );
  useLayoutEffect(() => {
    if (scrollToAgents && body.current) {
      body.current.scrollTop = body.current.scrollHeight;
    }
  }, [scrollToAgents, collapsed, mode]);
  const toggleBranch = (id: string) => {
    const next = new Set(expanded);
    if (!next.delete(id)) next.add(id);
    setExpanded(next);
  };
  return (
    <nav
      className={`${sideStyles.sidebar} ${
        collapsed ? sideStyles.collapsed : ""
      }`}
      style={{ width: collapsed ? "56px" : "240px" }}
      data-sidebar={collapsed ? "collapsed" : "open"}
    >
      <div className={`${sideStyles.header} ${styles.sidebarHeader}`}>
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
          <>
            <ModeToggle mode={mode} onMode={setMode} />
            <div ref={body} className={sideStyles.body}>
              {mode === "explorer"
                ? (
                  <section className={sideStyles.section}>
                    <RootPicker
                      root={root}
                      open={rootOpen}
                      onOpenChange={setRootOpen}
                      onRoot={(next) => {
                        setRoot(next);
                        setExpanded(openBranchesOf(next));
                      }}
                    />
                    <div className={styles.treeBox}>
                      <FileTree
                        nodes={treeOf(root)}
                        expanded={expanded}
                        onToggle={toggleBranch}
                        currentId={current}
                        selectedId={menuFor}
                        onOpen={onOpenFile}
                        label={`Files in ${root.label}`}
                      />
                      {menu}
                    </div>
                  </section>
                )
                : null}
              {mode === "context"
                ? (
                  <>
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
                  </>
                )
                : null}
              {mode === "agent"
                ? (
                  <AgentsPanel
                    hoverAgent={hoverAgent}
                    onAgent={onAgent}
                    onManage={onManage}
                    onSession={onSession ?? (() => {})}
                  />
                )
                : null}
            </div>
          </>
        )}
    </nav>
  );
}

/** 오른쪽 클릭·+ 메뉴의 정적 모양. 실제 Menu(Radix)와 같은 CSS Module을 쓴다. */
export function StaticMenu(
  { items, head, width = 200, highlighted }: {
    items: readonly {
      label: string;
      more?: boolean;
      /** 항목 앞 아이콘. */
      icon?: ReactNode;
    }[];
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
          {item.icon}
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
      {
        id: "document",
        label: "Document",
        leading: menuLead(<FileIcon name="notes.md" size={16} />),
      },
      {
        id: "terminal",
        label: "Terminal",
        leading: menuIcon(workspaceIcons.terminal),
      },
      {
        id: "agent-lophn",
        label: "Agent · lophn",
        leading: menuLead(<Avatar agent="lophn" size="sm" />),
      },
      {
        id: "agent-project-manager",
        label: "Agent · Project Manager",
        leading: menuLead(<Avatar agent="Project Manager" size="sm" />),
      },
      {
        id: "operator",
        label: "Agent · Operator ›",
        leading: menuIcon(lophnSpaceIcons.roles),
      },
      {
        id: "context",
        label: "Context ›",
        leading: menuIcon(workspaceIcons.context),
      },
      {
        id: "search",
        label: "Search",
        leading: menuIcon(paletteIcons.search),
      },
    ]
    : level === "context"
    ? [
      {
        id: "context:eval",
        label: "Context · eval",
        leading: menuIcon(workspaceIcons.context),
      },
      {
        id: "context:harness",
        label: "Context · harness",
        leading: menuIcon(workspaceIcons.context),
      },
    ]
    : OPERATORS.map((agent) => ({
      id: `agent-operator:${agent.id}`,
      label: agent.name,
      leading: menuLead(<Avatar agent={agent.name} size="sm" />),
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
