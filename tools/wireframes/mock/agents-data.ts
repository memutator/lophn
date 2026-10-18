// agent 화면의 고정 데이터와, 데이터에서 탭을 만드는 작은 함수들. phroner 예시 project의 lophn·Project
// Manager·Operator 둘과 agent별 session, `/` 명령이다. model과 option은 models-data.ts(catalog)에서만 온다.
import type { ModelSelection } from "./model-options.ts";
import type { TabSpec } from "../pages/screens/project-window.tsx";
import type { FakePicker } from "../../../packages/shell/renderer/conversation/agent-tab-fake-source.ts";

/** Weekly report session의 진행. report는 일이 끝난 모양이고 나머지는 사람을 기다리거나 답한 뒤다. */
type ChatStage = "report" | "question" | "answered" | "approval";

/** model picker를 연 채 시작할지. refresh는 연 뒤 첫 [Refresh models]까지 누른다. */
type ModelDemo = "picker" | "refresh";

/** session switcher를 어떻게 연 채 시작할지. edit는 이름 고치기 input과 삭제 확인을 같이 보인다. */
type SwitcherDemo = "open" | "edit";

/** Agent 탭을 어떤 모양으로 열지. page마다 한 상태를 고정해 보이는 데 쓴다. */
export interface ChatInit {
  readonly stage?: ChatStage;
  /** 새 session의 agent 이름. */
  readonly agent?: string;
  /** composer의 model picker를 연 채 시작한다. */
  readonly modelDemo?: ModelDemo;
  /** model picker가 보이는 provider와 model의 상태. */
  readonly picker?: FakePicker;
  /** agent header의 session switcher를 연 채 시작한다. */
  readonly switcher?: SwitcherDemo;
  /** 입력칸에 이 글자를 넣고 시작한다("/"나 "/co"면 명령 메뉴가 열린다). */
  readonly slash?: string;
  /** composer가 처음 가리키는 model. 없으면 `SESSION_MODEL`이다. */
  readonly model?: ModelSelection;
  /** `/` 명령이 대화 화면에 낸 보기를 연 채 시작한다. */
  readonly view?: "permissions" | "recap";
}

/** agent profile의 icon. 사용자가 올린 이미지는 icon 대신 image다. */
type AvatarIconKey =
  | "dock"
  | "roles"
  | "contexts"
  | "documents"
  | "apps"
  | "search"
  | "series"
  | "bookmark"
  | "terminal"
  | "read"
  | "edit"
  | "compare";

export interface AgentProfile {
  readonly icon: AvatarIconKey;
  /** 사용자가 올린 이미지를 쓴다(icon은 이미지를 지우면 돌아갈 값). */
  readonly image?: boolean;
}

export interface AgentRow {
  readonly id: string;
  readonly name: string;
  readonly operator?: boolean;
  readonly profile: AgentProfile;
}

/** sidebar Agents 묶음의 줄. "operators"는 줄이 아니라 아래 Operator들의 작은 머리다. */
export const AGENT_ROWS: readonly AgentRow[] = [
  { id: "lophn", name: "lophn", profile: { icon: "dock" } },
  { id: "engineer", name: "Project Manager", profile: { icon: "contexts" } },
  {
    id: "operators",
    name: "Operators",
    operator: true,
    profile: { icon: "roles" },
  },
  {
    id: "eval-analyst",
    name: "Eval analyst",
    operator: true,
    profile: { icon: "read", image: true },
  },
  {
    id: "experiment-planner",
    name: "Experiment planner",
    operator: true,
    profile: { icon: "compare" },
  },
];

export const profileOf = (name: string): AgentProfile =>
  AGENT_ROWS.find((row) => row.name === name)?.profile ??
    { icon: "dock" };

const nameOf = (id: string) =>
  AGENT_ROWS.find((row) => row.id === id)?.name ?? "lophn";

// ---- session ----

type SessionState = "waiting" | "working" | "idle";

export interface SessionRow {
  readonly id: string;
  readonly agent: string;
  readonly title: string;
  readonly when: string;
  readonly state: SessionState;
  readonly group: "today" | "earlier" | "archived";
  /** 탭의 `sub`. 없으면 `conv:<id>`. */
  readonly sub?: string;
}

