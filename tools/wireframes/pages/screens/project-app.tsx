// 동작하는 project 화면. 칸마다 탭 줄이 있고, activity bar 바로 가기·sidebar·+ 메뉴·검색·상단 검색·toast·대화·문서의 링크가 탭을 열면
// 탭 줄에 그 탭이 생기고 선택된다(이미 열린 탭이면 그 탭을 고른다). 실제 TopBar·PlaceSwitcher·Palette·Menu와
// 실제 sidebar(`ProjectSidebar`)·design `TabStrip`·`NewTabMenu`를 쓴다(고정 data는 project-window.tsx가 넘긴다).
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import {
  PaletteButton,
  TopBar,
} from "../../../../packages/shell/renderer/desktop/top-bar/top-bar.tsx";
import { PlaceSwitcher } from "../../../../packages/shell/renderer/workspace/top-path/place-selector.tsx";
import { LauncherButton } from "../../../../packages/shell/renderer/workspace/launcher-button.tsx";
import { TabStrip } from "../../../../packages/shell/renderer/parts/tab-strip/tab-strip.tsx";
import { Palette, type PaletteItem } from "@lophn/ui/overlay";
import { workspaceIcons } from "../../../../packages/shell/renderer/icons/mod.ts";

import { AgentSettingsEditor, AgentsBody } from "./agents-tab.tsx";
import {
  AGENTS_TAB,
  newConversationTab,
  type SessionRow,
  sessionTab,
} from "../../mock/agents-data.ts";
import { TerminalBody } from "./bodies.tsx";
import { Conversation, type TabState } from "./conversation.tsx";
import { fakeAgents } from "../../../../packages/shell/renderer/desktop/settings/agents/testdata/fake-agents.ts";
import type { FakeAgentsOptions as FakeEditorOptions } from "../../../../packages/shell/renderer/workspace/agents/fake-source.ts";
import { GalleryConnectHost } from "../../mock/connect-host.tsx";
import { DocumentPane, type InfoPanel } from "./documents.tsx";
import { documentTab } from "../../mock/phroner-data.ts";
import { FileSearch } from "./project-files/file-search.tsx";
import { fileKey, isOutside } from "../../mock/project-files/file-data.ts";
import {
  PageNewTabMenu,
  PageSidebar,
  type RailAction,
  type SidebarSpec,
  stripTabsOf,
  type TabSpec,
} from "./project-window.tsx";
import workspace from "../../../../packages/shell/renderer/workspace/workspace.module.css";
import paneStyles from "../../../../packages/shell/renderer/workspace/panes/panes.module.css";
import { PaddedTab } from "../../../../packages/shell/renderer/workspace/panes/padded-tab.tsx";

export interface PaneInit {
  readonly tabs: readonly TabSpec[];
  readonly selected: string;
}

export interface ProjectAppProps {
  readonly panes: readonly PaneInit[];
  readonly sidebar?: SidebarSpec;
  /** 첫 칸 위에 얹는 것(열린 메뉴). */
  readonly overlay?: ReactNode;
  /** 첫 칸 탭 줄 끝의 + 메뉴를 연 채 시작한다. */
  readonly newTabOpen?: boolean;
  /** 창 위에 얹는 것(toast). */
  readonly children?: ReactNode;
  /** 창 위쪽 바 오른쪽, 명령 palette 단추 앞에 놓는 것(대기 개수 pill 등). */
  readonly titleExtra?: ReactNode;
  /** 이 문서 탭(key)의 info 칸을 이 panel로 연 채 시작한다. */
  readonly info?: { readonly tab: string; readonly panel: InfoPanel };
  /** Manage models 창이 읽는 provider와 model의 상태. 안 쓰면 기본 fake다. */
  readonly models?: FakeEditorOptions;
}

const FLUSH = new Set([
  "search",
  "agent",
  "terminal",
  "document",
  "agents",
  "agent-settings",
]);

export const CHAT_TAB: TabSpec = {
  key: "chat",
  kind: "agent",
  title: "lophn",
};
// 상단 바 왼쪽 경로의 project 조각. 이 page는 project 하나뿐이다.
const PROJECT_OPTIONS = [{ id: "phroner", label: "phroner" }];

