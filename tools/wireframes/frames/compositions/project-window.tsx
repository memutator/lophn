// 새 설계 page들이 같이 쓰는 project 화면 틀. 실제 TopBar·Breadcrumbs·LauncherButton과 design
// component를 그대로 쓰고, 실제 sidebar·tab strip·menu는 source 없이 그릴 수 없거나 새 설계의
// 항목(Saved views, Context·Search·Conversation 탭 종류)이 없어서 같은 CSS Module로 같은 모양의
// 마크업을 다시 짠 look-alike다. 앱 코드는 고치지 않는다.
import type { ReactNode } from "react";
import {
  conversationIcons,
  Icon,
  IconButton,
  iconPixels,
  type IconProps,
  lophnSpaceIcons,
  paletteIcons,
  Tree,
  type TreeNode,
  workspaceIcons,
} from "@lophn/design/components";

import { TopBar } from "../../../../apps/shell/renderer/desktop/top-bar/top-bar.tsx";
import { Breadcrumbs } from "../../../../apps/shell/renderer/workspace/top-path/breadcrumbs.tsx";
import { LauncherButton } from "../../../../apps/shell/renderer/workspace/launcher-button.tsx";
import { TAB_MIN } from "../../../../apps/shell/renderer/workspace/model.ts";
import tabStyles from "../../../../apps/shell/renderer/workspace/tab-strip/tab-strip.module.css";
import sideStyles from "../../../../apps/shell/renderer/workspace/sidebar/sidebar.module.css";
import menuStyles from "../../../../packages/design/components/menu/menu.module.css";
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
  | "search"
  | "terminal"
  | "conversation";

const KIND_ICON: Record<TabKind, IconProps["icon"]> = {
  document: workspaceIcons.documentEditor,
  context: workspaceIcons.context,
  search: paletteIcons.search,
  terminal: workspaceIcons.terminal,
  conversation: conversationIcons.dock,
};

const KIND_LABEL: Record<TabKind, string> = {
  document: "Document editor",
  context: "Context",
  search: "Search",
  terminal: "Terminal",
  conversation: "Conversation",
};

export interface TabSpec {
  readonly key: string;
  readonly kind: TabKind;
  readonly title: string;
}

/** 탭 줄. 종류는 아이콘과 글자로 구별한다(실제 TabStrip과 같은 마크업·CSS). */
export function TabBar(
  { tabs, selected, focused = true, end }: {
    tabs: readonly TabSpec[];
    selected: string;
    focused?: boolean;
    end?: ReactNode;
  },
) {
  return (
    <div className={tabStyles.bar}>
      <div className={tabStyles.list} role="tablist">
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
            >
              <Icon
                icon={KIND_ICON[tab.kind]}
                pixels={iconPixels("small")}
                className={tabStyles.icon}
              />
              <span className={tabStyles.title}>{tab.title}</span>
              <span className={tabStyles.kind}>{KIND_LABEL[tab.kind]}</span>
              <span className={tabStyles.close}>
                <Icon
                  icon={workspaceIcons.close}
                  pixels={iconPixels("small")}
                />
              </span>
            </div>
          );
        })}
      </div>
      <div className={tabStyles.end}>
        {end}
        <IconButton icon={lophnSpaceIcons.add} label="New tab" size="sm" />
      </div>
    </div>
  );
}

export interface PaneSpec {
  readonly tabs: readonly TabSpec[];
  readonly selected: string;
  readonly focused?: boolean;
  readonly children: ReactNode;
  /** 본문 여백 없이 칸을 스스로 채우는 탭(Search, Conversation). */
  readonly flush?: boolean;
  /** 이 칸 위에 얹는 것(열린 메뉴). */
  readonly overlay?: ReactNode;
}

function Pane({ tabs, selected, focused, children, flush, overlay }: PaneSpec) {
  return (
    <section className={styles.pane}>
      <TabBar tabs={tabs} selected={selected} focused={focused} />
      <div className={`${styles.body} ${flush ? styles.flush : ""}`}>
        {children}
      </div>
      {overlay}
    </section>
  );
}

export const FOLDER_TREE: readonly TreeNode[] = [
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
        id: "eval/scenarios",
        label: "scenarios",
        children: [{ id: "eval/scenarios/x", label: "…" }],
      },
    ],
  },
  {
    id: "loop",
    label: "loop",
    children: [{ id: "loop/findings", label: "findings" }],
  },
];

const OPEN_BRANCHES = new Set(["eval", "eval/experiments"]);

function SidebarRow(
  { icon, label, active = false }: {
    icon: IconProps["icon"];
    label: string;
    active?: boolean;
  },
) {
  return (
    <li className={sideStyles.li}>
      <span className={`${sideStyles.item} ${active ? sideStyles.active : ""}`}>
        <Icon
          icon={icon}
          pixels={iconPixels("base")}
          className={sideStyles.icon}
        />
        <span className={sideStyles.label}>{label}</span>
      </span>
    </li>
  );
}

