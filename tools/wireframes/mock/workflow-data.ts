// workflow 화면 wireframe의 고정 data. 모양은 packages/protocol/workflows의 type 그대로다.
// wf-screen-source가 이 fixture를 workflow fake-source의 기본 목록으로 옮긴다(renderer가 tools/를 import하지 못한다).
import { formatRelativeTime } from "@lophn/wording";
import type {
  ReportLine,
  WorkflowEntry,
  WorkflowInstance,
  WorkflowInstanceSummary,
  WorkflowLine,
} from "../../../packages/protocol/workflows/mod.ts";

/** ReadWorkflowInstance 결과에서 화면이 쓰는 칸. */
export interface WorkflowDetail {
  readonly instance: WorkflowInstance;
  readonly last_reports: Readonly<Record<string, ReportLine>>;
  readonly lines: readonly WorkflowLine[];
}

/** 상대 시각의 기준. 고정이라 gallery를 언제 열어도 같은 글이 보인다. */
export const NOW = new Date("2026-10-22T09:30:00.000Z");

export const whenOf = (at: string) => formatRelativeTime(new Date(at), NOW);

const PROJECT = "prj_01h455vb4pex5v6nkc6gd5fd00";
const PM_SESSION = "ses_01h455vb4pex5v6nkc6gd5fd11";
const OP_SESSION = "ses_01h455vb4pex5v6nkc6gd5fd12";
const PM_SESSION_2 = "ses_01h455vb4pex5v6nkc6gd5fd13";

const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000).toISOString();

const PARTICIPANTS = {
  pm: { role: "project_manager", name: "Project Manager" },
  operator: { role: "operator", name: "Eval analyst" },
  human: { role: "human" },
} as const;

export const WORKFLOWS: readonly WorkflowEntry[] = [
  {
    key: "phroner/eval-loop",
    project: PROJECT,
    name: "eval-loop",
    state: "ok",
    kind: "agent",
    startable: true,
    problem: null,
    participants: PARTICIPANTS,
    steps: [
      { name: "plan", by: "pm", with: null, next: ["execute"] },
      { name: "execute", by: "operator", with: null, next: ["review"] },
      { name: "review", by: "human", with: "pm", next: ["report", "plan"] },
      { name: "report", by: "pm", with: null, next: ["end"] },
    ],
    artifacts: { static: true, instance: true },
  },
  {
    key: "phroner/paper-review",
    project: PROJECT,
    name: "paper-review",
    state: "ok",
    kind: "agent",
    startable: true,
    problem: null,
    participants: { pm: PARTICIPANTS.pm, human: PARTICIPANTS.human },
    steps: [{ name: "review", by: "human", with: "pm", next: ["end"] }],
    artifacts: { static: false, instance: false },
  },
  {
    key: "phroner/broken-draft",
    project: PROJECT,
    name: "broken-draft",
    state: "invalid",
    kind: null,
    startable: false,
    problem: {
      reason: "invalid_declaration",
      message: "steps.triage.by is missing. Every step needs a participant.",
    },
    participants: null,
    steps: null,
    artifacts: { static: false, instance: false },
  },
  {
    key: "phroner/nightly-flow",
    project: PROJECT,
    name: "nightly-flow",
    state: "ok",
    kind: "flow",
    startable: false,
    problem: {
      reason: "not_agent",
      message: "This workflow is a flow. Flows can't be started from here yet.",
    },
    participants: null,
    steps: null,
    artifacts: { static: false, instance: false },
  },
];

export const entryOf = (name: string): WorkflowEntry =>
  WORKFLOWS.find((entry) => entry.name === name)!;

const IDS = {
  running: "wfi_01h455vb4pex5v6nkc6gd5fd01",
  humanTurn: "wfi_01h455vb4pex5v6nkc6gd5fd02",
  ended: "wfi_01h455vb4pex5v6nkc6gd5fd03",
  stopped: "wfi_01h455vb4pex5v6nkc6gd5fd04",
  notHanded: "wfi_01h455vb4pex5v6nkc6gd5fd05",
  restarted: "wfi_01h455vb4pex5v6nkc6gd5fd06",
} as const;

