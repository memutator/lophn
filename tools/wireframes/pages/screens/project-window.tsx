// 새 설계 page들이 같이 쓰는 project 화면 조각. 실제 TopBar·LauncherButton·Tooltip과 design
// component를 그대로 쓰고, sidebar(`ProjectSidebar`)·탭 줄(design `TabStrip`)·새 탭 menu(`NewTabMenu`)도 실제
// renderer component다. 여기는 고정 data를 그 component의 props로 옮기는 일(`PageSidebar`, `PageNewTabMenu`,
// `stripTabsOf`)과, page마다 sidebar를 한 상태로 세워 두는 일(`useSidebarScript`)만 한다. 앱 코드는 고치지 않는다.
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { AvatarProfile } from "../../../../packages/shell/renderer/parts/avatar/avatar.tsx";
import type {
  TabDot,
  TabItem,
} from "../../../../packages/shell/renderer/parts/tab-strip/tab-strip.tsx";
import { createEventClient } from "../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { createFakeSource } from "../../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import { EventsProvider } from "../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import { fakeJobs } from "../../../../packages/shell/renderer/desktop/settings/jobs/testdata/fake-source.ts";
import type { JobView } from "../../../../packages/shell/renderer/desktop/settings/jobs/source.ts";
import { FileIcon, Icon, type IconProps } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { click, type } from "../../mock/drive.ts";
import {
  commonIcons,
  conversationIcons,
  paletteIcons,
  workspaceIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";

import { NewTabMenu } from "../../../../packages/shell/renderer/workspace/add-tab-menu.tsx";
import {
  ProjectSidebar,
  type SidebarTab,
} from "../../../../packages/shell/renderer/workspace/sidebar/project-sidebar.tsx";
import type { RailAction as SidebarRailAction } from "../../../../packages/shell/renderer/workspace/sidebar/activity-bar.tsx";
import type { SidebarAgent } from "../../../../packages/shell/renderer/workspace/sidebar/sidebar-agent.ts";
import type {
  PanelRun,
  PanelSession,
} from "../../../../packages/shell/renderer/workspace/sidebar/use-agent-panel.ts";
import {
  FAKE_NOTES_FOLDER,
  FAKE_PROJECT_FOLDER,
  fakeWorkspaceSource,
} from "../../../../packages/shell/renderer/workspace/fake-source.ts";
import {
  AGENT_ROWS,
  type AgentProfile,
  type ChatInit,
  profileOf,
  RUN_SESSIONS,
  RUNS,
  type SessionRow,
  SESSIONS,
} from "../../mock/agents-data.ts";
import type { FileInit } from "../../mock/project-files/file-data.ts";
import { Avatar } from "../../../../packages/shell/renderer/parts/avatar/avatar.tsx";

type TabKind =
  | "document"
  | "search"
  | "terminal"
  | "agent"
  | "agents"
  | "operator";

const KIND_ICON: Record<TabKind, IconProps["icon"]> = {
  document: workspaceIcons.documentEditor,
  search: paletteIcons.search,
  terminal: workspaceIcons.terminal,
  agent: conversationIcons.dock,
  agents: commonIcons.roles,
  operator: commonIcons.roles,
};

export interface TabSpec {
  readonly key: string;
  readonly kind: TabKind;
  readonly title: string;
  /** 문서 탭의 경로 같은 탭 하나의 설정. */
  readonly sub?: string;
  /** 이미 열린 문서 탭을 다른 줄로 다시 열 때 올린다. 본문이 새로 그려진다. */
  readonly rev?: number;
  /** 대화 탭의 시작 상태(어느 대화인지, 열린 menu). */
  readonly chat?: ChatInit;
  /** preview 탭(이름이 italic이다). */
  readonly preview?: boolean;
  /** 저장 안 된 변경이 있는 탭(닫기 자리에 ●). */
  readonly unsaved?: boolean;
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
  };
  return named[tab.kind] ?? tab.title;
}

