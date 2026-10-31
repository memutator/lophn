// 새 설계 page들이 같이 쓰는 project 화면 조각. 왼쪽 sidebar(`LeftSidebar`)·오른쪽 panel(`ProjectPanel`)·탭 줄(shell
// `TabStrip`)·새 탭 menu(`NewTabMenu`)는 실제 renderer component다. 여기는 고정 data를 그 component의 props로 옮기는 일
// (`PageLeftSidebar`, `PageProjectPanel`, `PageNewTabMenu`, `stripTabsOf`)과, page마다 sidebar를 한 상태로 세워 두는 일
// (`useSidebarScript`)만 한다. 앱 코드는 고치지 않는다.

import { FileIcon, Icon, type IconProps } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createEventClient } from "../../../../packages/shell/renderer/desktop/connection/events/client.ts";
import { createFakeSource } from "../../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import { EventsProvider } from "../../../../packages/shell/renderer/desktop/connection/events/hooks.tsx";
import type { JobView } from "../../../../packages/shell/renderer/desktop/jobs/source.ts";
import { fakeJobs } from "../../../../packages/shell/renderer/desktop/jobs/testdata/fake-source.ts";
import {
  commonIcons,
  conversationIcons,
  paletteIcons,
  workspaceIcons,
} from "../../../../packages/shell/renderer/icons/mod.ts";
import type { AvatarProfile } from "../../../../packages/shell/renderer/parts/avatar/avatar.tsx";
import { Avatar } from "../../../../packages/shell/renderer/parts/avatar/avatar.tsx";
import type { TabDot } from "../../../../packages/shell/renderer/parts/tab-state-dot/tab-state-dot.tsx";
import type { StripTab } from "../../../../packages/shell/renderer/shell/tab-strip.tsx";

import {
  appTabEntries,
  NewTabMenu,
} from "../../../../packages/shell/renderer/workspace/add-tab-menu.tsx";
import {
  FAKE_NOTES_FOLDER,
  FAKE_PROJECT_FOLDER,
  fakeWorkspaceSource,
} from "../../../../packages/shell/renderer/workspace/fake-source.ts";
import {
  ProjectPanel,
  type SidebarTab,
} from "../../../../packages/shell/renderer/workspace/sidebar/project-sidebar.tsx";
import type { SidebarAgent } from "../../../../packages/shell/renderer/workspace/sidebar/sidebar-agent.ts";
import { LeftSidebar } from "../../../../packages/shell/renderer/shell/left-sidebar.tsx";
import type {
  SidebarPlace,
  SidebarSession,
} from "../../../../packages/shell/renderer/shell/left-sidebar-model.ts";
import {
  AGENT_ROWS,
  type AgentProfile,
  type ChatInit,
  profileOf,
  SESSIONS,
  type SessionRow,
} from "../../mock/agents-data.ts";
import { click, type } from "../../mock/drive.ts";
import type { FileInit } from "../../mock/project-files/file-data.ts";

type TabKind =
  | "document"
  | "search"
  | "terminal"
  | "agent"
  | "agents"
  | "agent-settings";