// 상단 검색(돋보기·Ctrl+K)의 후보. 파일은 이름이나 경로로 연다.
const FILE_ITEM = (path: string): PaletteItem & { tab: () => TabSpec } => ({
  id: `file:${path}`,
  group: "Files",
  label: path.split("/").pop() ?? path,
  detail: path.split("/").slice(0, -1).join("/"),
  icon: workspaceIcons.document,
  tab: () => documentTab(path),
});

const PALETTE: readonly (PaletteItem & { tab: () => TabSpec })[] = [
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
    return [
      {
        id: `path:${path}`,
        group: "Open",
        label: query.trim(),
        detail: isOutside(path) ? "Outside project" : "In project",
        icon: workspaceIcons.document,
      },
    ];
  }
  const words = query.trim().toLowerCase();
  const found = PALETTE.filter(
    (item) =>
      words === "" ||
      item.label.toLowerCase().includes(words) ||
      (item.detail ?? "").toLowerCase().includes(words),
  );
  return words === "" ? [BROWSE, ...found] : found;
}

export function ProjectApp({
  panes: initial,
  sidebar = {},
  overlay,
  newTabOpen = false,
  children,
  titleExtra,
  info: initialInfo,
  models,
}: ProjectAppProps) {
  const agents = useMemo(
    () =>
      models === undefined ? undefined : fakeAgents({ editor: models }).source,
    [],
  );
  const [panes, setPanes] = useState(
    initial.map((pane) => ({ tabs: [...pane.tabs], selected: pane.selected })),
  );
  const [collapsed, setCollapsed] = useState(sidebar.collapsed ?? false);
  const [info, setInfo] = useState<Record<string, InfoPanel>>(
    initialInfo === undefined ? {} : { [initialInfo.tab]: initialInfo.panel },
  );
  const [answer, setAnswer] = useState<string | null>(null);
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

  // 이미 열린 탭이면 그 칸에서 고르고(문서 탭은 다른 줄을 달라면 그쪽으로), 아니면 첫 칸 끝에 더해
  // 고른다. `other`면 둘째 칸에 연다(없으면 칸을 하나 더 만든다).
  const open = (tab: TabSpec, other = false) =>
    setPanes((current) => {
      const at = current.findIndex((pane) =>
        pane.tabs.some((item) => item.key === tab.key),
      );
      if (at !== -1) {
        return current.map((pane, index) =>
          index !== at
            ? pane
            : {
                tabs: pane.tabs.map((item) =>
                  item.key === tab.key && tab.file?.line !== undefined
                    ? { ...item, file: tab.file, rev: (item.rev ?? 0) + 1 }
                    : item,
                ),
                selected: tab.key,
              },
        );
      }
      const target = other ? 1 : 0;
      const base =
        current.length > target
          ? current
          : [...current, { tabs: [], selected: "" }];
      return base.map((pane, index) =>
        index !== target
          ? pane
          : { tabs: [...pane.tabs, tab], selected: tab.key },
      );
    });

  const close = (key: string) =>
    setPanes((current) =>
      current.map((pane) => {
        const index = pane.tabs.findIndex((tab) => tab.key === key);
        if (index === -1) return pane;
        const tabs = pane.tabs.filter((tab) => tab.key !== key);
        const selected =
          pane.selected !== key
            ? pane.selected
            : ((tabs[index] ?? tabs[index - 1])?.key ?? "");
        return { tabs, selected };
      }),
    );

  // 같은 탭 안에서 session을 바꾼다(탭 key는 그대로, agent는 그대로). row가 없으면 새 session이다.
  const swapSession = (key: string, agent: string, row?: SessionRow) =>
    setPanes((current) =>
      current.map((pane) => ({
        ...pane,
        tabs: pane.tabs.map((tab) =>
          tab.key !== key
            ? tab
            : row === undefined
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
                  chat:
                    row.id === "weekly"
                      ? { stage: "question" as const }
                      : undefined,
                },
        ),
      })),
    );

  const newTerminal = () => {
    terminals.current += 1;
    open({
      key: `terminal:${terminals.current}`,
      kind: "terminal",
      title: "phroner",
    });
  };
  // project 키워드 검색 탭.
  const filesTab: TabSpec = {
    key: "search:files",
    kind: "search",
    title: "phroner",
    sub: "files",
  };
  const rail = (action: RailAction) => {
    if (action === "terminal") newTerminal();
    else if (action === "search") open(filesTab);
    else if (action === "agent") open(newConversationTab("lophn"));
  };

  const pick = (choice: string) => {
    if (choice === "document") open(documentTab("docs/notes.md"));
    else if (choice === "terminal") newTerminal();
    else if (choice === "agent-lophn") open(CHAT_TAB);
    else if (choice.startsWith("agent:")) {
      open(newConversationTab(choice.slice("agent:".length)));
    } else if (choice === "search") open(filesTab);
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
            info={info[tab.key] ?? null}
            onInfo={(panel) => setInfo({ ...info, [tab.key]: panel })}
            onToggleInfo={() => {
              const next = { ...info };
              if (next[tab.key] === undefined) next[tab.key] = "info";
              else delete next[tab.key];
              setInfo(next);
            }}
          />
        );
      case "search":
        return (
          <FileSearch
            open={open}
            initialQuery={tab.find?.query}
            initialFolder={tab.find?.folder}
            opened={tab.find?.opened}
          />
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
                  now[tab.key] === state ? now : { ...now, [tab.key]: state },
                ),
            }}
          />
        );
      case "agents":
        return (
          <PaddedTab bare>
            <AgentsBody open={open} />
          </PaddedTab>
        );
      case "agent-settings":
        return (
          <PaddedTab bare>
            <AgentSettingsEditor
              id={tab.sub ?? "new"}
              onDone={() => close(tab.key)}
            />
          </PaddedTab>
        );
    }
  };

  const items = paletteItems(paletteQuery);
  return (
    <GalleryConnectHost agents={agents}>
      <div className={workspace.workspace}>
        <div className={workspace.topBar}>
          <TopBar
            platform="linux"
            leading={
              <div className={workspace.leading}>
                <LauncherButton onLauncher={() => {}} />
                <PlaceSwitcher
                  active={{ kind: "project", id: "phroner" }}
                  projects={PROJECT_OPTIONS}
                  apps={[]}
                  onSelect={() => {}}
                />
              </div>
            }
            trailing={
              <div className={workspace.trailing}>
                {titleExtra}
                <PaletteButton onClick={() => setPalette(true)} />
              </div>
            }
          />
        </div>
        <div className={workspace.main}>
          <PageSidebar
            {...sidebar}
            collapsed={collapsed}
            onToggle={() => setCollapsed(!collapsed)}
            onRail={rail}
            onOpenFile={(id) => open(documentTab(id))}
            onAgent={(id) => open(newConversationTab(id))}
            onManage={() => open(AGENTS_TAB)}
            onSession={(row) => open(sessionTab(row))}
          />
          <div className={paneStyles.panes} style={{ display: "flex" }}>
            {panes.map((pane, index) => {
              return (
                <section
                  key={index}
                  className={paneStyles.pane}
                  style={{ position: "relative", flex: "1 1 0" }}
                >
                  <TabStrip
                    tabs={stripTabsOf(pane.tabs, tabStates)}
                    selected={pane.selected}
                    focused={index === 0}
                    end={
                      <PageNewTabMenu
                        onPick={pick}
                        startOpen={newTabOpen && index === 0}
                      />
                    }
                    onSelect={(key) =>
                      setPanes((current) =>
                        current.map((item, at) =>
                          at === index ? { ...item, selected: key } : item,
                        ),
                      )
                    }
                    onClose={close}
                  />
                  {pane.tabs.map((tab) => (
                    <div
                      key={tab.key}
                      hidden={tab.key !== pane.selected}
                      className={`${paneStyles.body} ${
                        FLUSH.has(tab.kind) ? paneStyles.flush : ""
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
    </GalleryConnectHost>
  );
}
