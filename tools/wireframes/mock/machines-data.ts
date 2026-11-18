// 한 창의 목록 gallery의 가짜 기계 셋: 이 컴퓨터(Studio), 붙어 있는 Home server, 꺼진 Laptop. 줄은 renderer의 순수 함수
// (`mergeWorkspaces`, `sidebarWorkspaces`)가 이 목록에서 짓는다. 이 컴퓨터의 project·앱 id는 gallery의 fake projects·apps와 같다
// (Workspaces panel이 그것을 읽는다).
import type { SessionEntry } from "../../../packages/shell/renderer/desktop/connection/events/sessions-store.ts";
import type { OnMachine } from "../../../packages/shell/renderer/desktop/machines/data.ts";
import {
  type ListedProject,
  type MachineLists,
  type MergedWorkspace,
  mergeWorkspaces,
} from "../../../packages/shell/renderer/desktop/workspaces/projects/merged.ts";
import type { WorkspaceRef } from "../../../packages/shell/renderer/shell/desk-model.ts";
import type { SidebarWorkspace } from "../../../packages/shell/renderer/shell/left-sidebar-model.ts";
import {
  homeName,
  type RemoteTerminal,
  sidebarWorkspaces,
} from "../../../packages/shell/renderer/shell/left-sidebar-workspaces.ts";
import type { SidebarAgent } from "../../../packages/shell/renderer/workspace/sidebar/sidebar-agent.ts";

export const HOME_SERVER = "mch_01h455vb4pex5v6nkc6gd5fm01";
export const LAPTOP = "mch_01h455vb4pex5v6nkc6gd5fm02";

export const MACHINE_NAMES: ReadonlyMap<string, string> = new Map([
  [HOME_SERVER, "Home server"],
  [LAPTOP, "Laptop"],
]);

// 이 컴퓨터. phroner와 grocery-budget은 gallery fake projects의 id다.
const PHRONER = "prj_01h455vb4pex5v6nkc6gd5fd01";
const GROCERY_BUDGET = "prj_01h455vb4pex5v6nkc6gd5fd02";
const FIELD_NOTES = "prj_01h455vb4pex5v6nkc6gd5fd04";
// Home server.
const HS_PHRONER = "prj_01h455vb4pex5v6nkc6gd5fh01";
const HS_GROCERY = "prj_01h455vb4pex5v6nkc6gd5fh02";
const HS_RECIPES = "prj_01h455vb4pex5v6nkc6gd5fh03";
// Laptop.
const LT_PHRONER = "prj_01h455vb4pex5v6nkc6gd5fl01";
const LT_SKETCH = "prj_01h455vb4pex5v6nkc6gd5fl02";

const PRI_PHRONER = "pri_01h455vb4pex5v6nkc6gd5fp01";

// 기계를 건너는 앱. Weekly report는 gallery fake apps의 id다.
const WEEKLY_REPORT = "app_01h455vb4pex5v6nkc6gd5fd14";
const BUDGET = "app_01h455vb4pex5v6nkc6gd5fa01";

const project = (
  id: string,
  title: string,
  identity: string,
  repo: "git" | "none",
  url?: string,
): ListedProject => ({
  id,
  title,
  archived: false,
  identity,
  repo,
  remote: url === undefined ? null : { key: url, url },
});

const app = (id: string, name: string) => ({ id, name, archived: false });

function lists(laptop: boolean): MachineLists[] {
  return [
    {
      machine: null,
      name: "",
      live: true,
      projects: [
        project(PHRONER, "phroner", PRI_PHRONER, "git"),
        project(
          GROCERY_BUDGET,
          "grocery-budget",
          "pri_01h455vb4pex5v6nkc6gd5fp02",
          "git",
        ),
        project(
          FIELD_NOTES,
          "Field notes",
          "pri_01h455vb4pex5v6nkc6gd5fp03",
          "none",
        ),
      ],
      apps: [app(WEEKLY_REPORT, "Weekly report")],
    },
    {
      machine: HOME_SERVER,
      name: "Home server",
      live: true,
      projects: [
        project(HS_PHRONER, "phroner", PRI_PHRONER, "git"),
        project(
          HS_GROCERY,
          "Grocery list",
          "pri_01h455vb4pex5v6nkc6gd5fp04",
          "git",
          "git@github.com:mina/grocery-list.git",
        ),
        project(
          HS_RECIPES,
          "Recipes",
          "pri_01h455vb4pex5v6nkc6gd5fp05",
          "none",
        ),
      ],
      apps: [app(WEEKLY_REPORT, "Weekly report"), app(BUDGET, "Budget")],
    },
    ...(laptop
      ? [
          {
            machine: LAPTOP,
            name: "Laptop",
            live: false,
            projects: [
              project(LT_PHRONER, "phroner", PRI_PHRONER, "git"),
              project(
                LT_SKETCH,
                "Sketchbook",
                "pri_01h455vb4pex5v6nkc6gd5fp06",
                "git",
                "git@github.com:mina/sketchbook.git",
              ),
            ],
            apps: [],
          },
        ]
      : []),
  ];
}

/** 기계마다의 목록을 합친 줄. Laptop을 넣으면 꺼진 기계의 줄도 선다. */
export function machineRows(laptop = false): MergedWorkspace[] {
  return mergeWorkspaces(lists(laptop), homeName);
}

type Row = readonly [
  machine: string | null,
  session: string,
  agent: string,
  workspace: { kind: "project" | "app"; id: string } | null,
  state: SessionEntry["state"],
  title: string,
  unseen?: boolean,
];

