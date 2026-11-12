// 동작하는 project 화면. 새 shell 틀(title bar의 tab 줄, 가운데 card, 양쪽 sidebar) 안에서 sidebar·+ 메뉴·검색·상단 검색·toast·
// 대화·문서의 링크가 탭을 열면 탭 줄에 그 탭이 생기고 선택된다(이미 열린 탭이면 그 탭을 고른다). 실제 ShellFrame·TabStrip·
// ContentCard·Palette·Menu와 실제 sidebar(`LeftSidebar`, sidebar panel 목록)·`NewTabMenu`를 쓴다(고정 data는 project-window.tsx가
// 넘긴다). 칸이 둘인 page(`panes` 둘)는 두 탭을 한 칸으로 붙인 group 하나로 그린다. desk는 실제 desk model이다.
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { Palette, type PaletteItem } from "@lophn/ui/overlay";
import { shellIcons } from "../../../../packages/shell/renderer/icons/mod.ts";
import { ContentCard } from "../../../../packages/shell/renderer/shell/content-card.tsx";
import { DeskSwitcher } from "../../../../packages/shell/renderer/shell/desk-switcher.tsx";
import { PanelTabs } from "../../../../packages/shell/renderer/shell/panel-tabs.tsx";
import { ShellFrame } from "../../../../packages/shell/renderer/shell/shell-frame.tsx";
import { TabStrip } from "../../../../packages/shell/renderer/shell/tab-strip.tsx";
import {
  closeTab,
  type Desk,
  deskEntries,
  dirsOf,
  emptyDesk,
  groupOf,
  leavesOf,
  openTab,
  selectTab,
  setRatio,
  splitPartner,
  splitTab,
  type TabItem,
  ungroup,
  ungroupTab,
} from "../../../../packages/shell/renderer/shell/desk-model.ts";
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
  PageLeftSidebar,
  PageNewTabMenu,
  PageProjectPanel,
  type SidebarTab,
  type SidebarSpec,
  stripTabsOf,
  type TabSpec,
} from "./project-window.tsx";
import workspace from "../../../../packages/shell/renderer/workspace/workspace-window.module.css";
import { PaddedTab } from "../../../../packages/shell/renderer/workspace/padded-tab.tsx";

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

const PANELS = [
  { key: "explorer", label: "Files", icon: shellIcons.folder },
  { key: "artifact", label: "Artifacts", icon: shellIcons.artifact },
  { key: "workflow", label: "Workflows", icon: shellIcons.workflow },
  { key: "jobs", label: "Jobs", icon: shellIcons.jobs },
];

// desk model의 tab은 TabSpec 그대로 담는다(model은 tab을 복사해도 필드를 지우지 않는다). 읽을 때만 TabSpec로 본다.
const specsOf = (tabs: readonly TabItem[]) => tabs as readonly TabSpec[];