function tabIcon(tab: TabSpec): ReactNode {
  if (tab.kind === "document") {
    return <FileIcon name={tab.sub ?? tab.title} size={14} />;
  }
  if (tab.kind === "agent") {
    return <Avatar profile={avatarOf(profileOf(agentNameOf(tab)))} size="sm" />;
  }
  return <Icon icon={KIND_ICON[tab.kind]} pixels={iconPixels("small")} />;
}

/** design `TabStrip`에 넘기는 탭. states는 Agent 탭의 상태 점(사람을 기다림·일하는 중)이다. */
export function stripTabsOf(
  tabs: readonly TabSpec[],
  states?: Readonly<Record<string, TabDot | null>>,
): TabItem[] {
  return tabs.map((tab) => ({
    key: tab.key,
    title: tabTitle(tab),
    icon: tabIcon(tab),
    dot: states?.[tab.key],
    preview: tab.preview,
    unsaved: tab.unsaved,
  }));
}

/** activity bar 아래쪽 바로 가기. 누르면 그 탭을 연다. */
export type RailAction = SidebarRailAction;

export interface SidebarSpec {
  /** 고른 문서 행(첫 연결 폴더 기준 상대 경로, 또는 절대 경로). */
  readonly current?: string;
  /** 오른쪽 클릭 menu가 열린 행. 실제 menu가 그 행에서 열린다. */
  readonly menuFor?: string;
  /** 접힌 sidebar로 시작한다. */
  readonly collapsed?: boolean;
  /** activity bar 아래쪽 바로 가기의 이 단추 tooltip을 열어 둔 채로 그린다. */
  readonly railTooltip?: RailAction;
  /** 이 agent 줄에 hover한 것처럼 "+"를 보인다. */
  readonly hoverAgent?: string;
  /** 파일 tree를 모두 접어 그린다(Agents 묶음이 한 화면에 들어오게). */
  readonly foldersClosed?: boolean;
  /** sidebar 본문을 맨 아래로 scroll한다(Agent 모양에서 Recent가 보이게). */
  readonly scrollToAgents?: boolean;
  /** Agent 모양에 Background(run) 묶음을 둔다. 끄면 run도 run이 연 session도 넘기지 않는다. */
  readonly runs?: boolean;
  /** 처음에 보이는 모양. 없으면 Explorer다. */
  readonly mode?: SidebarTab;
  /** 루트를 고르는 menu를 연 채 시작한다. */
  readonly rootMenu?: boolean;
  /** Scheduled jobs 탭에 이 project에 걸린 job이 하나도 없다. */
  readonly noJobs?: boolean;
  /** Explorer에서 사람이 한 조작을 하고 멈춘 모양. */
  readonly act?: ExplorerAct;
}

/**
 * head: 머리 단추가 보인다(머리에 focus). delete: 오른쪽 클릭 menu의 Delete를 눌러 확인이 뜬다.
 * new-file: 폴더를 고르고 New File을 눌러 이름을 쓰는 중이다. new-exists: 이미 있는 이름을 써서 오류가 보인다.
 * rename: F2로 이름을 바꾸는 중이다. move: 파일을 폴더로 끌어 놓아 옮기기 확인이 뜬다.
 */
export type ExplorerAct =
  | "head"
  | "delete"
  | "new-file"
  | "new-exists"
  | "rename"
  | "move";

interface SidebarProps extends SidebarSpec {
  readonly collapsed: boolean;
  readonly onToggle: () => void;
  readonly onRail: (action: RailAction) => void;
  readonly onOpenFile: (id: string) => void;
  readonly onAgent: (agent: string) => void;
  readonly onManage: () => void;
  /** session을 누르면 그 session 탭을 연다. */
  readonly onSession?: (row: SessionRow) => void;
}

// ---- sidebar에 넘기는 고정 data ----