const SESSIONS: readonly Row[] = [
  [
    null,
    "ses_01h455vb4pex5v6nkc6gd5fs01",
    "lophn_home",
    null,
    "running",
    "Plan the week",
  ],
  [
    null,
    "ses_01h455vb4pex5v6nkc6gd5fs02",
    `lophn_${PHRONER}`,
    { kind: "project", id: PHRONER },
    "running",
    "Fix gaze interpolation",
  ],
  [
    HOME_SERVER,
    "ses_01h455vb4pex5v6nkc6gd5fs03",
    `lophn_${HS_PHRONER}`,
    { kind: "project", id: HS_PHRONER },
    "waiting",
    "Retrain the gaze model",
  ],
  [
    HOME_SERVER,
    "ses_01h455vb4pex5v6nkc6gd5fs04",
    "lophn_home",
    null,
    "running",
    "Weekly groceries",
  ],
  [
    HOME_SERVER,
    "ses_01h455vb4pex5v6nkc6gd5fs05",
    `lophn_${HS_GROCERY}`,
    { kind: "project", id: HS_GROCERY },
    "idle",
    "Price check",
    true,
  ],
  [
    HOME_SERVER,
    "ses_01h455vb4pex5v6nkc6gd5fs06",
    `lophn_${WEEKLY_REPORT}`,
    { kind: "app", id: WEEKLY_REPORT },
    "running",
    "Collect the numbers",
  ],
  [
    HOME_SERVER,
    "ses_01h455vb4pex5v6nkc6gd5fs07",
    `lophn_${BUDGET}`,
    { kind: "app", id: BUDGET },
    "idle",
    "Import March",
    true,
  ],
  [
    LAPTOP,
    "ses_01h455vb4pex5v6nkc6gd5fs08",
    `lophn_${LT_PHRONER}`,
    { kind: "project", id: LT_PHRONER },
    "running",
    "Sketch the loss curve",
  ],
  [
    LAPTOP,
    "ses_01h455vb4pex5v6nkc6gd5fs09",
    "lophn_home",
    null,
    "waiting",
    "Pack for the trip",
  ],
];

const LOPHN: SidebarAgent = {
  assignment: `lophn_${PHRONER}`,
  name: "lophn",
  profile: { kind: "character", shape: "square", color: "coral" },
  waiting: false,
};

// Home server의 터미널에서 도는 coding agent(`coding_sessions/list`가 준 줄). 둘째는 Home server의 화면에서 시작했고 이 창에 탭이
// 없다. 첫째는 이 컴퓨터의 phroner에 그 기계를 단 탭으로 열려 있다.
const coding = (
  at: string,
  harness: string,
  label: string,
  project: string,
  title: string,
  state: RemoteTerminal["state"],
): RemoteTerminal => ({
  machine: HOME_SERVER,
  session: `ses_01h455vb4pex5v6nkc6gd5fc${at}`,
  terminal: `trm_01h455vb4pex5v6nkc6gd5fc${at}`,
  harness,
  label,
  project,
  cwd: null,
  title,
  state,
  view: "tui",
  handoff: null,
  cli_session: null,
  last_active_at: null,
  switch: null,
});

export const TUNE = coding(
  "01",
  "claude",
  "Claude Code",
  HS_PHRONER,
  "Tune the eval thresholds",
  "running",
);
const LOADER = coding(
  "02",
  "codex",
  "Codex",
  HS_PHRONER,
  "Review the data loader",
  "waiting",
);
const DEDUPE = coding(
  "03",
  "claude",
  "Claude Code",
  HS_GROCERY,
  "Dedupe the shopping list",
  "idle",
);
/** 이 컴퓨터의 phroner에 열린 Tune 탭의 key. */
export const TUNE_TAB = "terminal-home-server-claude";

/** 그 workspace를 보는 창의 왼쪽 sidebar 줄. */
export function machineSidebar(
  current: WorkspaceRef,
  laptop = false,
): SidebarWorkspace[] {
  const rows = machineRows(laptop);
  const entries: OnMachine<SessionEntry>[] = SESSIONS.filter(
    ([machine]) => laptop || machine !== LAPTOP,
  ).map(([machine, session, agent, workspace, state, , unseen]) => ({
    machine,
    session,
    agent: agent as SessionEntry["agent"],
    workspace: workspace as SessionEntry["workspace"],
    state,
    archived: false,
    ended: null,
    unseen: unseen === true,
  }));
  return sidebarWorkspaces({
    now: Date.now(),
    current,
    rows,
    entries,
    offline: new Set(laptop ? [LAPTOP] : []),
    agents: [LOPHN],
    lophnNames: {},
    known: new Map(
      SESSIONS.map(([, session, , , , title]) => [session, { title, at: 0 }]),
    ),
    openTitles: new Map(),
    desks: new Map(),
    drafts: [],
    terminals: [],
    otherTerminals: new Map(),
    remoteTerminals: [TUNE, LOADER, DEDUPE],
    attached: new Map([[PHRONER, new Map([[TUNE.terminal, TUNE_TAB]])]]),
    workflows: [],
    hidden: new Map(),
  });
}

export const PHRONER_HERE: WorkspaceRef = { kind: "project", id: PHRONER };
export const GROCERY_THERE: WorkspaceRef = {
  kind: "project",
  id: HS_GROCERY,
  machine: HOME_SERVER,
};
export const HOME_THERE: WorkspaceRef = { kind: "home", machine: HOME_SERVER };
export const HOME_HERE: WorkspaceRef = { kind: "home" };
