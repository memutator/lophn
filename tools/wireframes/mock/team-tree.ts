// 팀(spawn tree)이 도는 project의 왼쪽 sidebar. coordinator 하나가 자식 둘을 열었고 그중 하나가 손자 하나를 열었다. agent가 연 탭의
// 주인은 연 session이라 coordinator는 자식 둘의 대화 탭과 자기가 연 browser 탭(접힌 float)과 artifact 탭의 주인이다. 줄은 renderer의
// 순수 함수(`layoutDesks`, `sidebarWorkspaces`)가 이 layout과 session에서 짓는다.
import type { SessionEntry } from "../../../packages/shell/renderer/desktop/connection/events/sessions-store.ts";
import type { OnMachine } from "../../../packages/shell/renderer/desktop/machines/data.ts";
import type { MachineWorkspace } from "../../../packages/shell/renderer/desktop/workspaces/projects/machine-workspaces.ts";
import {
  emptyDesk,
  MAIN_DESK,
  type TabItem,
  type WorkspaceLayout,
  workspaceKey,
  type WorkspaceRef,
} from "../../../packages/shell/renderer/shell/desk-model.ts";
import type { SidebarWorkspace } from "../../../packages/shell/renderer/shell/left-sidebar-model.ts";
import {
  layoutDesks,
  sidebarWorkspaces,
} from "../../../packages/shell/renderer/shell/left-sidebar-workspaces.ts";
import type { SidebarAgent } from "../../../packages/shell/renderer/workspace/sidebar/sidebar-agent.ts";

// gallery fake projects의 phroner.
const PHRONER = "prj_01h455vb4pex5v6nkc6gd5fd01";
export const TEAM_PROJECT: WorkspaceRef = { kind: "project", id: PHRONER };
const LOPHN_ID = `lophn_${PHRONER}`;

/** coordinator. 펼친 줄이다. */
export const COORDINATOR = "ses_01h455vb4pex5v6nkc6gd5ft01";
const WRITER = "ses_01h455vb4pex5v6nkc6gd5ft02";
const CHECKER = "ses_01h455vb4pex5v6nkc6gd5ft03";
const LINKS = "ses_01h455vb4pex5v6nkc6gd5ft04";
// 팀 밖의 session. 맨 위 단계에 선다.
const SOLO = "ses_01h455vb4pex5v6nkc6gd5ft05";

const LOPHN: SidebarAgent = {
  assignment: LOPHN_ID,
  name: "lophn",
  profile: { kind: "character", shape: "square", color: "coral" },
  waiting: false,
};

// session id, 제목, 부모, 상태.
const SESSIONS: readonly (readonly [
  string,
  string,
  string | null,
  SessionEntry["state"],
])[] = [
  [COORDINATOR, "Ship the 0.24 release notes", null, "running"],
  [WRITER, "Draft the changelog", COORDINATOR, "running"],
  [CHECKER, "Check the upgrade steps", COORDINATOR, "idle"],
  [LINKS, "Verify the doc links", WRITER, "waiting"],
  [SOLO, "Fix flaky retry in the runner", null, "idle"],
];

const agentTab = (
  session: string,
  title: string,
  owner: string | null,
): TabItem => ({
  key: `agent:${LOPHN_ID}:${session.slice(-8)}`,
  kind: "agent",
  title,
  ...(owner === null ? {} : { owner }),
  fields: { agent: LOPHN_ID, workspace: PHRONER, session },
});

const RELEASE_DRAFT: TabItem = {
  key: "host:tab_01h455vb4pex5v6nkc6gd5ft11",
  kind: "browser",
  title: "Release draft · GitHub",
  owner: COORDINATOR,
  fields: { url: "https://github.com/phroner/phroner/releases/new" },
};

const NOTES: TabItem = {
  key: "host:tab_01h455vb4pex5v6nkc6gd5ft12",
  kind: "artifact",
  title: "release-notes.md",
  owner: COORDINATOR,
};

// 사람이 coordinator를 열었고, 나머지 대화 탭은 연 session이 주인이다.
const MAIN_TABS: readonly TabItem[] = [
  ...SESSIONS.map(([session, title, parent]) =>
    agentTab(session, title, parent),
  ),
  NOTES,
];

const LAYOUT: WorkspaceLayout = {
  active: MAIN_DESK,
  desks: {
    [MAIN_DESK]: {
      ...emptyDesk(MAIN_DESK, "Main"),
      tabs: MAIN_TABS,
      selected: MAIN_TABS[0]!.key,
      floats: [
        {
          tab: RELEASE_DRAFT,
          rect: { x: 320, y: 80, width: 640, height: 480 },
          minimized: true,
          pinned: false,
        },
      ],
    },
  },
};

const ROWS: readonly MachineWorkspace[] = [
  { ref: { kind: "home" }, name: "Home", also: [], offline: false },
  { ref: TEAM_PROJECT, name: "phroner", also: [], offline: false },
];

/** project 창의 왼쪽 sidebar 줄. */
export function teamSidebar(): SidebarWorkspace[] {
  const entries: OnMachine<SessionEntry>[] = SESSIONS.map(
    ([session, , parent, state]) => ({
      machine: null,
      session,
      state,
      archived: false,
      ended: null,
      agent: LOPHN_ID as SessionEntry["agent"],
      workspace: { kind: "project", id: PHRONER },
      spawnedBy: parent,
      unseen: false,
    }),
  );
  const here = workspaceKey(TEAM_PROJECT);
  return sidebarWorkspaces({
    now: Date.now(),
    current: TEAM_PROJECT,
    rows: ROWS,
    entries,
    offline: new Set(),
    agents: [LOPHN],
    lophnNames: {},
    known: new Map(
      SESSIONS.map(([session, title]) => [session, { title, at: 0 }]),
    ),
    openTitles: new Map([
      [here, new Map(SESSIONS.map(([session, title]) => [session, title]))],
    ]),
    desks: new Map([[here, layoutDesks(LAYOUT)]]),
    drafts: [],
    terminals: [],
    otherTerminals: new Map(),
    remoteTerminals: [],
    attached: new Map(),
    workflows: [],
    hidden: new Map(),
  });
}