const PROJECT_ID = "prj_phroner";
const PROJECT = {
  id: PROJECT_ID,
  title: "phroner",
  folders: [
    {
      path: FAKE_PROJECT_FOLDER,
      found: true,
      subfolders: [{ path: "eval" }],
    },
    { path: FAKE_NOTES_FOLDER, found: true, subfolders: [] },
  ],
};

// 사용자가 올린 이미지를 대신하는 둥근 사진 모양.
const PHOTO = `data:image/svg+xml,${
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#b9d3ee"/><circle cx="28" cy="12" r="5" fill="#f6d77a"/><path d="M0 40V28c6-7 12-7 18-1 6-8 14-8 22 1v12z" fill="#5f8f6a"/></svg>',
  )
}`;

const avatarOf = (profile: AgentProfile): AvatarProfile =>
  profile.image === true
    ? { kind: "image", src: PHOTO }
    : { kind: "icon", icon: profile.icon };

const AGENTS: readonly SidebarAgent[] = AGENT_ROWS
  .filter((row) => row.id !== "operators")
  .map((row) => ({
    assignment: row.id,
    role: row.operator === true
      ? "operator" as const
      : row.id === "lophn"
      ? "lophn" as const
      : "project_manager" as const,
    name: row.name,
    profile: avatarOf(row.profile),
    waiting: false,
  }));

// 열린 탭이 있는 session. 나머지는 Recent에만 오른다.
const OPEN = new Set([
  "weekly",
  "harness",
  "failing",
  "week41",
  "next-experiments",
]);

const MINUTE = 60_000;
const NOW = Date.now();

// "12 min ago", "3 h ago", "yesterday"처럼 적힌 때를 시각으로 바꾼다.
function whenMs(when: string): number {
  const num = Number(/^\d+/.exec(when)?.[0] ?? 1);
  if (when.includes("min")) return NOW - num * MINUTE;
  if (when.includes(" h ")) return NOW - num * 60 * MINUTE;
  if (when === "yesterday") return NOW - 24 * 60 * MINUTE;
  if (when.includes("day")) return NOW - num * 24 * 60 * MINUTE;
  if (when === "last week") return NOW - 7 * 24 * 60 * MINUTE;
  if (when.includes("week")) return NOW - num * 7 * 24 * 60 * MINUTE;
  return NOW - 30 * 24 * 60 * MINUTE;
}

const agentIdOf = (name: string) =>
  AGENT_ROWS.find((row) => row.name === name)?.id;

const PANEL_SESSIONS: readonly PanelSession[] = SESSIONS.flatMap((row) => {
  const agent = agentIdOf(row.agent);
  if (agent === undefined || row.group === "archived") return [];
  return [{
    id: row.id,
    title: row.title,
    agent,
    status: row.state,
    open: OPEN.has(row.id),
    at: whenMs(row.when),
  }];
});

const panelSessionOf = (
  row: SessionRow,
  open: boolean,
): PanelSession | null => {
  const agent = agentIdOf(row.agent);
  return agent === undefined ? null : {
    id: row.id,
    title: row.title,
    agent,
    status: row.state,
    open,
    at: whenMs(row.when),
  };
};

// job이 연 run의 제목. `mock/agents-data.ts`의 RUNS id로 건다.
const RUN_JOB_TITLES: Readonly<Record<string, string>> = {
  "run-1": "Morning digest",
  "run-5": "Weekly review",
};

// run이 연 session은 열린 채 run 아래에 묶이고 `sessions`에는 넣지 않는다.
const PANEL_RUNS: readonly PanelRun[] = RUNS.flatMap((run) => {
  const agent = agentIdOf(run.agent);
  if (agent === undefined) return [];
  const row = RUN_SESSIONS.find((item) => item.id === run.session);
  return [{
    id: run.id,
    agent,
    title: RUN_JOB_TITLES[run.id] ?? null,
    state: run.state,
    at: whenMs(run.when),
    session: row === undefined ? null : panelSessionOf(row, true),
  }];
});

const DEMO_SOURCE = fakeWorkspaceSource();

