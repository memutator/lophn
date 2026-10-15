// Agent 탭의 새 부품들이 그리는 고정 데이터. 보낸 쪽, call, 질문, 승인 요청, rewind, 권한 보기는 모두 여기서 온다.
// 화면 글은 영어이고, 화면에 call·accepted 같은 안쪽 낱말을 그대로 내지 않는다.

// ---- 보낸 쪽 ----

/** 받은 메시지를 보낸 쪽. 사람이 직접 쓴 메시지는 여기에 없다. */
export type Sender =
  | { readonly kind: "agent"; readonly role: string; readonly name: string }
  | { readonly kind: "reaction"; readonly event: string }
  | { readonly kind: "coding"; readonly product: string }
  | { readonly kind: "program"; readonly label: string };

/** 맡긴 글의 근거 링크. */
export interface EvidenceRef {
  readonly kind: "ticket" | "problem" | "file";
  readonly text: string;
}

/** chip을 누르면 panel에 읽어 보이는 것. */
export interface Envelope {
  readonly sender: Sender;
  /** 맡긴 글. */
  readonly task: string;
  readonly refs: readonly EvidenceRef[];
  /** 보낸 session. program이 보낸 것은 없다. */
  readonly session?: string;
}

export function senderLabel(sender: Sender): string {
  switch (sender.kind) {
    case "agent":
      return sender.role === sender.name
        ? sender.role
        : `${sender.role} · ${sender.name}`;
    case "reaction":
      return `Reaction · ${sender.event}`;
    case "coding":
      return `Coding agent · ${sender.product}`;
    case "program":
      return sender.label;
  }
}

export const EVIDENCE_KIND: Record<EvidenceRef["kind"], string> = {
  ticket: "Ticket",
  problem: "Problem",
  file: "File",
};

/** 다른 agent가 맡긴 일. */
export const FROM_LOPHN: Envelope = {
  sender: { kind: "agent", role: "lophn", name: "lophn" },
  task:
    "Keep the scenario names in Eval board as they are. A person asked for that, so do not rename them in the fix.",
  refs: [{ kind: "problem", text: "P-12 Eval board keeps crashing on start" }],
  session: "Weekly report",
};

/** program의 reaction. */
export const FROM_REACTION: Envelope = {
  sender: { kind: "reaction", event: "App stopped restarting" },
  task:
    "Eval board crashed 5 times in 2 minutes, so lophn stopped restarting it. Look at the problem and decide what to do.",
  refs: [{ kind: "problem", text: "P-12 Eval board keeps crashing on start" }],
};

/** coding agent의 메시지. */
export const FROM_CODING: Envelope = {
  sender: { kind: "coding", product: "Claude Code" },
  task:
    "I finished the lookup change and the checks pass. Do you want the scenario names kept as they are?",
  refs: [
    { kind: "ticket", text: "T-31 Retry the recipe lookup once" },
    { kind: "file", text: "src/lookup.ts" },
  ],
  session: "Claude Code · Eval board",
};

/** 보낸 session에 돌아온 답. */
export const FROM_OPERATOR: Envelope = {
  sender: { kind: "agent", role: "Operator", name: "Eval analyst" },
  task:
    "The 3 regressions share one cause: query-recipe-gap, sched-edit and wake-plant all call the lookup right after a plan edit.",
  refs: [{ kind: "file", text: "eval/experiments/exp-008-query-tools.md" }],
  session: "Regression on query-recipe-gap",
};

/** 받은 session이 답 없이 끝났을 때 돌아온 알림. */
export const FROM_FAILED: Envelope = {
  sender: { kind: "program", label: "lophn · Not answered" },
  task:
    "The session of Operator · Experiment planner ended before it answered your request.",
  refs: [],
};

// ---- 보낸 session의 call 블록 ----

export type CallState = "accepted" | "done" | "failed" | "cancelled";
export type ReplyMode = "none" | "result" | "conversation";
export type FailReason = "receiver_ended" | "closed" | "not_allowed";