const EVAL_STEPS = [
  {
    name: "plan",
    by: "pm",
    with: null,
    prompt:
      "Pick the next experiment from the open findings and write its plan.",
    in: "A short request from the user",
    out: "Path of the experiment plan",
    next: ["execute"],
  },
  {
    name: "execute",
    by: "operator",
    with: null,
    prompt: "Carry out the experiment from the plan and collect the results.",
    in: "Path of the experiment plan",
    out: "Path of the results folder",
    next: ["review"],
  },
  {
    name: "review",
    by: "human",
    with: "pm",
    prompt: "Go through the results with the user and agree on what they mean.",
    in: "Path of the results folder",
    out: "The agreed conclusion",
    next: ["report", "plan"],
  },
  {
    name: "report",
    by: "pm",
    with: null,
    prompt: "Write the conclusion into the findings document.",
    in: "The agreed conclusion",
    out: "",
    next: ["end"],
  },
] as const;

function instanceOf(
  id: string,
  input: string,
  state: WorkflowInstance["state"],
  current: WorkflowInstance["current"],
  startedMinutesAgo: number,
  finishedMinutesAgo: number | null,
): WorkflowInstance {
  return {
    id,
    project: PROJECT,
    workflow: "eval-loop",
    input,
    state,
    participants: PARTICIPANTS,
    steps: EVAL_STEPS.map((step) => ({ ...step, next: [...step.next] })),
    current,
    started_by: { kind: "user" },
    created_at: minutesAgo(startedMinutesAgo),
    finished_at: finishedMinutesAgo === null
      ? null
      : minutesAgo(finishedMinutesAgo),
    state_seq: "1",
  };
}

// 줄 모양 helper. 줄은 instance 안에서 1부터 이어 센다.
const lophn = { kind: "lophn" } as const;
const user = { kind: "user" } as const;
const agent = (session: string) => ({ kind: "agent", session }) as const;

function reportOf(
  instance: string,
  seq: number,
  minutes: number,
  session: string,
  step: string,
  text: string,
  next: string | null,
): ReportLine {
  return {
    instance,
    seq: String(seq),
    at: minutesAgo(minutes),
    by: agent(session),
    kind: "report",
    step,
    text,
    next,
    session: "new",
  };
}

function startLines(instance: string, input: string, minutes: number) {
  return [
    {
      instance,
      seq: "1",
      at: minutesAgo(minutes),
      by: user,
      kind: "started",
      step: "plan",
      text: input,
    },
    {
      instance,
      seq: "2",
      at: minutesAgo(minutes),
      by: lophn,
      kind: "handed",
      step: "plan",
      participant: "pm",
      receiver: PM_SESSION,
      human_turn: false,
      cause: "start",
      session: "new",
    },
  ] as const satisfies readonly WorkflowLine[];
}

const PLAN_TEXT =
  "Picked exp-013 (ftb quests 2). It is the cheapest to carry out and it covers the quest tools that were missing in exp-012. The plan is in eval/experiments/exp-013-ftb-quests-2.md.";
const RUN_TEXT =
  "Ran exp-013 on 24 scenarios. 19 passed, 5 failed, all five on quest lookups with more than one quest line. Results are in eval/results/exp-013. One attempt was retried twice because the fake server timed out, and I kept the second result. The raw logs are next to the results and each failure has a note with the tool calls that went wrong.";
const REVIEW_TEXT =
  "Agreed with the user: the quest tool needs a quest line argument. The failures are not model errors.";

// ---- running: plan 보고, execute 진행 중 ----
const runningInput =
  "Plan the next round of ftb quests experiments and start with the cheapest one";
const runningPlan = reportOf(
  IDS.running,
  3,
  14,
  PM_SESSION,
  "plan",
  PLAN_TEXT,
  "execute",
);
const running: WorkflowDetail = {
  instance: instanceOf(
    IDS.running,
    runningInput,
    "running",
    { step: "execute", human_turn: false },
    16,
    null,
  ),
  last_reports: { plan: runningPlan },
  lines: [
    ...startLines(IDS.running, runningInput, 16),
    runningPlan,
    {
      instance: IDS.running,
      seq: "4",
      at: minutesAgo(14),
      by: lophn,
      kind: "handed",
      step: "execute",
      participant: "operator",
      receiver: OP_SESSION,
      human_turn: false,
      cause: "report",
      session: "new",
    },
  ],
};

// ---- 사람 차례: review ----
const humanInput =
  "Check whether the chest-name fix holds on the full scenario set";
