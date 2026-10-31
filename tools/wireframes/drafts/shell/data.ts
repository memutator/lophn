// shell draft의 고정 data. Home·project·app place 셋이 같은 shell(왼쪽 place·session, 가운데 tab, 오른쪽 panel)을 쓴다.

import type { TabDot } from "../../../../packages/shell/renderer/parts/tab-state-dot/tab-state-dot.tsx";
import type { Vendor } from "../../../../packages/shell/renderer/parts/vendor-icon/vendor-icon.tsx";

export type PlaceKind = "home" | "project" | "app";

/** session을 맡은 agent. lophn agent는 avatar, coding agent는 vendor 아이콘으로 보인다. */
export type AgentRef =
  | {
      readonly kind: "lophn";
      readonly name: string;
      readonly shape: "square" | "round" | "pear";
      readonly color: "coral" | "blue" | "lavender";
    }
  | { readonly kind: "coding"; readonly name: string; readonly vendor: Vendor };

export const LOPHN_AGENT: AgentRef = {
  kind: "lophn",
  name: "lophn",
  shape: "square",
  color: "coral",
};
const REVIEWER: AgentRef = {
  kind: "lophn",
  name: "reviewer",
  shape: "round",
  color: "blue",
};
const WRITER: AgentRef = {
  kind: "lophn",
  name: "writer",
  shape: "pear",
  color: "lavender",
};
export const CLAUDE_CODE: AgentRef = {
  kind: "coding",
  name: "Claude Code",
  vendor: "claude",
};
const CODEX: AgentRef = { kind: "coding", name: "Codex", vendor: "openai" };
const OPENCODE: AgentRef = {
  kind: "coding",
  name: "opencode",
  vendor: "opencode",
};

/** 새 session 메뉴의 agent 목록. */
export const NEW_SESSION_AGENTS: readonly AgentRef[] = [
  LOPHN_AGENT,
  REVIEWER,
  WRITER,
  CLAUDE_CODE,
  CODEX,
  OPENCODE,
];

export interface SessionRow {
  readonly id: string;
  readonly title: string;
  readonly when: string;
  readonly agent: AgentRef;
  /** 이 창에 tab으로 열려 있거나 돌고 있다. 없으면 Recent다. */
  readonly current?: boolean;
  readonly dot?: TabDot;
}

export interface PlaceRow {
  readonly id: string;
  readonly kind: PlaceKind;
  readonly name: string;
  readonly count: number;
  readonly sessions: readonly SessionRow[];
}

export const PLACES: readonly PlaceRow[] = [
  {
    id: "home",
    kind: "home",
    name: "Home",
    count: 6,
    sessions: [
      {
        id: "h1",
        title: "거래처 미팅 정리 앱 기획",
        when: "now",
        agent: LOPHN_AGENT,
        current: true,
        dot: "working",
      },
      { id: "h2", title: "이번 주 할 일 정리", when: "2h", agent: LOPHN_AGENT },
      {
        id: "h3",
        title: "주간 회고 초안",
        when: "Oct 29",
        agent: WRITER,
      },
    ],
  },
  {
    id: "phroner",
    kind: "project",
    name: "phroner",
    count: 37,
    sessions: [
      {
        id: "p1",
        title: "body-refactor 이어 받기",
        when: "now",
        agent: LOPHN_AGENT,
        current: true,
      },
      {
        id: "c1",
        title: "gaze 보간 고치기",
        when: "now",
        agent: CLAUDE_CODE,
        current: true,
        dot: "waiting",
      },
      {
        id: "r1",
        title: "PR #42 검토",
        when: "10m",
        agent: REVIEWER,
        current: true,
        dot: "finished",
      },
      {
        id: "p2",
        title: "달리기 시선 처리 확인",
        when: "5h",
        agent: LOPHN_AGENT,
      },
      {
        id: "c2",
        title: "forge cache 경로 바꾸기",
        when: "1d",
        agent: CODEX,
      },
      {
        id: "p3",
        title: "Plan 072대로 작업 진행",
        when: "Oct 30",
        agent: LOPHN_AGENT,
      },
    ],
  },
  {
    id: "mahas",
    kind: "app",
    name: "MaHas",
    count: 5,
    sessions: [
      {
        id: "a1",
        title: "패턴 heatmap 색 고치기",
        when: "now",
        agent: LOPHN_AGENT,
        current: true,
      },
      {
        id: "a2",
        title: "Grok Build 한도 읽기",
        when: "1d",
        agent: LOPHN_AGENT,
      },
      {
        id: "a3",
        title: "계정 추가 dialog 다듬기",
        when: "Oct 27",
        agent: LOPHN_AGENT,
      },
    ],
  },
  {
    id: "growph",
    kind: "project",
    name: "growph",
    count: 12,
    sessions: [
      {
        id: "c3",
        title: "lint 규칙 정리",
        when: "Oct 25",
        agent: OPENCODE,
      },
    ],
  },
  { id: "calendar", kind: "app", name: "Calendar", count: 3, sessions: [] },
];

