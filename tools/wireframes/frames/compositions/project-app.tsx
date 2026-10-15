// 동작하는 project 화면. 칸마다 탭 줄이 있고, 바로 가기 rail·sidebar·+ 메뉴·검색·상단 검색·toast·대화·문서의 링크가 탭을 열면
// 탭 줄에 그 탭이 생기고 선택된다(이미 열린 탭이면 그 탭을 고른다). 실제 TopBar·Breadcrumbs·Palette·Menu를 쓰고
// sidebar·tab strip은 project-window.tsx의 look-alike다.
import { type ReactNode, useEffect, useRef, useState } from "react";

import { PaletteButton, WireTopBar } from "../chrome/title-bar.tsx";
import { Breadcrumbs } from "../../../../packages/shell/renderer/workspace/top-path/breadcrumbs.tsx";
import { LauncherButton } from "../../../../packages/shell/renderer/workspace/launcher-button.tsx";
import { Palette, type PaletteItem } from "@lophn/design/components";
import {
  workspaceIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";

import { AgentsBody, OperatorEditor } from "./agents-tab.tsx";
import {
  AGENTS_TAB,
  newConversationTab,
  type SessionRow,
  sessionTab,
} from "./agents-data.ts";
import { TerminalBody } from "./bodies.tsx";
import { ContextBody, type SubTab } from "./context-body.tsx";
import { Conversation, type TabState } from "./conversation.tsx";
import { FAVORITE_START, FavoritesContext } from "./model-picker.tsx";
import { DocumentPane, type InfoPanel } from "./documents.tsx";
import { contextTab, documentTab } from "./phroner-data.ts";
import { ContextsList } from "./contexts/contexts-list.tsx";
import { DeclaredSearch } from "./contexts/declared-search.tsx";
import { HostProvider } from "./contexts/open-tab.ts";
import { FileSearch } from "./project-files/file-search.tsx";
import { crumbsOfPath, fileKey, isOutside } from "./project-files/file-data.ts";
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
  /** 창 위쪽 바 오른쪽, 명령 palette 단추 앞에 놓는 것(대기 개수 pill 등). */
  readonly titleExtra?: ReactNode;
  /** 이 문서 탭(key)의 info 칸을 이 panel로 연 채 시작한다. */
  readonly info?: { readonly tab: string; readonly panel: InfoPanel };
}

const FLUSH = new Set(["search", "agent", "terminal", "document"]);

export const CHAT_TAB: TabSpec = {
  key: "chat",
  kind: "agent",
  title: "lophn",
};
export const ENGINEER_TAB: TabSpec = {
  key: "chat:engineer",
  kind: "agent",
  title: "Project Manager",
  sub: "engineer",
};

function crumbsOf(tab: TabSpec | undefined): string[] {
  if (tab === undefined) return ["phroner"];
  switch (tab.kind) {
    case "document":
      return crumbsOfPath(tab.sub ?? tab.title);
    case "context":
      return ["phroner", tab.title, "Context"];
    case "contexts":
      return ["phroner", "Contexts"];
    case "search":
      return ["phroner", tab.sub === "files" ? "Search files" : "Search"];
    case "terminal":
      return ["phroner", "Terminal"];
    case "agent":
      return ["phroner", tab.title];
    case "agents":
      return ["phroner", "Agents"];
    case "operator":
      return ["phroner", "Agents", tab.title];
  }
}

// 상단 검색(돋보기·Ctrl+K)의 후보. "eval"을 치면 Contexts 묶음에 eval이 나오고, 파일은 경로로 연다.
const FILE_ITEM = (path: string): PaletteItem & { tab: () => TabSpec } => ({
  id: `file:${path}`,
  group: "Files",
  label: path.split("/").pop() ?? path,
  detail: path.split("/").slice(0, -1).join("/"),
  icon: workspaceIcons.document,
  tab: () => documentTab(path),
});

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
  FILE_ITEM("eval/experiments/exp-008-query-tools.md"),
  FILE_ITEM("eval/rubrics/query-hygiene.json"),
  FILE_ITEM("eval/scenarios/query-leave-still/r1.yaml"),
  FILE_ITEM("loop/findings/F-009.md"),
  FILE_ITEM("docs/notes.md"),
  FILE_ITEM("assets/chest-layout.png"),
  FILE_ITEM("LOPHN.md"),
];

/** OS 파일 dialog 대신 열리는 project 밖 파일. */
const DIALOG_FILE = "/home/mina/Downloads/api-spec.yaml";

