// Lophn Workspace, 런처, Settings 화면이 같이 쓰는 고정 데이터.

export interface SubfolderInfo {
  /** 등록 폴더 기준 상대 경로. */
  readonly path: string;
  readonly description: string;
}

export interface FolderInfo {
  readonly path: string;
  readonly description: string;
  /** 등록 폴더 안에서 따로 설명을 단 하위 폴더. */
  readonly subfolders?: readonly SubfolderInfo[];
}

export interface ProjectInfo {
  readonly id: string;
  readonly name: string;
  readonly purpose: string;
  readonly folders: readonly FolderInfo[];
}

export const PROJECTS: readonly ProjectInfo[] = [
  {
    id: "phroner",
    name: "phroner",
    purpose: "Evaluate and improve the harness loop.",
    folders: [
      {
        path: "/home/mina/work/phroner",
        description: "Harness code and eval runs",
        subfolders: [
          { path: "eval/", description: "Experiment runs and results" },
          { path: "src/harness/", description: "The harness loop code" },
          { path: "docs/", description: "Design notes for the loop" },
        ],
      },
      {
        path: "/home/mina/notes/phroner",
        description: "Reading notes and papers",
      },
    ],
  },
  {
    id: "grocery-budget",
    name: "grocery-budget",
    purpose: "Keep the monthly food spending under the plan.",
    folders: [
      {
        path: "/home/mina/budget",
        description: "Monthly sheets and receipts",
      },
    ],
  },
];

export const ARCHIVED_PROJECTS: readonly { name: string; purpose: string }[] = [
  { name: "old-notes", purpose: "Notes from the 2025 course." },
];

/** 사라진 폴더를 보이는 page가 쓰는 폴더. */
export const MISSING_FOLDER = "/home/mina/notes/phroner";

export type RunState = "running" | "stopped" | "preparing" | "unavailable";

export interface AppInfo {
  readonly name: string;
  readonly run: RunState;
}

export const APPS: readonly AppInfo[] = [
  { name: "Grocery budget", run: "running" },
  { name: "Quarter planner", run: "stopped" },
  { name: "Reading list", run: "running" },
  { name: "Weekly report", run: "unavailable" },
];

export const ARCHIVED_APPS: readonly string[] = ["Habit tracker"];

export type CodingMark = "good" | "warning" | "critical" | "neutral";

export interface CodingProduct {
  readonly name: string;
  /** 실행 파일. 못 찾으면 null. */
  readonly executable: string | null;
  readonly version: string | null;
  readonly signIn: { readonly tone: CodingMark; readonly label: string };
  readonly turnEnd: { readonly tone: CodingMark; readonly label: string };
  /** 첫 prompt를 넘길 수 있는지. */
  readonly handOff: {
    readonly tone: CodingMark;
    readonly label: string;
    readonly note?: string;
  };
  readonly skill: {
    readonly tone: CodingMark;
    readonly label: string;
    readonly note?: string;
  };
}

const NONE = { tone: "neutral", label: "-" } as const;

export const CODING_PRODUCTS: readonly CodingProduct[] = [
  {
    name: "Claude Code",
    executable: "/usr/local/bin/claude",
    version: "2.1.4",
    signIn: { tone: "good", label: "Signed in" },
    turnEnd: { tone: "good", label: "Has signal" },
    handOff: { tone: "good", label: "Ready" },
    skill: { tone: "good", label: "Installed" },
  },
  {
    name: "Codex",
    executable: "/home/mina/.npm-global/bin/codex",
    version: "0.58.0",
    signIn: { tone: "good", label: "Signed in" },
    turnEnd: { tone: "good", label: "Has signal" },
    handOff: { tone: "good", label: "Ready" },
    skill: {
      tone: "critical",
      label: "Install failed",
      note: "The skill folder is not writable.",
    },
  },
  {
    name: "Gemini CLI",
    executable: "/usr/local/bin/gemini",
    version: "0.9.2",
    signIn: { tone: "warning", label: "Not signed in" },
    turnEnd: {
      tone: "warning",
      label: "No signal",
    },
    handOff: {
      tone: "good",
      label: "Ready",
      note: "First prompt only. Follow-up messages are not sent.",
    },
    skill: { tone: "good", label: "Installed" },
  },
  {
    name: "OpenCode",
    executable: "/home/mina/.opencode/bin/opencode",
    version: "1.4.0",
    signIn: { tone: "good", label: "Signed in" },
    turnEnd: { tone: "good", label: "Has signal" },
    handOff: { tone: "good", label: "Ready" },
    skill: { tone: "good", label: "Installed" },
  },
  {
    name: "pi",
    executable: "/usr/local/bin/pi",
    version: "0.7.1",
    signIn: { tone: "good", label: "Signed in" },
    turnEnd: { tone: "warning", label: "No signal" },
    handOff: {
      tone: "critical",
      label: "Can't take a task",
      note:
        "The first prompt can't be passed on the command line or after the session starts.",
    },
    skill: { tone: "good", label: "Installed" },
  },
  {
    name: "Hermes",
    executable: null,
    version: null,
    signIn: NONE,
    turnEnd: NONE,
    handOff: NONE,
    skill: NONE,
  },
];

export type ReactionMode = "off" | "open" | "ask";

export interface ReactionItem {
  readonly id: string;
  readonly event: string;
  readonly when: string;
  readonly opens: string;
  readonly mode: ReactionMode;
}

/** 새 일을 여는 domain event 다섯. */
export const REACTIONS: readonly ReactionItem[] = [
  {
    id: "problem-opened",
    event: "Problem opened",
    when: "An app reports a problem for the first time.",
    opens: "A new session for that app's App Engineer.",
    mode: "open",
  },
  {
    id: "problem-reopened",
    event: "Problem reopened",
    when: "A problem marked resolved shows up again in the active release.",
    opens: "A new session for that app's App Engineer.",
    mode: "ask",
  },
  {
    id: "restart-halted",
    event: "App restart halted",
    when: "An app kept crashing and lophn stopped restarting it.",
    opens: "A new session for that app's App Engineer.",
    mode: "open",
  },
  {
    id: "activation-failed",
    event: "Activation failed",
    when: "A new release could not be activated.",
    opens: "A new session for that release's App Engineer.",
    mode: "open",
  },
  {
    id: "context-violation",
    event: "Context violation",
    when:
      "A project gets a context violation it did not have at the last check.",
    opens: "A new session for that project's Project Manager.",
    mode: "off",
  },
];

export interface DiagnosticItem {
  readonly name: string;
  readonly available: boolean;
  /** 안전한 불가 이유. 경로나 key를 담지 않는다. */
  readonly reason: string | null;
  readonly checkedAt: string;
}

export const DIAGNOSTICS: readonly DiagnosticItem[] = [
  {
    name: "Core service",
    available: true,
    reason: null,
    checkedAt: "10:42:07",
  },
  {
    name: "Ledger",
    available: true,
    reason: null,
    checkedAt: "10:42:07",
  },
  {
    name: "Event stream",
    available: true,
    reason: null,
    checkedAt: "10:42:07",
  },
  {
    name: "App runtime",
    available: true,
    reason: null,
    checkedAt: "10:42:08",
  },
  {
    name: "Sandbox",
    available: false,
    reason: "The sandbox could not be set up on this system.",
    checkedAt: "10:42:08",
  },
  {
    name: "Agent runtime",
    available: false,
    reason: "No model is available. Connect a provider and choose a model.",
    checkedAt: "10:42:08",
  },
  {
    name: "Terminal",
    available: true,
    reason: null,
    checkedAt: "10:42:09",
  },
];