export type TabKind = "chat" | "coding" | "file" | "terminal" | "app";

export interface TabRow {
  readonly id: string;
  readonly kind: TabKind;
  readonly title: string;
  /** 가운데 card 위 줄의 경로. */
  readonly crumbs: readonly string[];
  /** chat·coding tab을 맡은 agent. 없으면 lophn이다. */
  readonly agent?: AgentRef;
  readonly dot?: TabDot;
}

/** tab 줄의 한 칸. split이 있으면 두 tab이 한 칸으로 붙고 card가 좌우로 나뉜다(Chrome Split View). */
export interface StripItem {
  readonly id: string;
  readonly tab: TabRow;
  readonly split?: TabRow;
}

/** desk 하나가 자기 tab 줄, 접힌 float, 떠 있는 float을 통째로 가진다. */
export interface DeskScene {
  readonly key: string;
  readonly label: string;
  readonly workflow?: boolean;
  readonly status?: string;
  /** 사람 차례라 Current에 올라온다. */
  readonly live?: boolean;
  readonly items: readonly StripItem[];
  readonly active: string;
  /** 접힌 float. tab 줄 오른쪽 끝에 아이콘 칸으로 보인다. */
  readonly minimized: readonly TabRow[];
  /** minimized 중 지금 펴서 card 위에 떠 있는 것. */
  readonly floating?: readonly string[];
}

export type PanelKey =
  | "files"
  | "places"
  | "jobs"
  | "domain"
  | "artifact"
  | "workflow"
  | "app"
  | "logs";

export interface Scene {
  readonly place: string;
  readonly session: string;
  readonly desks: readonly DeskScene[];
  readonly desk: string;
  readonly panels: readonly PanelKey[];
  readonly panel: PanelKey;
  readonly left?: boolean;
  readonly right?: boolean;
  /** Recent를 펼쳐 둔 place. */
  readonly expanded?: readonly string[];
}

const single = (tab: TabRow): StripItem => ({ id: tab.id, tab });

const tab = (
  id: string,
  kind: TabKind,
  title: string,
  ...crumbs: string[]
): TabRow => ({ id, kind, title, crumbs: [...crumbs, title] });

const H1 = tab("t-h1", "chat", "거래처 미팅 정리 앱 기획", "Home");
const H2 = tab("t-h2", "chat", "이번 주 할 일 정리", "Home");
const IDEAS = tab("t-ideas", "file", "ideas.md", "Home", "notes");