const KIND_ICON: Record<TabKind, IconProps["icon"]> = {
  document: workspaceIcons.documentEditor,
  search: paletteIcons.search,
  terminal: workspaceIcons.terminal,
  agent: conversationIcons.dock,
  agents: commonIcons.agents,
  "agent-settings": commonIcons.agents,
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

/** shell `TabStrip`에 넘기는 탭. states는 Agent 탭의 상태 점(사람을 기다림·일하는 중)이다. */
export function stripTabsOf(
  tabs: readonly TabSpec[],
  states?: Readonly<Record<string, TabDot | null>>,
): StripTab[] {
  return tabs.map((tab) => ({
    key: tab.key,
    title: tabTitle(tab),
    icon: tabIcon(tab),
    dot: states?.[tab.key],
  }));
}

export interface SidebarSpec {
  /** 고른 문서 행(첫 연결 폴더 기준 상대 경로, 또는 절대 경로). */
  readonly current?: string;
  /** 오른쪽 클릭 menu가 열린 행. 실제 menu가 그 행에서 열린다. */
  readonly menuFor?: string;
  /** 파일 tree를 모두 접어 그린다(Agents 묶음이 한 화면에 들어오게). */
  readonly foldersClosed?: boolean;
  /** 왼쪽 sidebar에서 이 project의 Recent를 펼친 채 시작한다. */
  readonly recentOpen?: boolean;
  /** 오른쪽 panel이 처음에 보이는 모양. 없거나 agent면 Files다(Agent 쪽은 늘 왼쪽 sidebar에 있다). */
  readonly mode?: SidebarTab | "agent";
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
  readonly onOpenFile: (id: string) => void;
  readonly onAgent: (agent: string) => void;
  /** session을 누르면 그 session 탭을 연다. */
  readonly onSession?: (row: SessionRow) => void;
  /** 왼쪽 sidebar에서 강조할 줄(`sessionKey`). */
  readonly selected?: string;
  /** 이 창이 보이는 place. 없으면 project(phroner)다. Home은 터미널이 없고 앱 place는 앱 화면 항목이 있다. */
  readonly place?: "project" | "home" | "app";
  /** 맨 아래 줄의 빠른 실행을 누르면 + menu와 같은 pick을 알린다. */
  readonly onQuick?: (pick: NewTabPick) => void;
}

// ---- sidebar에 넘기는 고정 data ----

const PROJECT_ID = "prj_phroner";
const GROCERY_ID = "prj_grocery";
const PROJECT = {
  id: PROJECT_ID,
  title: "phroner",
  folders: [
    { path: FAKE_PROJECT_FOLDER, found: true },
    { path: FAKE_NOTES_FOLDER, found: true },
  ],
};

// 사용자가 올린 이미지를 대신하는 둥근 사진 모양.
const PHOTO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 40"><rect width="40" height="40" fill="#b9d3ee"/><circle cx="28" cy="12" r="5" fill="#f6d77a"/><path d="M0 40V28c6-7 12-7 18-1 6-8 14-8 22 1v12z" fill="#5f8f6a"/></svg>',
)}`;

const avatarOf = (profile: AgentProfile): AvatarProfile =>
  profile.image === true
    ? { kind: "image", src: PHOTO }
    : { kind: "character", shape: profile.shape, color: profile.color };

const AGENTS: readonly SidebarAgent[] = AGENT_ROWS.map((row) => ({
  assignment: row.id,
  name: row.name,
  profile: avatarOf(row.profile),
  waiting: false,
}));

// 열린 탭이 있는 session(Current). 나머지는 Recent에만 오른다.
const OPEN = new Set(["weekly", "harness"]);

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

const lophnLine = (
  row: SessionRow,
  dot: SidebarSession["dot"] = row.state === "idle" ? null : row.state,
): SidebarSession[] => {
  const agent = AGENTS.find((item) => item.assignment === agentIdOf(row.agent));
  return agent === undefined || row.group === "archived"
    ? []
    : [
        {
          kind: "session",
          ref: row.id,
          title: row.title,
          agent: { kind: "lophn", profile: agent.profile },
          dot,
          at: whenMs(row.when),
        },
      ];
};

const codingLine = (
  ref: string,
  harness: "claude" | "openai" | "opencode" | "grok",
  title: string,
  when: string,
  dot: SidebarSession["dot"],
): SidebarSession => ({
  kind: "terminal",
  ref,
  title,
  agent: { kind: "coding", vendor: harness },
  dot,
  at: whenMs(when),
});

const byId = (id: string) => SESSIONS.find((item) => item.id === id)!;

/** 왼쪽 sidebar의 place들. phroner가 이 창이 보이는 project이고 Home·다른 project·앱은 그 session만 있다. */
const SIDEBAR_PLACES: readonly SidebarPlace[] = [
  {
    ref: { kind: "home" },
    name: "Home",
    current: [
      ...lophnLine({
        ...byId("release-check"),
        id: "home-plan",
        title: "Plan the week",
        state: "working",
      }),
    ],
    recent: [
      ...lophnLine({
        ...byId("c049"),
        id: "home-notes",
        title: "Sort inbox notes",
        when: "yesterday",
      }),
    ],
  },
  {
    ref: { kind: "project", id: PROJECT_ID },
    name: "phroner",
    current: [
      {
        kind: "workflow",
        ref: "weekly-review",
        title: "weekly-review",
        agent: { kind: "workflow" },
        dot: "waiting",
        at: 0,
      },
      ...lophnLine(byId("weekly")),
      ...lophnLine(byId("harness")),
      codingLine(
        "terminal-claude",
        "claude",
        "Fix flaky retry in the scenario runner",
        "1 min ago",
        "working",
      ),
      codingLine(
        "terminal-codex",
        "openai",
        "Split the eval board loader",
        "8 min ago",
        "finished",
      ),
    ],
    recent: [
      ...lophnLine(byId("release-check")),
      ...lophnLine(byId("c049")),
      ...lophnLine(byId("eval-questions")),
      codingLine(
        "ses_opencode",
        "opencode",
        "Add a dry-run flag to the export script",
        "30 min ago",
        null,
      ),
      codingLine(
        "ses_grok",
        "grok",
        "Why does the rubric loader skip yaml files",
        "45 min ago",
        null,
      ),
    ],
  },
  {
    ref: { kind: "project", id: GROCERY_ID },
    name: "Grocery",
    current: [],
    recent: [
      ...lophnLine({
        ...byId("c049"),
        id: "grocery-prices",
        title: "Compare this week's prices",
        when: "5 h ago",
      }),
    ],
  },
  {
    ref: { kind: "app", id: "app_orders" },
    name: "Orders",
    current: [
      ...lophnLine({
        ...byId("harness"),
        id: "orders-export",
        title: "Add a CSV export",
        state: "waiting",
      }),
    ],
    recent: [],
  },
];

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
      if (explorer) {
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
      if (spec.recentOpen === true) {
        (await waitFor(`[data-recent-toggle="${PROJECT_ID}"]`))?.click();
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

const job = (
  n: number,
  fields: Pick<JobView, "title" | "creator" | "every" | "at" | "action"> &
    Partial<JobView>,
): JobView => ({
  id: `job_${n}`,
  missed_policy: "run",
  enabled: true,
  approved_at: at(-30 * DAY),
  next_due_at: null,
  last_run: null,
  ...fields,
});

/** phroner에 걸린 job 넷(project place의 lophn이 만든 것, 그 lophn을 부르는 것, 사람이 만든 agent를 부르는 것, workflow를 시작하는 것)과 Grocery의 job 하나. 마지막은 보이지 않아야 한다. */
const JOBS: readonly JobView[] = [
  job(1, {
    title: "Weekly review",
    creator: { agent: "lophn", place: { kind: "project", id: PROJECT_ID } },
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
    creator: { agent: "lophn", place: null },
    every: "1d",
    at: "09:00",
    action: {
      kind: "agent_run",
      agent: "lophn",
      agent_place: { kind: "project", id: PROJECT_ID },
      prompt: "Summarize yesterday's finished tasks.",
    },
    missed_policy: "hold",
    next_due_at: at(3 * HOUR),
    last_run: { state: "held", due_at: at(-2 * HOUR), started_at: null },
  }),
  job(3, {
    title: "Bookkeeping notes",
    creator: { agent: "lophn", place: null },
    every: "1d",
    at: "23:30",
    action: {
      kind: "agent_run",
      agent: "agt_bookkeeper",
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
    creator: { agent: "lophn", place: null },
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
    creator: { agent: "lophn", place: { kind: "project", id: GROCERY_ID } },
    every: "6h",
    at: null,
    action: {
      kind: "agent_run",
      agent: "lophn",
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

/** 왼쪽 sidebar. 실제 `LeftSidebar`에 place 넷(Home, phroner, Grocery, Orders)과 그 session의 고정 data를 넘긴다. */
export function PageLeftSidebar(props: SidebarProps) {
  const ref = useRef<HTMLDivElement>(null);
  useSidebarScript(ref, { ...props, mode: "workflow" });
  // Inbox(WaitingLayer)가 event를 듣는다.
  const [client] = useState(() => createEventClient(createFakeSource()));
  const jobs = useMemo(() => fakeJobs({ jobs: JOBS }).source, []);
  const pick = props.onQuick ?? (() => {});
  const app = appTabEntries({
    ...(props.place === "app" ? { onAppScreen: () => pick("app-screen") } : {}),
    onAppPanel: () => pick("app-panel"),
  });
  const quick = {
    ...(props.place === "home" ? {} : { onTerminal: () => pick("terminal") }),
    onBrowser: () => pick("browser"),
    appItems: app.items,
    onApp: app.select,
  };
  return (
    <EventsProvider client={client}>
      <div ref={ref} style={{ display: "contents" }}>
        <LeftSidebar
          places={SIDEBAR_PLACES}
          current={
            props.place === "home"
              ? { kind: "home" }
              : props.place === "app"
                ? { kind: "app", id: "app_orders" }
                : { kind: "project", id: PROJECT_ID }
          }
          selected={props.selected}
          quick={quick}
          agents={AGENTS.map((agent) => ({
            id: agent.assignment,
            name: agent.name,
            profile: agent.profile,
          }))}
          coding={[
            { id: "claude", name: "Claude Code", vendor: "claude" },
            { id: "codex", name: "Codex", vendor: "openai" },
            { id: "opencode", name: "OpenCode", vendor: "opencode" },
          ]}
          onNewSession={() => props.onAgent("lophn")}
          onNewSessionWith={(kind, id) => kind === "lophn" && props.onAgent(id)}
          onOpenSession={() => {}}
          jobs={jobs}
          onInbox={() => {}}
          onJobs={() => {}}
          onPlace={() => {}}
          onSession={(_place, item) => {
            const found = SESSIONS.find((entry) => entry.id === item.ref);
            if (found) props.onSession?.(found);
          }}
          onRemoveRecent={() => {}}
          onRegisterProject={() => {}}
          onCreateApp={() => {}}
          onSettings={() => {}}
        />
      </div>
    </EventsProvider>
  );
}

/** 오른쪽 panel. 실제 `ProjectPanel`에 phroner의 고정 data(연결 폴더 둘)를 넘긴다. */
export function PageProjectPanel(props: SidebarProps & { tab: SidebarTab }) {
  const ref = useRef<HTMLDivElement>(null);
  useSidebarScript(ref, { ...props, mode: props.tab });
  const [client] = useState(() => createEventClient(createFakeSource()));
  const [root, setRoot] = useState<string | null>(null);
  const jobs = useMemo(
    () => fakeJobs({ jobs: props.noJobs === true ? [] : JOBS }).source,
    [props.noJobs],
  );
  return (
    <EventsProvider client={client}>
      <div ref={ref} style={{ display: "contents" }}>
        <ProjectPanel
          tab={props.tab}
          project={PROJECT}
          source={DEMO_SOURCE}
          jobs={jobs}
          onOpenJobs={() => {}}
          current={props.current === undefined ? null : absolute(props.current)}
          onOpenFile={(path) =>
            props.onOpenFile(
              path.startsWith(`${FAKE_PROJECT_FOLDER}/`)
                ? path.slice(FAKE_PROJECT_FOLDER.length + 1)
                : path,
            )
          }
          onMove={(from, to) => DEMO_SOURCE.rename(from, to)}
          onTrash={(path) => DEMO_SOURCE.trash(path)}
          explorerRoot={root}
          onExplorerRoot={setRoot}
          onAddFolder={() => Promise.resolve(true)}
          onRemoveFolder={() => Promise.resolve(true)}
          onOpenTerminal={() => {}}
        />
      </div>
    </EventsProvider>
  );
}

type NewTabPick =
  | "document"
  | "terminal"
  | "agent-lophn"
  | `agent:${string}`
  | "search"
  | "browser"
  | "app-screen"
  | "app-panel";

/**
 * 탭 줄 끝의 + menu. 실제 `NewTabMenu`이고 Agent ▸(agent 목록)는 같은 menu가 다음 단계로 바뀐다.
 * Agents(관리 탭) 항목은 없다.
 */
export function PageNewTabMenu({
  onPick,
  startOpen = false,
}: {
  onPick: (pick: NewTabPick) => void;
  /** menu를 연 채 시작한다(page가 열린 menu를 보인다). */
  startOpen?: boolean;
}) {
  useEffect(() => {
    if (!startOpen) return;
    document
      .querySelector<HTMLElement>("[data-new-tab]")
      ?.dispatchEvent(
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
      onAgent={(id) => onPick(id === "lophn" ? "agent-lophn" : `agent:${id}`)}
      onSearch={() => onPick("search")}
      onAppPanel={() => onPick("app-panel")}
    />
  );
}
