// 동작하는 project 화면. 칸마다 탭 줄이 있고, 바로 가기 rail·sidebar·+ 메뉴·검색·상단 검색·toast·대화·문서의 링크가 탭을 열면
// 탭 줄에 그 탭이 생기고 선택된다(이미 열린 탭이면 그 탭을 고른다). 실제 TopBar·Breadcrumbs·Palette·Menu를 쓰고
// sidebar·tab strip은 project-window.tsx의 look-alike다.
import { type ReactNode, useEffect, useRef, useState } from "react";

import { TopBar } from "../../../../apps/shell/renderer/desktop/top-bar/top-bar.tsx";
import { Breadcrumbs } from "../../../../apps/shell/renderer/workspace/top-path/breadcrumbs.tsx";
import { LauncherButton } from "../../../../apps/shell/renderer/workspace/launcher-button.tsx";
import {
  IconButton,
  Palette,
  paletteIcons,
  type PaletteItem,
  Toast,
  ToastStack,
  workspaceIcons,
} from "@lophn/design/components";

import { ContextsBody, SearchBody, TerminalBody } from "./bodies.tsx";
import { ContextBody, type SubTab } from "./context-body.tsx";
import { Conversation } from "./conversation.tsx";
import { DocActions, DocumentPane, type InfoPanel } from "./documents.tsx";
import { ContextDrafting } from "./context-drafting.tsx";
import {
  contextTab,
  documentTab,
  experimentTab,
  findingTab,
  NEW_CONTEXT_CHAT,
} from "./phroner-data.ts";
import {
  ProjectSidebar,
  type RailAction,
  type SidebarSpec,
  TabBar,
  TabMenu,
  type TabSpec,
} from "./project-window.tsx";
import styles from "./compose.module.css";

export interface PaneInit {
  readonly tabs: readonly TabSpec[];
  readonly selected: string;
}

export interface ProjectAppProps {
  readonly panes: readonly PaneInit[];
  readonly sidebar?: SidebarSpec;
  /** 첫 칸 위에 얹는 것(열린 메뉴). */
  readonly overlay?: ReactNode;
  /** 창 위에 얹는 것(toast). */
  readonly children?: ReactNode;
  /** 계약 위반 toast를 띄운 채 시작한다. [View]는 그 context의 Violations를 연다. */
  readonly violationToast?: boolean;
  /** 이 문서 탭(key)의 info 칸을 이 panel로 연 채 시작한다. */
  readonly info?: { readonly tab: string; readonly panel: InfoPanel };
}

const FLUSH = new Set(["search", "conversation", "terminal", "document"]);

// toast가 화면에 남은 채로 보이도록 시간이 가지 않는 timer를 준다.
const NO_TIMER = { set: () => 0, clear: () => {} };

export const CHAT_TAB: TabSpec = {
  key: "chat",
  kind: "conversation",
  title: "lophn",
};
export const ENGINEER_TAB: TabSpec = {
  key: "chat:engineer",
  kind: "conversation",
  title: "Context Engineer",
  sub: "engineer",
};

function crumbsOf(tab: TabSpec | undefined): string[] {
  if (tab === undefined) return ["phroner"];
  switch (tab.kind) {
    case "document":
      return ["phroner", ...(tab.sub ?? tab.title).split("/")];
    case "context":
      return ["phroner", tab.title, "Context"];
    case "contexts":
      return ["phroner", "Contexts"];
    case "search":
      return ["phroner", "Search"];
    case "terminal":
      return ["phroner", "Terminal"];
    case "conversation":
      return ["phroner", tab.title];
  }
}

// 상단 검색(돋보기·Ctrl+K)의 후보. "eval"을 치면 Contexts 묶음에 eval이 나온다.
const PALETTE: readonly (PaletteItem & { tab: () => TabSpec })[] = [
  {
    id: "context:eval",
    group: "Contexts",
    label: "eval",
    detail: "Context",
    icon: workspaceIcons.context,
    tab: () => contextTab("eval"),
  },
  {
    id: "context:harness",
    group: "Contexts",
    label: "harness",
    detail: "Context",
    icon: workspaceIcons.context,
    tab: () => contextTab("harness"),
  },
  {
    id: "doc:exp-008",
    group: "Documents",
    label: "exp-008-query-tools.md",
    detail: "eval/experiments",
    icon: workspaceIcons.document,
    tab: () => experimentTab("exp-008"),
  },
  {
    id: "doc:F-009",
    group: "Documents",
    label: "F-009.md",
    detail: "loop/findings",
    icon: workspaceIcons.document,
    tab: () => findingTab("F-009"),
  },
  {
    id: "doc:notes",
    group: "Documents",
    label: "notes.md",
    detail: "docs",
    icon: workspaceIcons.document,
    tab: () => documentTab("docs/notes.md"),
  },
];