const P1 = tab("t-p1", "chat", "body-refactor 이어 받기", "phroner");
const P2 = tab("t-p2", "chat", "달리기 시선 처리 확인", "phroner");
const README = tab("t-readme", "file", "README.md", "phroner");
const PLAN = tab("t-plan", "file", "072-architecture.md", "phroner", "plan");
const POSE = tab("t-pose", "file", "pose.ts", "phroner", "body");
const TERM = tab("t-term", "terminal", "zsh", "phroner");
const DEV = tab("t-dev", "terminal", "npm run dev", "phroner");
const REL = tab("t-rel", "chat", "release 검토 · step 2", "phroner");
const CHANGELOG = tab("t-changelog", "file", "CHANGELOG.md", "phroner");
const WEEKLY = tab("t-weekly", "chat", "주간 정리", "phroner");

const C1: TabRow = {
  ...tab("t-c1", "coding", "gaze 보간 고치기", "phroner"),
  agent: CLAUDE_CODE,
  dot: "waiting",
};

const APP: TabRow = {
  id: "t-app",
  kind: "app",
  title: "MaHas",
  crumbs: ["MaHas", "한도"],
};
const A1 = tab("t-a1", "chat", "패턴 heatmap 색 고치기", "MaHas");

const PROJECT_DEFAULT: DeskScene = {
  key: "_default",
  label: "Main",
  items: [single(P1), single(C1), single(README), single(PLAN), single(TERM)],
  active: "t-p1",
  minimized: [P2, DEV, POSE],
};

const R1: TabRow = {
  ...tab("t-r1", "chat", "PR #42 검토", "phroner"),
  agent: REVIEWER,
  dot: "finished",
};

const PROJECT_REVIEW: DeskScene = {
  key: "review",
  label: "리뷰용",
  items: [single(R1), single(CHANGELOG)],
  active: "t-r1",
  minimized: [],
};

const PROJECT_RELEASE: DeskScene = {
  key: "release",
  label: "release 검토",
  workflow: true,
  status: "step 2/4 · 사람 차례",
  live: true,
  items: [single(REL), single(CHANGELOG)],
  active: "t-rel",
  minimized: [],
};

const PROJECT_WEEKLY: DeskScene = {
  key: "weekly",
  label: "주간 정리",
  workflow: true,
  status: "끝남 · Oct 30",
  items: [single(WEEKLY)],
  active: "t-weekly",
  minimized: [],
};

const PROJECT_PANELS: readonly PanelKey[] = [
  "files",
  "domain",
  "artifact",
  "workflow",
  "jobs",
];

export const HOME_SCENE: Scene = {
  place: "home",
  session: "h1",
  desks: [
    {
      key: "_default",
      label: "Main",
      items: [single(H1), single(H2), single(IDEAS)],
      active: "t-h1",
      minimized: [],
    },
  ],
  desk: "_default",
  panels: ["places", "files", "jobs"],
  panel: "places",
};

export const PROJECT_SCENE: Scene = {
  place: "phroner",
  session: "p1",
  desks: [PROJECT_DEFAULT, PROJECT_REVIEW, PROJECT_RELEASE, PROJECT_WEEKLY],
  desk: "_default",
  panels: PROJECT_PANELS,
  panel: "files",
  expanded: ["phroner"],
};

export const FLOAT_SCENE: Scene = {
  ...PROJECT_SCENE,
  desks: [
    { ...PROJECT_DEFAULT, active: "t-readme", floating: ["t-p2", "t-dev"] },
    PROJECT_REVIEW,
    PROJECT_RELEASE,
    PROJECT_WEEKLY,
  ],
};

export const SPLIT_SCENE: Scene = {
  ...PROJECT_SCENE,
  desks: [
    {
      ...PROJECT_DEFAULT,
      items: [{ id: "s-p1", tab: P1, split: C1 }, single(README), single(PLAN)],
      active: "s-p1",
    },
    PROJECT_REVIEW,
    PROJECT_RELEASE,
    PROJECT_WEEKLY,
  ],
};

export const DESK_SCENE: Scene = {
  ...PROJECT_SCENE,
  session: "",
  desk: "release",
  panel: "workflow",
};