/** agent별 session. switcher는 그 agent의 것만 보인다. */
export const SESSIONS: readonly SessionRow[] = [
  {
    id: "weekly",
    agent: "lophn",
    title: "Weekly report",
    when: "2 min ago",
    state: "waiting",
    group: "today",
    sub: "weekly",
  },
  {
    id: "harness",
    agent: "lophn",
    title: "Harness change summary",
    when: "12 min ago",
    state: "working",
    group: "today",
  },
  {
    id: "release-check",
    agent: "lophn",
    title: "Release notes check",
    when: "3 h ago",
    state: "idle",
    group: "today",
  },
  {
    id: "c049",
    agent: "lophn",
    title: "Findings about C-049",
    when: "2 days ago",
    state: "idle",
    group: "earlier",
  },
  {
    id: "eval-questions",
    agent: "lophn",
    title: "Eval loop questions",
    when: "last week",
    state: "idle",
    group: "earlier",
  },
  {
    id: "old-1",
    agent: "lophn",
    title: "Docs folder cleanup",
    when: "3 weeks ago",
    state: "idle",
    group: "archived",
  },
  {
    id: "old-2",
    agent: "lophn",
    title: "First eval run",
    when: "last month",
    state: "idle",
    group: "archived",
  },
  {
    id: "old-3",
    agent: "lophn",
    title: "Naming the harness",
    when: "last month",
    state: "idle",
    group: "archived",
  },
  {
    id: "release-ctx",
    agent: "Project Manager",
    title: "Release notes context",
    when: "yesterday",
    state: "idle",
    group: "earlier",
    sub: "engineer",
  },
  {
    id: "failing",
    agent: "Project Manager",
    title: "Failing scenarios",
    when: "12 min ago",
    state: "working",
    group: "today",
  },
  {
    id: "board-crash",
    agent: "App Engineer",
    title: "Eval board keeps crashing",
    when: "2 min ago",
    state: "working",
    group: "today",
  },
  {
    id: "week41",
    agent: "Eval analyst",
    title: "Week 41 summary",
    when: "1 h ago",
    state: "idle",
    group: "today",
  },
  {
    id: "recipe-gap",
    agent: "Eval analyst",
    title: "Regression on query-recipe-gap",
    when: "3 days ago",
    state: "idle",
    group: "earlier",
  },
  {
    id: "next-experiments",
    agent: "Experiment planner",
    title: "Next experiments for query tools",
    when: "1 h ago",
    state: "idle",
    group: "today",
  },
  {
    id: "exp-013",
    agent: "Experiment planner",
    title: "Plan for exp-013",
    when: "last week",
    state: "idle",
    group: "earlier",
  },
];

export const sessionsOf = (agent: string): readonly SessionRow[] =>
  SESSIONS.filter((row) => row.agent === agent);

let fresh = 0;

/** sidebar에서 agent를 눌러 여는 새 Agent 탭. 누를 때마다 새 탭이다. */
export function newConversationTab(agent: string): TabSpec {
  fresh += 1;
  const name = nameOf(agent);
  return {
    key: `agent:${agent}:${fresh}`,
    kind: "agent",
    title: `New session · ${name}`,
    sub: "new",
    chat: { agent: name },
  };
}

/** session을 여는 탭. */
export function sessionTab(row: SessionRow, chat?: ChatInit): TabSpec {
  const sub = row.sub ?? `conv:${row.id}`;
  return {
    key: `conv:${row.id}`,
    kind: "agent",
    title: `${row.title} · ${row.agent}`,
    sub,
    chat: chat ?? (row.id === "weekly" ? { stage: "question" } : undefined),
  };
}

export const weeklyTab = (chat?: ChatInit): TabSpec => ({
  key: "conv:weekly",
  kind: "agent",
  title: "Weekly report · lophn",
  sub: "weekly",
  chat: chat ?? { stage: "question" },
});

/** 작업 중인 lophn session(`/` 메뉴에서 명령이 다음 turn에 들어간다고 보이는 page가 쓴다). */
export const workingTab = (chat?: ChatInit): TabSpec =>
  sessionTab(SESSIONS.find((row) => row.id === "harness")!, chat);

export const AGENTS_TAB: TabSpec = {
  key: "agents",
  kind: "agents",
  title: "phroner · Agents",
};

// ---- `/` 명령 ----