const humanPlan = reportOf(
  IDS.humanTurn,
  3,
  62,
  PM_SESSION,
  "plan",
  "Repeat exp-011 on the full scenario set with the chest-name fix. Plan: eval/experiments/exp-011.md.",
  "execute",
);
const humanRun = reportOf(
  IDS.humanTurn,
  5,
  25,
  OP_SESSION,
  "execute",
  RUN_TEXT,
  "review",
);
const humanTurn: WorkflowDetail = {
  instance: instanceOf(
    IDS.humanTurn,
    humanInput,
    "running",
    { step: "review", human_turn: true },
    70,
    null,
  ),
  last_reports: { plan: humanPlan, execute: humanRun },
  lines: [
    ...startLines(IDS.humanTurn, humanInput, 70),
    humanPlan,
    {
      instance: IDS.humanTurn,
      seq: "4",
      at: minutesAgo(62),
      by: lophn,
      kind: "handed",
      step: "execute",
      participant: "operator",
      receiver: OP_SESSION,
      human_turn: false,
      cause: "report",
      session: "new",
    },
    humanRun,
    {
      instance: IDS.humanTurn,
      seq: "6",
      at: minutesAgo(25),
      by: lophn,
      kind: "handed",
      step: "review",
      participant: "pm",
      receiver: PM_SESSION_2,
      human_turn: true,
      cause: "report",
      session: "new",
    },
  ],
};

// ---- ended ----
const endedInput =
  "Compare route planner results from this week against last week";
const endedPlan = reportOf(
  IDS.ended,
  3,
  300,
  PM_SESSION,
  "plan",
  "Compare exp-014 results across both weeks. No new pass is needed.",
  "execute",
);
const endedRun = reportOf(
  IDS.ended,
  5,
  280,
  OP_SESSION,
  "execute",
  "Collected both weeks. This week is 4 points better on route length.",
  "review",
);
const endedReview = reportOf(
  IDS.ended,
  7,
  250,
  PM_SESSION_2,
  "review",
  REVIEW_TEXT,
  "report",
);
const endedReport = reportOf(
  IDS.ended,
  9,
  240,
  PM_SESSION,
  "report",
  "Wrote the conclusion into loop/findings/F-012.md.",
  "end",
);
const ended: WorkflowDetail = {
  instance: instanceOf(IDS.ended, endedInput, "ended", null, 310, 240),
  last_reports: {
    plan: endedPlan,
    execute: endedRun,
    review: endedReview,
    report: endedReport,
  },
  lines: [
    ...startLines(IDS.ended, endedInput, 310),
    endedPlan,
    {
      instance: IDS.ended,
      seq: "4",
      at: minutesAgo(300),
      by: lophn,
      kind: "handed",
      step: "execute",
      participant: "operator",
      receiver: OP_SESSION,
      human_turn: false,
      cause: "report",
      session: "new",
    },
    endedRun,
    {
      instance: IDS.ended,
      seq: "6",
      at: minutesAgo(280),
      by: lophn,
      kind: "handed",
      step: "review",
      participant: "pm",
      receiver: PM_SESSION_2,
      human_turn: true,
      cause: "report",
      session: "new",
    },
    endedReview,
    {
      instance: IDS.ended,
      seq: "8",
      at: minutesAgo(250),
      by: lophn,
      kind: "handed",
      step: "report",
      participant: "pm",
      receiver: PM_SESSION,
      human_turn: false,
      cause: "report",
      session: "same",
    },
    endedReport,
    {
      instance: IDS.ended,
      seq: "10",
      at: minutesAgo(240),
      by: lophn,
      kind: "ended",
    },
  ],
};

// ---- stopped: execute 도중에 사람이 멈춤 ----
const stoppedInput = "Try the new schedule tools on the slow scenarios";
const stoppedPlan = reportOf(
  IDS.stopped,
  3,
  190,
  PM_SESSION,
  "plan",
  "Try exp-005 on the slow scenarios only. Plan: eval/experiments/exp-005.md.",
  "execute",
);
const stopped: WorkflowDetail = {
  instance: instanceOf(
    IDS.stopped,
    stoppedInput,
    "stopped",
    { step: "execute", human_turn: false },
    200,
    170,
  ),
  last_reports: { plan: stoppedPlan },
  lines: [
    ...startLines(IDS.stopped, stoppedInput, 200),
    stoppedPlan,
    {
      instance: IDS.stopped,
      seq: "4",
      at: minutesAgo(190),
      by: lophn,
      kind: "handed",
      step: "execute",
      participant: "operator",
      receiver: OP_SESSION,
      human_turn: false,
      cause: "report",
      session: "new",
    },
    {
      instance: IDS.stopped,
      seq: "5",
      at: minutesAgo(170),
      by: user,
      kind: "stopped",
    },
  ],
};