export const APP_SCENE: Scene = {
  place: "mahas",
  session: "a1",
  desks: [
    {
      key: "_default",
      label: "Main",
      items: [single(APP), single(A1)],
      active: "t-app",
      minimized: [],
    },
  ],
  desk: "_default",
  panels: ["app", "files", "domain", "logs"],
  panel: "app",
};

export const APP_SPLIT_SCENE: Scene = {
  ...APP_SCENE,
  desks: [
    {
      key: "_default",
      label: "Main",
      items: [{ id: "s-app", tab: APP, split: A1 }],
      active: "s-app",
      minimized: [],
    },
  ],
  right: false,
};

export interface Message {
  readonly role: "user" | "agent";
  readonly text: string;
}

export const CHATS: Readonly<Record<string, readonly Message[]>> = {
  "t-h1": [
    {
      role: "user",
      text: "거래처 미팅 끝나면 메모를 정리해서 다음 할 일까지 뽑아 주는 앱을 하나 만들고 싶어.",
    },
    {
      role: "agent",
      text: [
        "좋습니다. 먼저 이 앱이 맡을 일을 셋으로 나눠 봤습니다.",
        "",
        "1. **미팅 기록**: 거래처, 날짜, 참석자, 메모 원문",
        "2. **할 일 뽑기**: 메모에서 담당·기한이 있는 줄만 골라 목록으로",
        "3. **거래처 이력**: 거래처마다 지난 미팅과 남은 할 일",
        "",
        "거래처 목록은 이미 `crm` project의 domain에 있으니 새로 만들지 않고 그 tool을 참조하겠습니다. 이 셋으로 앱을 만들까요?",
      ].join("\n"),
    },
    { role: "user", text: "응, 이름은 Meetings로 하자." },
    {
      role: "agent",
      text: "Meetings 앱을 만들고 첫 화면(미팅 목록)부터 짓겠습니다. 만든 뒤 오른쪽 **Places**에 나타납니다.",
    },
  ],
  "t-h2": [
    { role: "user", text: "이번 주 할 일 정리해 줘." },
    {
      role: "agent",
      text: "Jobs와 열린 workflow를 모아 보면 이번 주에 남은 일은 넷입니다.",
    },
  ],
  "t-p1": [
    {
      role: "user",
      text: "1, 2는 무시하고 일단 계획 파일에 상태 업데이트 되어 있어? 다음 작업자가 이어 받을 수 있게끔?",
    },
    {
      role: "agent",
      text: [
        "네, 이제 이어 받을 수 있게 되어 있습니다.",
        "",
        "- **끝난 것**: T0, T1, T2와 protocol 판 올리기가 main에 들어갔습니다",
        "- **다음 할 일**: T3부터. 순서는 T3 → T4 → T5 → T6 → T8 → T9",
        "- **이어 받는 법**: 계획 문서 맨 위 상태 줄을 보고 `현재 상태` 절로 갑니다",
        "",
        "계획 문서와 `plan/` 폴더는 git이 추적하지 않으니 이 폴더에서 읽어야 합니다.",
      ].join("\n"),
    },
  ],
  "t-p2": [
    { role: "user", text: "달리면서 고개 돌릴 때 시선이 튀는 거 확인해 줘." },
    {
      role: "agent",
      text: "`gaze/track.ts`에서 속도가 빠를 때 보간을 건너뜁니다. 고친 안을 만들어 둘까요?",
    },
  ],
  "t-rel": [
    {
      role: "agent",
      text: [
        "**release 검토 · step 2/4**: 사람 차례입니다.",
        "",
        "- step 1 build와 test는 통과했습니다",
        "- 이번 판에서 바뀐 것은 `CHANGELOG.md`에 정리했습니다",
        "",
        "내용을 보고 승인하시면 step 3(태그 달기)로 넘기겠습니다.",
      ].join("\n"),
    },
  ],
  "t-r1": [
    {
      role: "agent",
      text: "PR #42를 봤습니다. `gaze/track.ts`의 보간 조건이 반대로 들어가 있어서 한 곳만 고치면 됩니다. 나머지는 괜찮습니다.",
    },
  ],
  "t-weekly": [
    { role: "agent", text: "이번 주 정리를 끝냈습니다. 남은 일은 없습니다." },
  ],
  "t-a1": [
    {
      role: "user",
      text: "패턴 탭 heatmap이 너무 어두워서 칸이 안 보여. 많이 쓴 칸이 더 잘 보이게 해 줘.",
    },
    {
      role: "agent",
      text: "heatmap 색 단계를 5개로 늘리고 가장 많이 쓴 칸만 accent 색으로 칠한 preview를 만들었습니다. 왼쪽 앱 화면에서 패턴 탭을 눌러 확인해 주세요. 괜찮으면 release하겠습니다.",
    },
  ],
};