export interface CallView {
  /** 받는 곳. */
  readonly to: string;
  /** 맡긴 글 한 줄. */
  readonly task: string;
  readonly reply: ReplyMode;
  readonly state: CallState;
  readonly reason?: FailReason;
  readonly time: string;
}

export const REPLY_TEXT: Record<ReplyMode, string> = {
  none: "No answer expected",
  result: "Answer expected",
  conversation: "Back and forth",
};

export const CALL_OPEN: CallView = {
  to: "Operator · Eval analyst",
  task: "Find what the 3 regressions have in common.",
  reply: "result",
  state: "accepted",
  time: "09:44",
};

export const CALL_DONE: CallView = { ...CALL_OPEN, state: "done" };

export const CALL_FAILED: CallView = {
  to: "Operator · Experiment planner",
  task: "Plan exp-013 so it isolates the recipe lookup.",
  reply: "result",
  state: "failed",
  reason: "receiver_ended",
  time: "09:46",
};

export const CALL_CANCELLED: CallView = {
  to: "Project Manager · phroner",
  task: "Check the eval context against the new reports.",
  reply: "result",
  state: "cancelled",
  time: "09:47",
};

// ---- 질문 ----

export interface QuestionOption {
  readonly label: string;
  readonly description: string;
}

export interface AskedQuestion {
  readonly id: string;
  /** 짧은 header. 답한 뒤 요약에도 쓴다. */
  readonly header: string;
  readonly question: string;
  readonly options: readonly QuestionOption[];
  readonly multiSelect: boolean;
}

export const ASKED: readonly AskedQuestion[] = [
  {
    id: "place",
    header: "Report place",
    question: "Where should the weekly report go?",
    multiSelect: false,
    options: [
      {
        label: "docs/reports/",
        description: "Next to last week's reports",
      },
      {
        label: "eval/reports/",
        description: "Inside the eval folder",
      },
      {
        label: "A new file each week",
        description: "Named by date, no fixed folder",
      },
    ],
  },
  {
    id: "sections",
    header: "Sections",
    question: "Which sections should the report have?",
    multiSelect: true,
    options: [
      {
        label: "Improvements",
        description: "Scenarios that got better",
      },
      {
        label: "Regressions",
        description: "Each one with its scenario",
      },
      {
        label: "Next experiments",
        description: "What to try next week",
      },
    ],
  },
];

/** 답한 뒤 접힌 요약의 줄. */
export interface QuestionAnswer {
  readonly header: string;
  readonly answer: string;
}

export const ANSWERS: readonly QuestionAnswer[] = [
  { header: "Report place", answer: "docs/reports/" },
  { header: "Sections", answer: "Improvements, Regressions" },
];

// ---- 승인 요청 ----

/** program이 intent에서 만든 카드 내용. 요청한 agent가 쓴 설명은 없다. */
export interface ApprovalContent {
  readonly title: string;
  readonly target: string;
  readonly input: string;
  readonly effect: string;
}

export const APPROVAL_MCP: ApprovalContent = {
  title: "github › create_issue",
  target: "MCP tool create_issue of the github server",
  input:
    '{ "repo": "phroner/harness",\n  "title": "query-recipe-gap regressed",\n  "labels": ["eval"] }',
  effect:
    "Creates an issue on github.com. It happens outside lophn, so Rewind cannot undo it.",
};

export const APPROVAL_SETTINGS: ApprovalContent = {
  title: "LOPHN.md",
  target: "LOPHN.md, the instructions of phroner",
  input:
    "  Ask before you rewrite a report that is already published.\n+ Put every new report in docs/reports/.",
  effect:
    "Every agent in phroner reads this file, so they all follow the new line from their next turn.",
};

/** 결정 뒤 대화에 남는 줄. */
export type ApprovalOutcome = "received" | "applied" | "denied" | "cancelled";

export interface ApprovalResultView {
  readonly outcome: ApprovalOutcome;
  readonly title: string;
  readonly detail: string;
}