export interface SidebarSpec {
  /** 고른 문서 행(트리 id). */
  readonly current?: string;
  /** 오른쪽 클릭 메뉴가 열린 행. 다중 선택 배경으로 보인다. */
  readonly menuFor?: string;
  /** 트리 아래에 얹는 메뉴. */
  readonly menu?: ReactNode;
  readonly savedActive?: string;
}

/** project sidebar: Folders(tree), Contexts, Saved views. */
export function ProjectSidebar(
  { current, menuFor, menu, savedActive }: SidebarSpec,
) {
  return (
    <nav className={sideStyles.sidebar} style={{ width: "240px" }}>
      <div className={sideStyles.header}>
        <span className={sideStyles.headerContent}>
          <LauncherButton onLauncher={() => {}} />
          <span className={sideStyles.title}>phroner</span>
        </span>
        <IconButton icon={workspaceIcons.sidebar} label="Collapse sidebar" />
      </div>
      <div className={sideStyles.body}>
        <section className={sideStyles.section}>
          <h2 className={sideStyles.sectionLabel}>Folders</h2>
          <div className={styles.treeBox}>
            <Tree
              nodes={FOLDER_TREE}
              expanded={OPEN_BRANCHES}
              onExpandedChange={() => {}}
              currentId={current}
              selectedIds={menuFor === undefined
                ? undefined
                : new Set([menuFor])}
              label="Folders"
            />
            {menu}
          </div>
        </section>
        <section className={sideStyles.section}>
          <h2 className={sideStyles.sectionLabel}>Contexts</h2>
          <ul className={sideStyles.list} role="list">
            <SidebarRow icon={workspaceIcons.context} label="eval" />
            <SidebarRow icon={workspaceIcons.context} label="harness" />
          </ul>
        </section>
        <section className={sideStyles.section}>
          <h2 className={sideStyles.sectionLabel}>Saved views</h2>
          <ul className={sideStyles.list} role="list">
            <SidebarRow
              icon={lophnSpaceIcons.savedView}
              label="Running experiments"
              active={savedActive === "running"}
            />
            <SidebarRow
              icon={lophnSpaceIcons.savedView}
              label="Findings for C-049"
              active={savedActive === "c-049"}
            />
          </ul>
        </section>
      </div>
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

export interface ProjectWindowProps {
  readonly sidebar?: SidebarSpec;
  readonly crumbs: readonly string[];
  readonly left: PaneSpec;
  readonly right?: PaneSpec;
  /** 창 위에 얹는 것(toast). */
  readonly children?: ReactNode;
}

export function ProjectWindow(
  { sidebar = {}, crumbs, left, right, children }: ProjectWindowProps,
) {
  return (
    <div className={styles.window}>
      <ProjectSidebar {...sidebar} />
      <div className={styles.main}>
        <div className={styles.topBar}>
          <TopBar
            platform="linux"
            leading={
              <div className={styles.leading}>
                <Breadcrumbs crumbs={crumbs.map((label) => ({ label }))} />
              </div>
            }
            trailing={
              <IconButton
                icon={paletteIcons.search}
                label="Search documents"
                variant="secondary"
              />
            }
          />
        </div>
        <div className={styles.panes}>
          <Pane {...left} />
          {right === undefined ? null : <Pane {...right} />}
        </div>
      </div>
      {children}
    </div>
  );
}

// 칸 본문 조각

export function DocumentBody() {
  return (
    <article className={styles.reading}>
      <h1>exp-008 · query tools</h1>
      <div className={styles.docMeta}>
        <span>status: running</span>
        <span>about: harness C-049</span>
        <span>scenarios: 6</span>
      </div>
      <h2>## 질문</h2>
      <p>
        Do the query tools stop the agent from trying world actions on read-only
        tasks, without hurting the answers?
      </p>
      <h2>## 기준선</h2>
      <p>
        The C-049 baseline run on the six scenarios, scored with the
        query-hygiene rubric r2. Three of six runs tried a world action before
        the change.
      </p>
    </article>
  );
}

export const CHAT: readonly { who: "You" | "lophn"; text: string }[] = [
  { who: "You", text: "Which findings are about C-049?" },
  {
    who: "lophn",
    text:
      "Three: F-009, F-010 and F-011. F-009 and F-010 are improvements, F-011 is a regression on query-recipe-gap.",
  },
  { who: "You", text: "Open the regression and compare it with exp-008." },
  {
    who: "lophn",
    text:
      "Opened F-011 next to exp-008-query-tools.md. The regression shows up only on scenarios that need a recipe lookup.",
  },
];