export const DOCS: Readonly<Record<string, string>> = {
  "t-ideas": [
    "# ideas",
    "",
    "- 거래처 미팅 정리 앱 → Meetings",
    "- 영수증 사진에서 지출 뽑기",
    "- 주간 회고 template",
  ].join("\n"),
  "t-readme": [
    "# phroner",
    "",
    "몸과 시선을 다루는 실험용 game engine.",
    "",
    "## 구조",
    "",
    "- `body/`: 관절과 자세",
    "- `gaze/`: 시선 처리",
    "- `forge/`: 공용 build 도구",
    "",
    "## 시작",
    "",
    "```",
    "npm install",
    "npm run dev",
    "```",
  ].join("\n"),
  "t-pose": [
    "```ts",
    "export function pose(joints: Joint[], t: number): Pose {",
    "  return joints.map((joint) => rotate(joint, t));",
    "}",
    "```",
  ].join("\n"),
  "t-changelog": [
    "# 0.9.0",
    "",
    "- body: 관절 회전을 quaternion으로",
    "- gaze: 빠르게 돌 때 보간 건너뛰기 고침",
    "- forge: build cache 경로 바꿈",
  ].join("\n"),
  "t-plan": [
    "# 072 architecture ownership",
    "",
    "상태: T3 진행 전",
    "",
    "## 현재 상태",
    "",
    "T0~T2 merge. 다음은 T3.",
  ].join("\n"),
};

export const CODING_LINES: readonly string[] = [
  "╭──────────────────────────────────────────╮",
  "│ ✻ Claude Code        ~/projects/phroner  │",
  "╰──────────────────────────────────────────╯",
  "",
  "> gaze/track.ts 빠르게 돌 때 보간 건너뛰는 거 고쳐 줘",
  "",
  "● Read(gaze/track.ts)",
  "  ⎿  Read 84 lines",
  "",
  "● Update(gaze/track.ts)",
  "  ⎿  Updated gaze/track.ts with 6 additions and 2 removals",
  "",
  "● Bash(npm run test -- gaze)",
  "  ⎿  14 passed",
  "",
  " Do you want to commit these changes?",
  " ❯ 1. Yes",
  "   2. No, keep editing",
];

export const DEV_LINES: readonly string[] = [
  "~/projects/phroner main ❯ npm run dev",
  "",
  "  VITE ready in 412 ms",
  "  ➜  Local:   http://localhost:5173/",
  "",
  "  12:04:18 hmr update /body/pose.ts",
];

export const TERMINAL_LINES: readonly string[] = [
  "~/projects/phroner main ❯ npm run test -- body",
  "",
  " ✓ body/joint_test.ts (12)",
  " ✓ body/pose_test.ts (8)",
  "",
  " Test Files  2 passed (2)",
  "      Tests  20 passed (20)",
  "",
  "~/projects/phroner main ❯ ",
];

export interface FileNode {
  readonly name: string;
  readonly depth: number;
  readonly folder?: boolean;
  readonly open?: boolean;
  readonly active?: boolean;
}