export const APPROVAL_RESULTS: readonly ApprovalResultView[] = [
  {
    outcome: "received",
    title: "github › create_issue",
    detail: "You allowed it for this session. lophn is running it now.",
  },
  {
    outcome: "applied",
    title: "Change LOPHN.md",
    detail: "You allowed it. The new line is in LOPHN.md.",
  },
  {
    outcome: "denied",
    title: "github › create_issue",
    detail: "You denied it: “The issue already exists as #212.”",
  },
  {
    outcome: "cancelled",
    title: "github › create_issue",
    detail: "The work stopped before you decided. This is not a denial.",
  },
];

// ---- rewind ----

export interface RewindWrite {
  readonly time: string;
  readonly text: string;
  /** 결과를 모르는 write는 되돌릴 수 없다. */
  readonly unknown?: boolean;
}

export interface RewindApp {
  readonly name: string;
  /** 이 session이 고른 시점 뒤에 한 write. */
  readonly writes: readonly RewindWrite[];
  /** 함께 되돌아가는 다른 변경(다른 session이나 사람이 한 것). */
  readonly others: readonly { readonly by: string; readonly text: string }[];
  /** 되돌아가지 않는 external 효과. */
  readonly outside: readonly string[];
}

export const REWIND_POINT =
  "Write this week's eval report from the new findings.";

export const REWIND_FILES: readonly string[] = [
  "docs/reports/2026-w41.md",
  "docs/reports/index.md",
];

export const REWIND_APPS: readonly RewindApp[] = [
  {
    name: "Eval board",
    writes: [
      { time: "09:44", text: "start_run for week 41" },
      { time: "09:49", text: "add_note on query-recipe-gap" },
    ],
    others: [
      { by: "Eval analyst", text: "tag_regression on sched-edit, 09:52" },
      { by: "You", text: "edited a scenario in the app, 09:55" },
    ],
    outside: ["Sent the run summary by email to 3 people at 09:49"],
  },
  {
    name: "Scenario tracker",
    writes: [
      { time: "09:47", text: "import_scenarios from eval/scenarios" },
      {
        time: "09:48",
        text: "rename_scenario wake-plant",
        unknown: true,
      },
    ],
    others: [],
    outside: [],
  },
];

// ---- 권한 ----

export type GrantSetting = "allow" | "ask" | "deny";

export interface GrantRow {
  readonly target: string;
  readonly effect: string;
  readonly setting: GrantSetting;
}

/** lophn이 agent grant로 받은 것. */
export const GRANTS: readonly GrantRow[] = [
  { target: "Eval board app-apis", effect: "Read", setting: "allow" },
  { target: "Eval board app-apis", effect: "Write", setting: "allow" },
  { target: "Eval board app-apis", effect: "Outside lophn", setting: "ask" },
  { target: "github MCP tools", effect: "Read only", setting: "allow" },
  { target: "github MCP tools", effect: "Other tools", setting: "ask" },
  { target: "Other agents", effect: "Hand over a task", setting: "allow" },
  { target: "LOPHN.md", effect: "Change", setting: "ask" },
];

export const SETTING_TEXT: Record<GrantSetting, string> = {
  allow: "Runs without asking",
  ask: "Asks first",
  deny: "Not allowed",
};

/** 이 session에서 "이 session 동안"으로 허락한 대상. */
export const SESSION_ALLOWED: readonly string[] = [
  "github › create_issue",
];

/** composer 아래 한 줄. */
export function grantSummary(): string {
  const count = (setting: GrantSetting) =>
    GRANTS.filter((row) => row.setting === setting).length;
  return `Permissions: ${count("allow")} run freely · ${
    count("ask")
  } ask first · ${SESSION_ALLOWED.length} allowed in this session`;
}

// ---- recap ----

export const RECAP: readonly string[] = [
  "You asked for this week's eval report. lophn read 3 findings and started a run on Eval board.",
  "F-011 is a regression on query-recipe-gap. The board shows 3 failed scenarios.",
  "Still open: the exp-008 numbers you asked to add, and the last edit of docs/reports/2026-w41.md.",
];