export function ProjectApp(
  {
    panes: initial,
    sidebar = {},
    overlay,
    children,
    violationToast = false,
    info: initialInfo,
  }: ProjectAppProps,
) {
  const [panes, setPanes] = useState(
    initial.map((pane) => ({ tabs: [...pane.tabs], selected: pane.selected })),
  );
  const [collapsed, setCollapsed] = useState(sidebar.collapsed ?? false);
  const [info, setInfo] = useState<Record<string, InfoPanel>>(
    initialInfo === undefined ? {} : { [initialInfo.tab]: initialInfo.panel },
  );
  const [editing, setEditing] = useState<ReadonlySet<string>>(new Set());
  const [answer, setAnswer] = useState<string | null>(null);
  const [toast, setToast] = useState(violationToast);
  const [palette, setPalette] = useState(false);
  const terminals = useRef(1);

  useEffect(() => {
    const listen = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((current) => !current);
      }
    };
    addEventListener("keydown", listen);
    return () => removeEventListener("keydown", listen);
  }, []);

  // 이미 열린 탭이면 그 칸에서 고르고(Context 탭은 다른 하위 탭을 달라면 그 하위 탭으로), 아니면 첫 칸 끝에 더해
  // 고른다. `other`면 둘째 칸에 연다(없으면 칸을 하나 더 만든다).
  const open = (tab: TabSpec, other = false) =>
    setPanes((current) => {
      const at = current.findIndex((pane) =>
        pane.tabs.some((item) => item.key === tab.key)
      );
      if (at !== -1) {
        return current.map((pane, index) =>
          index !== at ? pane : {
            tabs: pane.tabs.map((item) =>
              item.key === tab.key && tab.sub !== undefined &&
                item.kind === "context"
                ? { ...item, sub: tab.sub, rev: (item.rev ?? 0) + 1 }
                : item
            ),
            selected: tab.key,
          }
        );
      }
      const target = other ? 1 : 0;
      const base = current.length > target
        ? current
        : [...current, { tabs: [], selected: "" }];
      return base.map((pane, index) =>
        index !== target
          ? pane
          : { tabs: [...pane.tabs, tab], selected: tab.key }
      );
    });

  const close = (key: string) =>
    setPanes((current) =>
      current.map((pane) => {
        const index = pane.tabs.findIndex((tab) => tab.key === key);
        if (index === -1) return pane;
        const tabs = pane.tabs.filter((tab) => tab.key !== key);
        const selected = pane.selected !== key
          ? pane.selected
          : (tabs[index] ?? tabs[index - 1])?.key ?? "";
        return { tabs, selected };
      })
    );

  const newTerminal = () => {
    terminals.current += 1;
    open({
      key: `terminal:${terminals.current}`,
      kind: "terminal",
      title: "phroner",
    });
  };
  const searchTab: TabSpec = {
    key: "search",
    kind: "search",
    title: "phroner",
  };

  const rail = (action: RailAction) => {
    if (action === "terminal") newTerminal();
    else if (action === "search" || action === "saved") open(searchTab);
    else if (action === "contexts") {
      open({ key: "contexts", kind: "contexts", title: "phroner" });
    } else open(CHAT_TAB);
  };

  const pick = (choice: string) => {
    if (choice === "document") open(documentTab("docs/notes.md"));
    else if (choice === "terminal") newTerminal();
    else if (choice === "chat-lophn") open(CHAT_TAB);
    else if (choice === "chat-engineer") open(ENGINEER_TAB);
    else if (choice === "search") open(searchTab);
    else if (choice === "new-context") open(NEW_CONTEXT_CHAT, true);
    else if (choice.startsWith("context:")) {
      open(contextTab(choice.slice("context:".length)));
    }
  };

  const body = (tab: TabSpec): ReactNode => {
    switch (tab.kind) {
      case "document":
        return (
          <DocumentPane
            path={tab.sub ?? tab.title}
            open={open}
            info={info[tab.key] ?? null}
            onInfo={(panel) => setInfo({ ...info, [tab.key]: panel })}
            editing={editing.has(tab.key)}
          />
        );
      case "context":
        return tab.draft === undefined
          ? (
            <ContextBody
              key={tab.rev ?? 0}
              name={tab.title}
              initial={(tab.sub as SubTab | undefined) ?? "overview"}
              open={open}
            />
          )
          : <ContextDrafting name={tab.title} draft={tab.draft} />;
      case "contexts":
        return <ContextsBody open={open} />;
      case "search":
        return (
          <SearchBody
            initial={tab.sub === "experiments" ? "experiments" : "findings"}
            typed={tab.sub === "typed"}
            open={open}
          />
        );
      case "terminal":
        return <TerminalBody />;
      case "conversation":
        return (
          <Conversation
            who={tab.sub?.startsWith("engineer") ? "Context Engineer" : "lophn"}
            fresh={tab.sub === "engineer-new"}
            open={open}
            answer={answer}
            onAnswer={setAnswer}
          />
        );
    }
  };

  const focusTab = panes[0]?.tabs.find((tab) => tab.key === panes[0].selected);
  const crumbs = crumbsOf(focusTab);
  const items: readonly PaletteItem[] = PALETTE;
  return (
    <div className={styles.window}>
      <ProjectSidebar
        {...sidebar}
        collapsed={collapsed}
        onToggle={() => setCollapsed(!collapsed)}
        onRail={rail}
        onOpenFile={(id) => open(documentTab(id))}
        onOpenContext={(name) => open(contextTab(name))}
      />
      <div className={styles.main}>
        <div className={styles.topBar}>
          <TopBar
            platform="linux"
            leading={
              <div className={styles.leading}>
                {collapsed ? <LauncherButton onLauncher={() => {}} /> : null}
                <Breadcrumbs crumbs={crumbs.map((label) => ({ label }))} />
              </div>
            }
            trailing={
              <IconButton
                icon={paletteIcons.search}
                label="Search documents"
                variant="secondary"
                onClick={() => setPalette(true)}
              />
            }
          />
        </div>
        <div className={styles.panes}>
          {panes.map((pane, index) => {
            const selected = pane.tabs.find((tab) => tab.key === pane.selected);
            return (
              <section key={index} className={styles.pane}>
                <TabBar
                  tabs={pane.tabs}
                  selected={pane.selected}
                  focused={index === 0}
                  actions={selected?.kind === "document"
                    ? (
                      <DocActions
                        editing={editing.has(selected.key)}
                        infoOpen={info[selected.key] !== undefined}
                        onEditing={() => {
                          const next = new Set(editing);
                          if (!next.delete(selected.key)) {
                            next.add(selected.key);
                          }
                          setEditing(next);
                        }}
                        onInfo={() => {
                          const next = { ...info };
                          if (next[selected.key] === undefined) {
                            next[selected.key] = "info";
                          } else delete next[selected.key];
                          setInfo(next);
                        }}
                      />
                    )
                    : undefined}
                  newTab={<TabMenu onPick={pick} />}
                  onSelect={(key) =>
                    setPanes((current) =>
                      current.map((item, at) =>
                        at === index ? { ...item, selected: key } : item
                      )
                    )}
                  onClose={close}
                />
                {pane.tabs.map((tab) => (
                  <div
                    key={tab.key}
                    hidden={tab.key !== pane.selected}
                    className={`${styles.body} ${
                      FLUSH.has(tab.kind) ? styles.flush : ""
                    }`}
                  >
                    {body(tab)}
                  </div>
                ))}
                {index === 0 ? overlay : null}
              </section>
            );
          })}
        </div>
      </div>
      {children}
      {toast
        ? (
          <ToastStack>
            <Toast
              title="eval: 2 documents don't match the contract"
              actions={[{ id: "view", label: "View" }]}
              onAction={() => {
                open(contextTab("eval", "violations"));
                setToast(false);
              }}
              onClose={() => setToast(false)}
              timer={NO_TIMER}
            />
          </ToastStack>
        )
        : null}
      <Palette
        open={palette}
        onOpenChange={setPalette}
        title="Command palette"
        items={items}
        onSelect={(id) => {
          const chosen = PALETTE.find((item) => item.id === id);
          if (chosen) open(chosen.tab());
          setPalette(false);
        }}
      />
    </div>
  );
}