const absolute = (path: string) =>
  path.startsWith("/") ? path : `${FAKE_PROJECT_FOLDER}/${path}`;

const EXPERIMENTS = "eval/experiments";

// Explorer에서 사람이 한 조작을 같은 신호(focus, click, key, drag)로 보내 한 상태를 만든다.
async function runExplorerAct(
  act: ExplorerAct,
  waitFor: (selector: string) => Promise<HTMLElement | null>,
) {
  const fileRow = (path: string) => `[data-file="${CSS.escape(path)}"]`;
  if (act === "head") {
    (await waitFor('[data-explorer-action="new-file"]'))?.focus();
  } else if (act === "delete") {
    const row = await waitFor(
      fileRow(absolute(`${EXPERIMENTS}/exp-012-ftb-quests-021-q8.md`)),
    );
    if (row === null) return;
    const box = row.getBoundingClientRect();
    row.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        clientX: box.left + 40,
        clientY: box.top + 10,
      }),
    );
    await click('[role="menuitem"]', "Delete");
  } else if (act === "new-file" || act === "new-exists") {
    (await waitFor(fileRow(absolute(EXPERIMENTS))))?.focus();
    await click('[data-explorer-action="new-file"]');
    await type(
      "[data-editing] input",
      act === "new-file" ? "exp-013-notes.md" : "exp-008-query-tools.md",
    );
  } else if (act === "rename") {
    const row = await waitFor(
      fileRow(absolute(`${EXPERIMENTS}/exp-012-ftb-quests-021-q8.md`)),
    );
    row?.focus();
    row?.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "F2",
        bubbles: true,
        cancelable: true,
      }),
    );
  } else {
    const file = await waitFor(
      fileRow(absolute(`${EXPERIMENTS}/exp-012-ftb-quests-021-q8.md`)),
    );
    const target = await waitFor(fileRow(absolute("eval/rubrics")));
    if (file === null || target === null) return;
    const dataTransfer = new DataTransfer();
    const fire = (element: HTMLElement, type: string) =>
      element.dispatchEvent(
        new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer }),
      );
    fire(file, "dragstart");
    fire(target, "dragover");
    fire(target, "drop");
  }
}