const BROWSE: PaletteItem = {
  id: "browse",
  group: "Open",
  label: "Open file…",
  detail: "Any file on this computer",
  hint: "Ctrl+O",
  icon: workspaceIcons.document,
};

const pathLike = (text: string) => /^(\/|~\/)/.test(text.trim());

function paletteItems(query: string): readonly PaletteItem[] {
  if (pathLike(query)) {
    const path = fileKey(query);
    return [{
      id: `path:${path}`,
      group: "Open",
      label: query.trim(),
      detail: isOutside(path) ? "Outside project" : "In project",
      icon: workspaceIcons.document,
    }];
  }
  const words = query.trim().toLowerCase();
  const found = PALETTE.filter((item) =>
    words === "" || item.label.toLowerCase().includes(words) ||
    (item.detail ?? "").toLowerCase().includes(words)
  );
  return words === "" ? [BROWSE, ...found] : found;
}

export function ProjectApp(
  {
    panes: initial,
    sidebar = {},
    overlay,
    children,
    titleExtra,
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
  const [editing, setEditing] = useState<ReadonlySet<string>>(
    new Set(
      initial.flatMap((pane) =>
        pane.tabs.filter((tab) => tab.file?.editing).map((tab) => tab.key)
      ),
    ),
  );
  const [answer, setAnswer] = useState<string | null>(null);
  const [favorites, setFavorites] = useState<readonly string[]>(FAVORITE_START);
  const [tabStates, setTabStates] = useState<
    Readonly<Record<string, TabState>>
  >({});
  const [palette, setPalette] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
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

  // 이미 열린 탭이면 그 칸에서 고르고(Context 탭은 다른 하위 탭을, 문서 탭은 다른 줄을 달라면 그쪽으로), 아니면 첫 칸 끝에 더해
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
                : item.key === tab.key && tab.file?.line !== undefined
                ? { ...item, file: tab.file, rev: (item.rev ?? 0) + 1 }
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

  // 같은 탭 안에서 session을 바꾼다(탭 key는 그대로, agent는 그대로). row가 없으면 새 session이다.
  const swapSession = (key: string, agent: string, row?: SessionRow) =>
    setPanes((current) =>
      current.map((pane) => ({
        ...pane,
        tabs: pane.tabs.map((tab) =>
          tab.key !== key ? tab : row === undefined
            ? {
              ...tab,
              title: `New session · ${agent}`,
              sub: "new",
              chat: { agent },
            }
            : {
              ...tab,
              title: `${row.title} · ${row.agent}`,
              sub: row.sub ?? `conv:${row.id}`,
              chat: row.id === "weekly"
                ? { stage: "question" as const }
                : undefined,
            }
        ),
      }))
    );

  const newTerminal = () => {
    terminals.current += 1;
    open({
      key: `terminal:${terminals.current}`,
      kind: "terminal",
      title: "phroner",
    });
  };
  // 선언된 검색(saved view의 결과)과 project 키워드 검색은 서로 다른 탭이다. 키워드 검색은 context 없이 열린다.
  const searchTab: TabSpec = {
    key: "search",
    kind: "search",
    title: "phroner",
  };
  const filesTab: TabSpec = {
    key: "search:files",
    kind: "search",
    title: "phroner",
    sub: "files",
  };
  const savedViewTab = (view: string): TabSpec => ({
    key: `search:saved:${view}`,
    kind: "search",
    title: view === "running" ? "Running experiments" : "Findings for C-049",
    sub: view === "running" ? "experiments" : undefined,
  });

  const rail = (action: RailAction) => {
    if (action === "terminal") newTerminal();
    else if (action === "search") open(filesTab);
    else if (action === "saved") open(searchTab);
    else if (action === "contexts") {
      open({ key: "contexts", kind: "contexts", title: "phroner" });
    } else open(newConversationTab("lophn"));
  };

  const pick = (choice: string) => {
    if (choice === "document") open(documentTab("docs/notes.md"));
    else if (choice === "terminal") newTerminal();
    else if (choice === "agent-lophn") open(CHAT_TAB);
    else if (choice === "agent-project-manager") open(ENGINEER_TAB);
    else if (choice.startsWith("agent-operator:")) {
      open(newConversationTab(choice.slice("agent-operator:".length)));
    } else if (choice === "search") open(filesTab);
    else if (choice.startsWith("context:")) {
      open(contextTab(choice.slice("context:".length)));
    }
  };

  const body = (tab: TabSpec): ReactNode => {
    if (tab.body !== undefined) return tab.body;
    switch (tab.kind) {
      case "document":
        return (
          <DocumentPane
            key={tab.rev ?? 0}
            path={tab.sub ?? tab.title}
            file={tab.file}
            open={open}
            info={info[tab.key] ?? null}
            onInfo={(panel) => setInfo({ ...info, [tab.key]: panel })}
            onToggleInfo={() => {
              const next = { ...info };
              if (next[tab.key] === undefined) next[tab.key] = "info";
              else delete next[tab.key];
              setInfo(next);
            }}
            editing={editing.has(tab.key)}
            onEditing={() => {
              const next = new Set(editing);
              if (!next.delete(tab.key)) next.add(tab.key);
              setEditing(next);
            }}
          />
        );
      case "context":
        return (
          <ContextBody
            key={tab.rev ?? 0}
            name={tab.title}
            initial={(tab.sub as SubTab | undefined) ?? "overview"}
            open={open}
          />
        );
      case "contexts":
        return (
          <HostProvider value={{ open, opened: 0 }}>
            <ContextsList />
          </HostProvider>
        );
      case "search":
        if (tab.sub === "files") {
          return (
            <FileSearch
              open={open}
              initialQuery={tab.find?.query}
              initialFolder={tab.find?.folder}
              opened={tab.find?.opened}
            />
          );
        }
        return (
          <HostProvider value={{ open, opened: 0 }}>
            <DeclaredSearch
              initial={tab.sub === "experiments" ? "experiments" : "findings"}
              typed={tab.sub === "typed"}
            />
          </HostProvider>
        );
      case "terminal":
        return <TerminalBody />;
      case "agent":
        return (
          <Conversation
            key={tab.sub}
            tab={tab}
            open={open}
            answer={answer}
            onAnswer={setAnswer}
            handlers={{
              onSession: (row) => swapSession(tab.key, row.agent, row),
              onNewSession: (agent) => swapSession(tab.key, agent),
              onState: (state) =>
                setTabStates((now) =>
                  now[tab.key] === state ? now : { ...now, [tab.key]: state }
                ),
            }}
          />
        );
      case "agents":
        return <AgentsBody open={open} />;
      case "operator":
        return (
          <OperatorEditor
            id={tab.sub ?? "new"}
            onDone={() => close(tab.key)}
          />
        );
    }
  };

  const focusTab = panes[0]?.tabs.find((tab) => tab.key === panes[0].selected);
  const crumbs = crumbsOf(focusTab);
  const items = paletteItems(paletteQuery);
  return (
    <FavoritesContext.Provider
      value={{
        names: favorites,
        toggle: (name) =>
          setFavorites((now) =>
            now.includes(name)
              ? now.filter((item) => item !== name)
              : [...now, name]
          ),
      }}
    >
      <div className={styles.window}>
        <ProjectSidebar
          {...sidebar}
          collapsed={collapsed}
          onToggle={() => setCollapsed(!collapsed)}
          onRail={rail}
          onOpenFile={(id) => open(documentTab(id))}
          onOpenContext={(name) => open(contextTab(name))}
          onAgent={(id) => open(newConversationTab(id))}
          onManage={() => open(AGENTS_TAB)}
          onSession={(row) => open(sessionTab(row))}
          onSavedView={(view) => open(savedViewTab(view))}
        />
        <div className={styles.main}>
          <div className={styles.topBar}>
            <WireTopBar
              leading={
                <div className={styles.leading}>
                  {collapsed ? <LauncherButton onLauncher={() => {}} /> : null}
                  <Breadcrumbs crumbs={crumbs.map((label) => ({ label }))} />
                </div>
              }
              trailing={
                <div className={styles.titleEnd}>
                  {titleExtra}
                  <PaletteButton onClick={() => setPalette(true)} />
                </div>
              }
            />
          </div>
          <div className={styles.panes}>
            {panes.map((pane, index) => {
              return (
                <section key={index} className={styles.pane}>
                  <TabBar
                    tabs={pane.tabs}
                    selected={pane.selected}
                    focused={index === 0}
                    states={tabStates}
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
        <Palette
          open={palette}
          onOpenChange={(next) => {
            setPalette(next);
            if (!next) setPaletteQuery("");
          }}
          title="Command palette"
          items={items}
          onQueryChange={setPaletteQuery}
          onSelect={(id) => {
            const chosen = PALETTE.find((item) => item.id === id);
            if (chosen) open(chosen.tab());
            else if (id === "browse") open(documentTab(DIALOG_FILE));
            else if (id.startsWith("path:")) {
              open(documentTab(id.slice("path:".length)));
            }
            setPalette(false);
            setPaletteQuery("");
          }}
        />
      </div>
    </FavoritesContext.Provider>
  );
}