// 칸이 둘인 page의 입력을 한 줄의 탭과 group 하나로 합친다.
function deskOf(panes: readonly PaneInit[]): Desk {
  const first = panes[0];
  const second = panes[1];
  const base: Desk = {
    ...emptyDesk("_default", "Main"),
    tabs: panes.flatMap((pane) => pane.tabs),
    selected: first?.selected ?? null,
  };
  return first === undefined || second === undefined || second.selected === ""
    ? base
    : splitTab(base, first.selected, second.selected, "right", {
        select: "target",
      });
}

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
  const [desk, setDesk] = useState(() => deskOf(initial));
  const [panel, setPanel] = useState<SidebarTab>(
    sidebar.mode === undefined || sidebar.mode === "agent"
      ? "explorer"
      : sidebar.mode,
  );
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

  // 이미 열린 탭이면 그 탭을 고르고(문서 탭은 다른 줄을 달라면 그쪽으로), 아니면 고른 탭 바로 뒤에 더해 고른다.
  // `other`면 고른 탭과 한 칸으로 붙인다(group).
  const open = (tab: TabSpec, other = false) =>
    setDesk((current) => {
      if (current.tabs.some((item) => item.key === tab.key)) {
        return selectTab(
          {
            ...current,
            tabs: specsOf(current.tabs).map((item) =>
              item.key === tab.key && tab.file?.line !== undefined
                ? { ...item, file: tab.file, rev: (item.rev ?? 0) + 1 }
                : item,
            ),
          },
          tab.key,
        );
      }
      const added = openTab(current, tab, {
        ...(current.selected === null ? {} : { after: current.selected }),
      });
      return other && current.selected !== null
        ? splitTab(added, current.selected, tab.key, "right")
        : added;
    });

  const close = (key: string) => setDesk((current) => closeTab(current, key));

  // 같은 탭 안에서 session을 바꾼다(탭 key는 그대로, agent는 그대로). row가 없으면 새 session이다.
  const swapSession = (key: string, agent: string, row?: SessionRow) =>
    setDesk((current) => ({
      ...current,
      tabs: specsOf(current.tabs).map((tab) =>
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
    }));

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
            <AgentsBody />
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
  const group = groupOf(desk, desk.selected);
  const shown = specsOf(desk.tabs).filter((tab) =>
    group === null
      ? tab.key === desk.selected
      : leavesOf(group.layout).includes(tab.key),
  );
  const entries = deskEntries(desk).map((entry) => ({
    key: entry.key,
    tabs: stripTabsOf(specsOf(entry.tabs), tabStates),
    ...(entry.group === null
      ? {}
      : { dirs: dirsOf(entry.group.layout), focus: entry.group.focus }),
  }));
  const crumbsOf = (tab: TabSpec) =>
    tab.kind === "document"
      ? ["phroner", ...(tab.sub ?? tab.title).split("/").filter(Boolean)]
      : ["phroner", tab.title];
  return (
    <GalleryConnectHost agents={agents}>
      <div className={workspace.workspace}>
        <ShellFrame
          platform="linux"
          left
          onToggleLeft={() => {}}
          right
          onToggleRight={() => {}}
          deskSwitcher={
            <DeskSwitcher
              desks={[{ key: "_default", label: "Main" }]}
              current="_default"
              onSelect={() => {}}
              onNewDesk={() => {}}
              onRename={() => {}}
              onDelete={() => {}}
            />
          }
          tabs={
            <TabStrip
              entries={entries}
              selected={
                group === null ? desk.selected : leavesOf(group.layout)[0]!
              }
              minimized={[]}
              floating={[]}
              newTab={<PageNewTabMenu onPick={pick} startOpen={newTabOpen} />}
              onSelect={(key) => setDesk((current) => selectTab(current, key))}
              onClose={close}
              onToggleFloat={() => {}}
            />
          }
          panelTabs={
            <PanelTabs
              tabs={PANELS}
              selected={panel}
              onSelect={(key) => setPanel(key as SidebarTab)}
            />
          }
          leftSidebar={
            <div className={workspace.left}>
              {titleExtra === undefined ? null : (
                <div className={workspace.leftHead}>{titleExtra}</div>
              )}
              <PageLeftSidebar
                {...sidebar}
                onOpenFile={(id) => open(documentTab(id))}
                onAgent={(id) => open(newConversationTab(id))}
                onSession={(row) => open(sessionTab(row))}
                onQuick={pick}
              />
            </div>
          }
          rightSidebar={
            <PageProjectPanel
              {...sidebar}
              tab={panel}
              onOpenFile={(id) => open(documentTab(id))}
              onAgent={(id) => open(newConversationTab(id))}
            />
          }
        >
          <div className={workspace.stage}>
            <ContentCard
              panes={shown.map((tab) => ({
                key: tab.key,
                crumbs: crumbsOf(tab),
                menu: {
                  renamable: false,
                  preview: false,
                  file: tab.kind === "document",
                  canDetach: true,
                  group: group === null ? 0 : leavesOf(group.layout).length,
                  canSplit: splitPartner(desk, tab.key) !== null,
                  hasOthers: desk.tabs.length > 1,
                  hasRight: true,
                },
                body: (
                  <div key={tab.key} className={workspace.tabBody}>
                    {body(tab)}
                  </div>
                ),
              }))}
              {...(group === null ? {} : { layout: group.layout })}
              focus={desk.selected}
              deskLabel="Main"
              onFocus={(key) => setDesk((current) => selectTab(current, key))}
              onSplitRatio={(path, ratio) =>
                setDesk((current) =>
                  setRatio(current, current.selected!, path, ratio),
                )
              }
              onAction={(action, key) => {
                if (action === "close") close(key);
                else if (action === "unsplit") {
                  setDesk((current) => ungroup(current, key));
                } else if (action === "split-remove") {
                  setDesk((current) => ungroupTab(current, key));
                } else if (
                  action === "split-right" ||
                  action === "split-down"
                ) {
                  const partner = splitPartner(desk, key);
                  if (partner === null) return;
                  setDesk((current) =>
                    splitTab(
                      current,
                      key,
                      partner,
                      action === "split-right" ? "right" : "bottom",
                      { select: "target" },
                    ),
                  );
                }
              }}
              onEmptyAction={() => {}}
            />
            {overlay}
          </div>
        </ShellFrame>
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