// ---- not_handed: PM이 review 담당을 고쳤는데 참가자가 없다 ----
const notHandedInput =
  "Look into why the recipe lookup scenarios flip between attempts";
const notHandedPlan = reportOf(
  IDS.notHanded,
  3,
  40,
  PM_SESSION,
  "plan",
  "Do three passes of exp-007 on the same scenarios and compare the tool calls.",
  "execute",
);
const notHandedRun = reportOf(
  IDS.notHanded,
  5,
  22,
  OP_SESSION,
  "execute",
  "Three passes done. The flips come from the order of two read tools. Results are in eval/results/exp-007.",
  "review",
);
const notHanded: WorkflowDetail = {
  instance: instanceOf(
    IDS.notHanded,
    notHandedInput,
    "running",
    { step: "execute", human_turn: false },
    55,
    null,
  ),
  last_reports: { plan: notHandedPlan, execute: notHandedRun },
  lines: [
    ...startLines(IDS.notHanded, notHandedInput, 55),
    notHandedPlan,
    {
      instance: IDS.notHanded,
      seq: "4",
      at: minutesAgo(40),
      by: lophn,
      kind: "handed",
      step: "execute",
      participant: "operator",
      receiver: OP_SESSION,
      human_turn: false,
      cause: "report",
      session: "new",
    },
    notHandedRun,
    {
      instance: IDS.notHanded,
      seq: "6",
      at: minutesAgo(22),
      by: lophn,
      kind: "not_handed",
      step: "review",
      reason: "no_with",
      message:
        "Step review is a human step but has no with. Add a participant that can talk with the user.",
    },
  ],
};

// ---- lophn_restarted: execute 메시지를 turn이 가져가기 전에 lophn이 꺼졌다 켜짐 ----
const restartedInput =
  "Re-check the inventory read scenarios after the schema change";
const restartedPlan = reportOf(
  IDS.restarted,
  3,
  95,
  PM_SESSION,
  "plan",
  "Repeat exp-006 now that the inventory schema has the new field.",
  "execute",
);
const restarted: WorkflowDetail = {
  instance: instanceOf(
    IDS.restarted,
    restartedInput,
    "running",
    { step: "execute", human_turn: false },
    100,
    null,
  ),
  last_reports: { plan: restartedPlan },
  lines: [
    ...startLines(IDS.restarted, restartedInput, 100),
    restartedPlan,
    {
      instance: IDS.restarted,
      seq: "4",
      at: minutesAgo(95),
      by: lophn,
      kind: "handed",
      step: "execute",
      participant: "operator",
      receiver: OP_SESSION,
      human_turn: false,
      cause: "report",
      session: "new",
    },
    {
      instance: IDS.restarted,
      seq: "5",
      at: minutesAgo(30),
      by: lophn,
      kind: "lophn_restarted",
      step: "execute",
      receiver: OP_SESSION,
    },
  ],
};

/** eval-loop의 instance. 새것이 앞이다. */
export const EVAL_DETAILS: readonly WorkflowDetail[] = [
  running,
  humanTurn,
  notHanded,
  restarted,
  ended,
  stopped,
];

export const DETAILS = {
  running,
  humanTurn,
  ended,
  stopped,
  notHanded,
  restarted,
} as const;

export function summaryOf(detail: WorkflowDetail): WorkflowInstanceSummary {
  const { instance, lines } = detail;
  return {
    id: instance.id,
    project: instance.project,
    workflow: instance.workflow,
    state: instance.state,
    current: instance.current,
    input: instance.input,
    created_at: instance.created_at,
    finished_at: instance.finished_at,
    last_line: lines.at(-1) ?? null,
  };
}

/** 새것이 앞인 목록. */
export const EVAL_SUMMARIES: readonly WorkflowInstanceSummary[] = [
  ...EVAL_DETAILS,
].sort((a, b) => b.instance.created_at.localeCompare(a.instance.created_at))
  .map(summaryOf);

/** workflow마다 도는 instance 수. */
export const RUNNING_COUNTS: Readonly<Record<string, number>> = {
  "eval-loop":
    EVAL_DETAILS.filter((detail) => detail.instance.state === "running").length,
};