// page가 정한 한 상태로 sidebar를 세운다. 실제 component가 스스로 여는 menu·펼침은 화면 위의 사람 조작과 같은
// 신호(click, 오른쪽 클릭, Enter, focus)를 보내 만든다. 한 번만 돈다.
function useSidebarScript(
  ref: RefObject<HTMLElement | null>,
  spec: SidebarSpec,
) {
  useEffect(() => {
    if (ref.current === null) return;
    let live = true;
    const waitFor = (selector: string) =>
      new Promise<HTMLElement | null>((resolve) => {
        const find = () => document.querySelector<HTMLElement>(selector);
        const hit = find();
        if (hit) return resolve(hit);
        const observer = new MutationObserver(() => {
          const found = find();
          if (found) {
            observer.disconnect();
            resolve(found);
          }
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(null);
        }, 2000);
      });
    const fileRow = (path: string) => `[data-file="${CSS.escape(path)}"]`;
    void (async () => {
      const explorer = spec.mode === undefined || spec.mode === "explorer";
      if (spec.collapsed !== true && explorer) {
        if (spec.foldersClosed !== true) {
          for (const dir of ["eval", "eval/experiments"]) {
            const row = await waitFor(fileRow(absolute(dir)));
            if (!live) return;
            if (row?.getAttribute("aria-expanded") === "false") row.click();
          }
        }
        if (spec.menuFor !== undefined) {
          const row = await waitFor(fileRow(absolute(spec.menuFor)));
          if (!live || row === null) return;
          const box = row.getBoundingClientRect();
          row.dispatchEvent(
            new MouseEvent("contextmenu", {
              bubbles: true,
              cancelable: true,
              clientX: box.left + box.width / 2,
              clientY: box.top + box.height / 2,
            }),
          );
        }
        if (spec.act !== undefined) await runExplorerAct(spec.act, waitFor);
        if (spec.rootMenu === true) {
          const head = await waitFor("[data-root-head]");
          if (!live) return;
          head?.dispatchEvent(
            new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
          );
        }
      }
      if (spec.collapsed === true && spec.railTooltip !== undefined) {
        const button = await waitFor(
          `[data-rail-action="${spec.railTooltip}"]`,
        );
        button?.focus();
      }
      if (spec.hoverAgent !== undefined) {
        const row = await waitFor(`[data-agent="${spec.hoverAgent}"]`);
        const plus = row?.parentElement?.querySelector<HTMLElement>(
          "span:last-child",
        );
        if (plus) plus.style.opacity = "1";
      }
      if (spec.scrollToAgents === true) {
        const body = await waitFor("[data-sidebar-tab]");
        if (body) body.scrollTop = body.scrollHeight;
      }
    })();
    return () => {
      live = false;
    };
    // page가 정한 상태이므로 처음 한 번만 세운다.
  }, []);
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (offset: number) => new Date(Date.now() + offset).toISOString();
const GROCERY_ID = "prj_grocery";

const job = (
  n: number,
  fields:
    & Pick<JobView, "title" | "creator" | "every" | "at" | "action">
    & Partial<JobView>,
): JobView => ({
  id: `job_${n}`,
  missed_policy: "run",
  enabled: true,
  next_due_at: null,
  last_run: null,
  ...fields,
});

/** phroner에 걸린 job 넷(PM이 만든 것, PM을 부르는 것, Operator를 부르는 것, workflow를 시작하는 것)과 Grocery의 job 하나. 마지막은 보이지 않아야 한다. */
const JOBS: readonly JobView[] = [
  job(1, {
    title: "Weekly review",
    creator: { role: "project_manager", project: PROJECT_ID },
    every: "7d",
    at: "10:00",
    action: {
      kind: "workflow_start",
      project: PROJECT_ID,
      workflow: "weekly-review",
    },
    next_due_at: at(4 * DAY),
    last_run: { state: "done", due_at: at(-3 * DAY), started_at: at(-3 * DAY) },
  }),
  job(2, {
    title: "Morning digest",
    creator: { role: "lophn" },
    every: "1d",
    at: "09:00",
    action: {
      kind: "agent_run",
      agent: { role: "project_manager", project: PROJECT_ID },
      agent_place: { kind: "project", id: PROJECT_ID },
      prompt: "Summarize yesterday's finished tasks.",
    },
    missed_policy: "hold",
    next_due_at: at(3 * HOUR),
    last_run: { state: "held", due_at: at(-2 * HOUR), started_at: null },
  }),
  job(3, {
    title: "Bookkeeping notes",
    creator: { role: "lophn" },
    every: "1d",
    at: "23:30",
    action: {
      kind: "agent_run",
      agent: { role: "operator", agent: "agt_bookkeeper" },
      agent_place: { kind: "project", id: PROJECT_ID },
      prompt: "Write today's bookkeeping notes.",
    },
    missed_policy: "hold",
    enabled: false,
    last_run: {
      state: "done",
      due_at: at(-9 * HOUR),
      started_at: at(-9 * HOUR),
    },
  }),
  job(4, {
    title: "Nightly eval run",
    creator: { role: "lophn" },
    every: "1d",
    at: "02:00",
    action: {
      kind: "workflow_start",
      project: PROJECT_ID,
      workflow: "eval-run",
    },
    next_due_at: at(11 * HOUR),
    last_run: {
      state: "failed",
      due_at: at(-13 * HOUR),
      started_at: at(-13 * HOUR),
    },
  }),
  job(5, {
    title: "Grocery price check",
    creator: { role: "project_manager", project: GROCERY_ID },
    every: "6h",
    at: null,
    action: {
      kind: "agent_run",
      agent: { role: "project_manager", project: GROCERY_ID },
      agent_place: { kind: "project", id: GROCERY_ID },
      prompt: "Compare this week's prices.",
    },
    next_due_at: at(2 * HOUR),
    last_run: {
      state: "done",
      due_at: at(-4 * HOUR),
      started_at: at(-4 * HOUR),
    },
  }),
];

/**
 * project sidebar. 실제 `ProjectSidebar`에 phroner의 고정 data(연결 폴더 둘, lophn·Project Manager·Operator 둘과
 * 그 session)를 넘긴다. 접으면 activity bar만 남는다: 항목 넷(누르면 펼침) · 아래쪽 Terminal · Agent · Search.
 */
export function PageSidebar(props: SidebarProps) {
  const ref = useRef<HTMLDivElement>(null);
  useSidebarScript(ref, props);
  // JobPanel과 WorkflowPanel이 event를 듣는다.
  const [client] = useState(() => createEventClient(createFakeSource()));
  const jobs = useMemo(
    () => fakeJobs({ jobs: props.noJobs === true ? [] : JOBS }).source,
    [props.noJobs],
  );
  return (
    <EventsProvider client={client}>
      <div ref={ref} style={{ display: "contents" }}>
        <ProjectSidebar
          mode={props.collapsed ? "collapsed" : "open"}
          width={props.collapsed ? 56 : 240}
          project={PROJECT}
          source={DEMO_SOURCE}
          jobs={jobs}
          onOpenJobs={() => {}}
          agents={AGENTS}
          sessions={PANEL_SESSIONS}
          {...(props.runs === true ? { runs: PANEL_RUNS } : {})}
          current={props.current === undefined ? null : absolute(props.current)}
          initialTab={props.mode}
          onOpenFile={(path) =>
            props.onOpenFile(
              path.startsWith(`${FAKE_PROJECT_FOLDER}/`)
                ? path.slice(FAKE_PROJECT_FOLDER.length + 1)
                : path,
            )}
          onMove={(from, to) => DEMO_SOURCE.rename(from, to)}
          onTrash={(path) => DEMO_SOURCE.trash(path)}
          onRail={props.onRail}
          onAgent={(agent) => props.onAgent(agent.assignment)}
          onSession={(session) => {
            const row = [...SESSIONS, ...RUN_SESSIONS].find((item) =>
              item.id === session.id
            );
            if (row) props.onSession?.(row);
          }}
          onManage={props.onManage}
          onToggle={props.onToggle}
          onLauncher={() => {}}
        />
      </div>
    </EventsProvider>
  );
}

type NewTabPick =
  | "document"
  | "terminal"
  | "agent-lophn"
  | "agent-project-manager"
  | `agent-operator:${string}`
  | "search"
  | "browser"
  | "app-panel";

/**
 * 탭 줄 끝의 + menu. 실제 `NewTabMenu`이고 Agent ▸(agent 목록)는 같은 menu가 다음 단계로 바뀐다.
 * Agents(관리 탭) 항목은 없다.
 */
export function PageNewTabMenu(
  { onPick, startOpen = false }: {
    onPick: (pick: NewTabPick) => void;
    /** menu를 연 채 시작한다(page가 열린 menu를 보인다). */
    startOpen?: boolean;
  },
) {
  useEffect(() => {
    if (!startOpen) return;
    document.querySelector<HTMLElement>("[data-new-tab]")?.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0 }),
    );
  }, []);
  return (
    <NewTabMenu
      onDocument={() => onPick("document")}
      onTerminal={() => onPick("terminal")}
      onBrowser={() => onPick("browser")}
      agents={AGENTS.map((agent) => ({
        id: agent.assignment,
        name: agent.name,
        profile: agent.profile,
      }))}
      onAgent={(id) =>
        onPick(
          id === "lophn"
            ? "agent-lophn"
            : id === "engineer"
            ? "agent-project-manager"
            : `agent-operator:${id}`,
        )}
      onSearch={() => onPick("search")}
      onAppPanel={() => onPick("app-panel")}
    />
  );
}