export const PROJECT_FILES: readonly FileNode[] = [
  { name: ".github", depth: 0, folder: true },
  { name: "body", depth: 0, folder: true, open: true },
  { name: "joint.ts", depth: 1 },
  { name: "pose.ts", depth: 1 },
  { name: "joint_test.ts", depth: 1 },
  { name: "forge", depth: 0, folder: true },
  { name: "gaze", depth: 0, folder: true },
  { name: "plan", depth: 0, folder: true, open: true },
  { name: "072-architecture.md", depth: 1 },
  { name: "package.json", depth: 0 },
  { name: "README.md", depth: 0, active: true },
  { name: "tsconfig.json", depth: 0 },
];

export const HOME_FILES: readonly FileNode[] = [
  { name: "notes", depth: 0, folder: true, open: true },
  { name: "ideas.md", depth: 1, active: true },
  { name: "weekly.md", depth: 1 },
  { name: "inbox", depth: 0, folder: true },
  { name: "README.md", depth: 0 },
];

export const APP_FILES: readonly FileNode[] = [
  { name: "src", depth: 0, folder: true, open: true },
  { name: "ui", depth: 1, folder: true, open: true },
  { name: "App.tsx", depth: 2 },
  { name: "QuotaTab.tsx", depth: 2, active: true },
  { name: "PatternTab.tsx", depth: 2 },
  { name: "ops", depth: 1, folder: true },
  { name: "migrations", depth: 0, folder: true },
  { name: "lophn.blueprint.ts", depth: 0 },
  { name: "main.ts", depth: 0 },
  { name: "deno.json", depth: 0 },
];

export interface ListRow {
  readonly title: string;
  readonly meta: string;
  readonly kind?: PlaceKind;
  readonly live?: boolean;
}

export const OVERVIEW_PROJECTS: readonly ListRow[] = [
  { title: "phroner", meta: "~/projects/phroner", kind: "project" },
  { title: "growph", meta: "~/projects/growph", kind: "project" },
  { title: "crm", meta: "~/work/crm", kind: "project" },
];

export const OVERVIEW_APPS: readonly ListRow[] = [
  { title: "MaHas", meta: "v7 · 오늘 3번 씀", kind: "app", live: true },
  { title: "Calendar", meta: "v4 · 어제", kind: "app" },
  { title: "Meetings", meta: "짓는 중", kind: "app", live: true },
];

export const JOBS: readonly ListRow[] = [
  { title: "아침 메일 요약", meta: "매일 08:00 · Home" },
  { title: "주간 한도 리포트", meta: "월 09:00 · MaHas" },
  { title: "의존성 점검", meta: "금 18:00 · phroner" },
];

export const DOMAINS: readonly ListRow[] = [
  { title: "body", meta: "관절과 자세 · tool 6" },
  { title: "gaze", meta: "시선 처리 · tool 3" },
];

export const ARTIFACTS: readonly ListRow[] = [
  { title: "REPORT-ko.md", meta: "body-refactor 이어 받기 · now" },
  { title: "pose-diagram.svg", meta: "달리기 시선 처리 확인 · 5h" },
];

export const WORKFLOWS: readonly ListRow[] = [
  { title: "release 검토", meta: "step 2/4 · 사람 차례", live: true },
  { title: "주간 정리", meta: "끝남 · Oct 30" },
];

export const LOGS: readonly ListRow[] = [
  { title: "refresh_quota ok", meta: "12:04 · 8 계정 · 1.2s" },
  { title: "read_usage ok", meta: "12:03 · 41ms" },
  { title: "refresh_quota failed: unauthorized", meta: "11:58 · Cline" },
];

export const APP_INFO: readonly ListRow[] = [
  { title: "Release", meta: "v7 · 어제 18:20" },
  { title: "Preview", meta: "heatmap 색 · 준비됨" },
  { title: "Domain", meta: "usage, quota" },
  { title: "Grant", meta: "~/.claude, ~/.codex 읽기 · network" },
];
