// WorkspaceSource의 메모리 구현. dev seed와 화면 시험이 쓴다. 연결 폴더 둘(하위 폴더 하나 포함)과 폴더별
// 파일 tree를 갖고, `list(path)`가 폴더 한 단계씩 돌려준다. 문서 목록은 비어 있고 layout은 저장만 받는다.
import {
  createLayoutSource,
  memoryWorkspaceLayoutBridge,
} from "../shell/layout-source.ts";
import { fakeFileSearchSource } from "./search/fake-source.ts";
import type {
  FolderEntry,
  ProjectFolderView,
  ReadResult,
  WorkflowEntryView,
  WorkflowInstanceDetailView,
  WorkflowInstanceSummaryView,
  WorkflowInstanceView,
  WorkflowLineBy,
  WorkflowLineView,
  WorkflowStartedBy,
  WorkflowState,
  WorkspaceSource,
} from "./source.ts";

/** 파일 tree 한 노드. `children`이 있으면 폴더다. */
type Node = { readonly name: string; readonly children?: readonly Node[] };

const file = (name: string): Node => ({ name });
const folder = (name: string, ...children: Node[]): Node => ({
  name,
  children,
});

export const FAKE_PROJECT_FOLDER = "/home/mina/work/phroner";
export const FAKE_NOTES_FOLDER = "/home/mina/notes/phroner";

const PHRONER: readonly Node[] = [
  folder("assets", file("chest-layout.png")),
  folder("docs", file("notes.md")),
  folder(
    "eval",
    folder(
      "experiments",
      file("exp-008-query-tools.md"),
      file("exp-012-ftb-quests-021-q8.md"),
    ),
    folder("rubrics", file("query-hygiene.json")),
    folder("scenarios", folder("query-leave-still", file("r1.yaml"))),
  ),
  folder("loop", folder("findings", file("F-009.md"), file("F-010.md"))),
  folder("reports", file("weekly-12.pdf")),
  file("LOPHN.md"),
];

const NOTES: readonly Node[] = [
  folder("meetings", file("2026-10-12.md"), file("2026-10-05.md")),
  file("ideas.md"),
  file("todo.md"),
];

// 승인한 workflow wireframe의 fixture다. gallery의 workflow page도 이것을 쓴다. 시각은
// 고정 기준(2026-10-22T09:30Z)에서 센다.
const FAKE_NOW = new Date("2026-10-22T09:30:00.000Z");

type ReportLine = Extract<WorkflowLineView, { kind: "report" }>;

const PROJECT = "prj_01h455vb4pex5v6nkc6gd5fd00";
const LOPHN_SESSION = "ses_01h455vb4pex5v6nkc6gd5fd11";
const ANALYST_SESSION = "ses_01h455vb4pex5v6nkc6gd5fd12";
const LOPHN_SESSION_2 = "ses_01h455vb4pex5v6nkc6gd5fd13";

const minutesAgo = (minutes: number) =>
  new Date(FAKE_NOW.getTime() - minutes * 60_000).toISOString();

const PARTICIPANTS = {
  lophn: { agent: "lophn" },
  analyst: { agent: "Eval analyst" },
  human: { kind: "human" },
} as const;

const FLOW_STEPS = ["fetch", "summarize", "publish"] as const;

export const FAKE_WORKFLOWS: readonly WorkflowEntryView[] = [
  {
    key: "phroner/eval-loop",
    project: PROJECT,
    name: "eval-loop",
    invalid: false,
    kind: "agent",
    startable: true,
    problem: null,
    steps: [
      { name: "plan", by: "lophn", with: null, next: ["execute"] },
      { name: "execute", by: "analyst", with: null, next: ["review"] },
      { name: "review", by: "human", with: "lophn", next: ["report", "plan"] },
      { name: "report", by: "lophn", with: null, next: ["end"] },
    ],
    artifacts: { static: true, instance: true },
  },
  {
    key: "phroner/paper-review",
    project: PROJECT,
    name: "paper-review",
    invalid: false,
    kind: "agent",
    startable: true,
    problem: null,
    steps: [{ name: "review", by: "human", with: "lophn", next: ["end"] }],
    artifacts: { static: false, instance: false },
  },
  {
    key: "phroner/broken-draft",
    project: PROJECT,
    name: "broken-draft",
    invalid: true,
    kind: null,
    startable: false,
    problem: {
      reason: "invalid_declaration",
      message: "steps.triage.by is missing. Every step needs a participant.",
    },
    steps: null,
    artifacts: { static: false, instance: false },
  },
  {
    key: "phroner/nightly-flow",
    project: PROJECT,
    name: "nightly-flow",
    invalid: false,
    kind: "flow",
    startable: true,
    problem: null,
    steps: FLOW_STEPS.map((name) => ({
      name,
      by: "program",
      with: null,
      next: [],
    })),
    artifacts: { static: false, instance: false },
  },
  {
    key: "phroner/missing-flow",
    project: PROJECT,
    name: "missing-flow",
    invalid: false,
    kind: "flow",
    startable: false,
    problem: {
      reason: "no_flow_file",
      message: "flow.ts is missing in the workflow folder.",
    },
    steps: null,
    artifacts: { static: false, instance: false },
  },
];

const IDS = {
  running: "wfi_01h455vb4pex5v6nkc6gd5fd01",
  humanTurn: "wfi_01h455vb4pex5v6nkc6gd5fd02",
  ended: "wfi_01h455vb4pex5v6nkc6gd5fd03",
  stopped: "wfi_01h455vb4pex5v6nkc6gd5fd04",
  notHanded: "wfi_01h455vb4pex5v6nkc6gd5fd05",
  restarted: "wfi_01h455vb4pex5v6nkc6gd5fd06",
  flowRunning: "wfi_01h455vb4pex5v6nkc6gd5fd07",
  flowExited: "wfi_01h455vb4pex5v6nkc6gd5fd08",
  flowRestarted: "wfi_01h455vb4pex5v6nkc6gd5fd09",
} as const;

const EVAL_STEPS = [
  {
    name: "plan",
    by: "lophn",
    with: null,
    prompt:
      "Pick the next experiment from the open findings and write its plan.",
    in: "A short request from the user",
    out: "Path of the experiment plan",
    next: ["execute"],
  },
  {
    name: "execute",
    by: "analyst",
    with: null,
    prompt: "Carry out the experiment from the plan and collect the results.",
    in: "Path of the experiment plan",
    out: "Path of the results folder",
    next: ["review"],
  },
  {
    name: "review",
    by: "human",
    with: "lophn",
    prompt: "Go through the results with the user and agree on what they mean.",
    in: "Path of the results folder",
    out: "The agreed conclusion",
    next: ["report", "plan"],
  },
  {
    name: "report",
    by: "lophn",
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
  state: WorkflowState,
  current: WorkflowInstanceView["current"],
  startedMinutesAgo: number,
  finishedMinutesAgo: number | null,
  startedBy: WorkflowStartedBy = { kind: "user" },
): WorkflowInstanceView {
  return {
    id,
    project: PROJECT,
    workflow: "eval-loop",
    input,
    state,
    participants: PARTICIPANTS,
    steps: EVAL_STEPS.map((step) => ({ ...step, next: [...step.next] })),
    current,
    started_by: startedBy,
    created_at: minutesAgo(startedMinutesAgo),
    finished_at:
      finishedMinutesAgo === null ? null : minutesAgo(finishedMinutesAgo),
  };
}

// 줄 모양 helper. 줄은 instance 안에서 1부터 이어 센다.
const lophn = { kind: "lophn" } as const;
const program = { kind: "program" } as const;
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

// flow의 report는 program이 낸다.
function programReportOf(
  instance: string,
  seq: number,
  minutes: number,
  step: string,
  text: string,
): ReportLine {
  return {
    instance,
    seq: String(seq),
    at: minutesAgo(minutes),
    by: program,
    kind: "report",
    step,
    text,
    next: null,
    session: "new",
  };
}

function startLines(
  instance: string,
  input: string,
  minutes: number,
  by: WorkflowLineBy = user,
) {
  return [
    {
      instance,
      seq: "1",
      at: minutesAgo(minutes),
      by,
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
      participant: "lophn",
      receiver: LOPHN_SESSION,
      human_turn: false,
      cause: "start",
      session: "new",
    },
  ] as const satisfies readonly WorkflowLineView[];
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
  LOPHN_SESSION,
  "plan",
  PLAN_TEXT,
  "execute",
);
const running: WorkflowInstanceDetailView = {
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
      participant: "analyst",
      receiver: ANALYST_SESSION,
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
  LOPHN_SESSION,
  "plan",
  "Repeat exp-011 on the full scenario set with the chest-name fix. Plan: eval/experiments/exp-011.md.",
  "execute",
);
const humanRun = reportOf(
  IDS.humanTurn,
  5,
  25,
  ANALYST_SESSION,
  "execute",
  RUN_TEXT,
  "review",
);
const humanTurn: WorkflowInstanceDetailView = {
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
      participant: "analyst",
      receiver: ANALYST_SESSION,
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
      participant: "lophn",
      receiver: LOPHN_SESSION_2,
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
  LOPHN_SESSION,
  "plan",
  "Compare exp-014 results across both weeks. No new pass is needed.",
  "execute",
);
const endedRun = reportOf(
  IDS.ended,
  5,
  280,
  ANALYST_SESSION,
  "execute",
  "Collected both weeks. This week is 4 points better on route length.",
  "review",
);
const endedReview = reportOf(
  IDS.ended,
  7,
  250,
  LOPHN_SESSION_2,
  "review",
  REVIEW_TEXT,
  "report",
);
const endedReport = reportOf(
  IDS.ended,
  9,
  240,
  LOPHN_SESSION,
  "report",
  "Wrote the conclusion into loop/findings/F-012.md.",
  "end",
);
// ended는 job이 시작한 instance다(제목 있는 쪽). 지워진 job의 모양은 core-source가 title null로 준다.
const endedStartedBy = {
  kind: "job",
  job: "job_fakeweeklyreview",
  title: "Weekly review",
} as const satisfies WorkflowStartedBy;
const ended: WorkflowInstanceDetailView = {
  instance: instanceOf(
    IDS.ended,
    endedInput,
    "ended",
    null,
    310,
    240,
    endedStartedBy,
  ),
  last_reports: {
    plan: endedPlan,
    execute: endedRun,
    review: endedReview,
    report: endedReport,
  },
  lines: [
    ...startLines(IDS.ended, endedInput, 310, {
      kind: "job",
      job: endedStartedBy.job,
    }),
    endedPlan,
    {
      instance: IDS.ended,
      seq: "4",
      at: minutesAgo(300),
      by: lophn,
      kind: "handed",
      step: "execute",
      participant: "analyst",
      receiver: ANALYST_SESSION,
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
      participant: "lophn",
      receiver: LOPHN_SESSION_2,
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
      participant: "lophn",
      receiver: LOPHN_SESSION,
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
  LOPHN_SESSION,
  "plan",
  "Try exp-005 on the slow scenarios only. Plan: eval/experiments/exp-005.md.",
  "execute",
);
const stopped: WorkflowInstanceDetailView = {
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
      participant: "analyst",
      receiver: ANALYST_SESSION,
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

// ---- not_handed: lophn이 review 담당을 고쳤는데 참가자가 없다 ----
const notHandedInput =
  "Look into why the recipe lookup scenarios flip between attempts";
const notHandedPlan = reportOf(
  IDS.notHanded,
  3,
  40,
  LOPHN_SESSION,
  "plan",
  "Do three passes of exp-007 on the same scenarios and compare the tool calls.",
  "execute",
);
const notHandedRun = reportOf(
  IDS.notHanded,
  5,
  22,
  ANALYST_SESSION,
  "execute",
  "Three passes done. The flips come from the order of two read tools. Results are in eval/results/exp-007.",
  "review",
);
const notHanded: WorkflowInstanceDetailView = {
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
      participant: "analyst",
      receiver: ANALYST_SESSION,
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
  LOPHN_SESSION,
  "plan",
  "Repeat exp-006 now that the inventory schema has the new field.",
  "execute",
);
const restarted: WorkflowInstanceDetailView = {
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
      participant: "analyst",
      receiver: ANALYST_SESSION,
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
      receiver: ANALYST_SESSION,
    },
  ],
};

// ---- flow: nightly-flow의 instance. participants가 없고 step은 program이 맡는다 ----
function flowInstanceOf(
  id: string,
  input: string,
  state: WorkflowState,
  current: WorkflowInstanceView["current"],
  startedMinutesAgo: number,
  finishedMinutesAgo: number | null,
  startedBy: WorkflowStartedBy = { kind: "user" },
): WorkflowInstanceView {
  return {
    id,
    project: PROJECT,
    workflow: "nightly-flow",
    input,
    state,
    participants: {},
    steps: FLOW_STEPS.map((name) => ({
      name,
      by: "program",
      with: null,
      prompt: "",
      in: "",
      out: "",
      next: [],
    })),
    current,
    started_by: startedBy,
    created_at: minutesAgo(startedMinutesAgo),
    finished_at:
      finishedMinutesAgo === null ? null : minutesAgo(finishedMinutesAgo),
  };
}

function flowStarted(
  instance: string,
  input: string,
  minutes: number,
  by: WorkflowLineBy = user,
): WorkflowLineView {
  return {
    instance,
    seq: "1",
    at: minutesAgo(minutes),
    by,
    kind: "started",
    step: null,
    text: input,
  };
}

const FETCH_TEXT = "Fetched 42 new items from 3 sources.";
const SUMMARIZE_TEXT = "Summarized 31 of 42 items so far.";

const flowRunningInput = "Digest the overnight feed changes";
const flowRunningFetch = programReportOf(
  IDS.flowRunning,
  2,
  7,
  "fetch",
  FETCH_TEXT,
);
const flowRunningSummarize = programReportOf(
  IDS.flowRunning,
  3,
  2,
  "summarize",
  SUMMARIZE_TEXT,
);
const flowRunning: WorkflowInstanceDetailView = {
  instance: flowInstanceOf(
    IDS.flowRunning,
    flowRunningInput,
    "running",
    { step: "summarize", human_turn: false },
    8,
    null,
  ),
  last_reports: {
    fetch: flowRunningFetch,
    summarize: flowRunningSummarize,
  },
  lines: [
    flowStarted(IDS.flowRunning, flowRunningInput, 8),
    flowRunningFetch,
    flowRunningSummarize,
  ],
};

// program_exited: job이 시작한 flow의 program이 code 1로 끝났다.
const flowExitedInput = "Digest the weekly feed changes";
const flowExitedBy = {
  kind: "job",
  job: "job_fakenightlydigest",
  title: "Nightly digest",
} as const satisfies WorkflowStartedBy;
const flowExitedFetch = programReportOf(
  IDS.flowExited,
  2,
  203,
  "fetch",
  FETCH_TEXT,
);
const flowExitedSummarize = programReportOf(
  IDS.flowExited,
  3,
  201,
  "summarize",
  "Summarized 12 of 42 items, then the summary model stopped answering.",
);
const flowExited: WorkflowInstanceDetailView = {
  instance: flowInstanceOf(
    IDS.flowExited,
    flowExitedInput,
    "ended",
    null,
    205,
    200,
    flowExitedBy,
  ),
  last_reports: {
    fetch: flowExitedFetch,
    summarize: flowExitedSummarize,
  },
  lines: [
    flowStarted(IDS.flowExited, flowExitedInput, 205, {
      kind: "job",
      job: flowExitedBy.job,
    }),
    flowExitedFetch,
    flowExitedSummarize,
    {
      instance: IDS.flowExited,
      seq: "4",
      at: minutesAgo(200),
      by: lophn,
      kind: "program_exited",
      code: 1,
      stderr_tail: [
        "error: Uncaught (in promise) TypeError: Cannot read properties of undefined (reading 'items')",
        "    at summarize (file:///flows/nightly-flow/flow.ts:41:23)",
        "    at async main (file:///flows/nightly-flow/flow.ts:58:5)",
      ].join("\n"),
    },
    {
      instance: IDS.flowExited,
      seq: "5",
      at: minutesAgo(200),
      by: lophn,
      kind: "ended",
    },
  ],
};

// lophn_restarted: flow가 도는 중에 lophn이 꺼졌다 켜져 flow가 닫혔다(다시 시작하지 않는다).
const flowRestartedInput = "Digest the feed changes since Monday";
const flowRestartedFetch = programReportOf(
  IDS.flowRestarted,
  2,
  398,
  "fetch",
  FETCH_TEXT,
);
const flowRestarted: WorkflowInstanceDetailView = {
  instance: flowInstanceOf(
    IDS.flowRestarted,
    flowRestartedInput,
    "ended",
    null,
    400,
    380,
  ),
  last_reports: { fetch: flowRestartedFetch },
  lines: [
    flowStarted(IDS.flowRestarted, flowRestartedInput, 400),
    flowRestartedFetch,
    {
      instance: IDS.flowRestarted,
      seq: "3",
      at: minutesAgo(380),
      by: lophn,
      kind: "lophn_restarted",
      step: null,
      receiver: null,
    },
    {
      instance: IDS.flowRestarted,
      seq: "4",
      at: minutesAgo(380),
      by: lophn,
      kind: "ended",
    },
  ],
};

/** eval-loop의 instance 여섯 뒤에 nightly-flow의 instance 셋이 붙는다. 새것이 앞이다. */
export const FAKE_WORKFLOW_INSTANCES: readonly WorkflowInstanceDetailView[] = [
  running,
  humanTurn,
  notHanded,
  restarted,
  ended,
  stopped,
  flowRunning,
  flowExited,
  flowRestarted,
];

const FOLDERS: readonly ProjectFolderView[] = [
  { path: FAKE_PROJECT_FOLDER, found: true },
  { path: FAKE_NOTES_FOLDER, found: true },
];

// source 하나가 자기 tree를 갖는다. 만들기·이름 바꾸기·지우기가 이 메모리 tree를 바꾼다.
type Tree = { name: string; children?: Tree[] };
type Mount = { readonly path: string; readonly nodes: Tree[] };

const clone = (nodes: readonly Node[]): Tree[] =>
  nodes.map((node) => ({
    name: node.name,
    ...(node.children === undefined ? {} : { children: clone(node.children) }),
  }));

const parts = (path: string) => path.split("/").filter((part) => part !== "");

function mountOf(mounts: readonly Mount[], path: string): Mount | undefined {
  return mounts.find(
    (item) => path === item.path || path.startsWith(`${item.path}/`),
  );
}

/** 폴더의 항목들. 폴더가 아니거나 없으면 undefined. */
function find(mounts: readonly Mount[], path: string): Tree[] | undefined {
  const mount = mountOf(mounts, path);
  if (mount === undefined) return undefined;
  let nodes = mount.nodes;
  for (const name of parts(path.slice(mount.path.length))) {
    const next = nodes.find((node) => node.name === name)?.children;
    if (next === undefined) return undefined;
    nodes = next;
  }
  return nodes;
}

interface FakeWorkspaceOptions {
  /** 디스크에서 사라진 것으로 보일 연결 폴더 경로. */
  readonly missing?: readonly string[];
  /** 읽기에 실패하는 폴더 경로. */
  readonly failing?: readonly string[];
  /** workflow 정의 목록. project와 상관없이 그대로 돌려준다. 기본은 FAKE_WORKFLOWS다. */
  readonly workflows?: readonly WorkflowEntryView[];
  /** workflow instance. 새것이 앞. 기본은 FAKE_WORKFLOW_INSTANCES다. */
  readonly workflowInstances?: readonly WorkflowInstanceDetailView[];
}

function summaryOf(
  detail: WorkflowInstanceDetailView,
): WorkflowInstanceSummaryView {
  const { instance, lines } = detail;
  return {
    id: instance.id,
    project: instance.project,
    workflow: instance.workflow,
    state: instance.state,
    current: instance.current,
    input: instance.input,
    started_by: instance.started_by,
    created_at: instance.created_at,
    finished_at: instance.finished_at,
    last_line: lines.at(-1) ?? null,
  };
}

function fakeLayoutSource() {
  const bridge = memoryWorkspaceLayoutBridge();
  return createLayoutSource(() => bridge);
}

export function fakeWorkspaceSource(
  options: FakeWorkspaceOptions = {},
): WorkspaceSource {
  const missing = options.missing ?? [];
  const failing = options.failing ?? [];
  const mounts: Mount[] = [
    { path: FAKE_PROJECT_FOLDER, nodes: clone(PHRONER) },
    { path: FAKE_NOTES_FOLDER, nodes: clone(NOTES) },
  ];
  // 시작과 멈춤이 이 목록을 바꾼다. 실제 core와 같은 규칙만 흉내 낸다.
  let instances: WorkflowInstanceDetailView[] = [
    ...(options.workflowInstances ?? FAKE_WORKFLOW_INSTANCES),
  ];
  const changeInstance = (
    id: string,
    change: (detail: WorkflowInstanceDetailView) => WorkflowInstanceDetailView,
  ) => {
    instances = instances.map((detail) =>
      detail.instance.id === id ? change(detail) : detail,
    );
  };
  const dirOf = (path: string) => path.slice(0, path.lastIndexOf("/"));
  const nameOf = (path: string) => path.slice(path.lastIndexOf("/") + 1);
  const fail = (code: "conflict" | "not_found" | "invalid_input") =>
    Promise.resolve({ ok: false, code } as const);
  const done = Promise.resolve({ ok: true } as const);
  return {
    searchSource: fakeFileSearchSource(),
    project: (id) =>
      Promise.resolve({
        ok: true,
        value: {
          id,
          identity: null,
          title: "phroner",
          folders: FOLDERS.map((item) => ({
            ...item,
            found: !missing.includes(item.path),
          })),
        },
      }),
    addFolder: () => Promise.resolve({ ok: true, value: null }),
    removeFolder: (id, path) =>
      Promise.resolve({
        ok: true,
        value: {
          id,
          identity: null,
          title: "phroner",
          folders: FOLDERS.filter((item) => item.path !== path),
        },
      }),
    projects: () =>
      Promise.resolve({
        ok: true,
        value: [
          { id: PROJECT, title: "phroner" },
          { id: "prj_01h455vb4pex5v6nkc6gd5fd01", title: "grocery-budget" },
          { id: "prj_01h455vb4pex5v6nkc6gd5fd02", title: "eval-lab" },
        ],
      }),
    list(path): Promise<ReadResult<readonly FolderEntry[]>> {
      const nodes = find(mounts, path);
      if (nodes === undefined || failing.includes(path)) {
        return Promise.resolve({ ok: false, message: "not_found" });
      }
      return Promise.resolve({
        ok: true,
        value: nodes
          .map((node) => ({
            name: node.name,
            kind:
              node.children === undefined
                ? ("file" as const)
                : ("folder" as const),
          }))
          .sort((a, b) =>
            a.kind !== b.kind
              ? a.kind === "folder"
                ? -1
                : 1
              : a.name.localeCompare(b.name),
          ),
      });
    },
    create(path, kind) {
      const mount = mountOf(mounts, path);
      if (mount === undefined) return fail("not_found");
      let nodes = mount.nodes;
      const names = parts(path.slice(mount.path.length));
      for (const [at, name] of names.entries()) {
        const last = at === names.length - 1;
        const hit = nodes.find((node) => node.name === name);
        if (last) {
          if (hit !== undefined) return fail("conflict");
          nodes.push(kind === "folder" ? { name, children: [] } : { name });
        } else if (hit === undefined) {
          const made: Tree = { name, children: [] };
          nodes.push(made);
          nodes = made.children!;
        } else if (hit.children === undefined) return fail("conflict");
        else nodes = hit.children;
      }
      return done;
    },
    rename(from, to) {
      if (to === from || to.startsWith(`${from}/`)) {
        return to === from ? done : fail("invalid_input");
      }
      const source = find(mounts, dirOf(from));
      const target = find(mounts, dirOf(to));
      const node = source?.find((item) => item.name === nameOf(from));
      if (source === undefined || target === undefined || node === undefined) {
        return fail("not_found");
      }
      if (target.some((item) => item.name === nameOf(to))) {
        return fail("conflict");
      }
      source.splice(source.indexOf(node), 1);
      target.push({ ...node, name: nameOf(to) });
      return done;
    },
    copy(from, to) {
      if (to.startsWith(`${from}/`)) return fail("invalid_input");
      const source = find(mounts, dirOf(from));
      const target = find(mounts, dirOf(to));
      const node = source?.find((item) => item.name === nameOf(from));
      if (source === undefined || target === undefined || node === undefined) {
        return fail("not_found");
      }
      if (target.some((item) => item.name === nameOf(to))) {
        return fail("conflict");
      }
      target.push(...clone([node]));
      return done;
    },
    writeBytes(path) {
      const parent = find(mounts, dirOf(path));
      if (parent === undefined) return fail("not_found");
      const name = nameOf(path);
      if (parent.some((item) => item.name === name)) return fail("conflict");
      parent.push({ name });
      return done;
    },
    trash(path) {
      const siblings = find(mounts, dirOf(path));
      const at = siblings?.findIndex((item) => item.name === nameOf(path));
      if (siblings === undefined || at === undefined || at < 0) {
        return fail("not_found");
      }
      siblings.splice(at, 1);
      return done;
    },
    reveal: () => done,
    workflows: () =>
      Promise.resolve({ ok: true, value: options.workflows ?? FAKE_WORKFLOWS }),
    workflowInstances: (filter) =>
      Promise.resolve({
        ok: true,
        value: instances
          .filter(
            (detail) =>
              (filter.workflow === undefined ||
                detail.instance.workflow === filter.workflow) &&
              (filter.state === undefined ||
                detail.instance.state === filter.state),
          )
          .map(summaryOf),
      }),
    workflowInstance(id) {
      const detail = instances.find((item) => item.instance.id === id);
      return Promise.resolve(
        detail === undefined
          ? { ok: false, message: "not_found" }
          : { ok: true, value: detail },
      );
    },
    startWorkflow({ workflow, text, step }) {
      const entry = (options.workflows ?? FAKE_WORKFLOWS).find(
        (item) => item.key === workflow,
      );
      if (entry === undefined) {
        return Promise.resolve({ ok: false, message: "not_found" });
      }
      if (!entry.startable || entry.steps === null) {
        return Promise.resolve({ ok: false, message: "conflict" });
      }
      const isFlow = entry.kind === "flow";
      // flow는 시작 step이 없다. step을 보내면 core가 거절한다.
      if (isFlow && step !== undefined) {
        return Promise.resolve({ ok: false, message: "invalid_input" });
      }
      const first = isFlow ? null : (step ?? entry.steps[0]?.name);
      if (!isFlow && !entry.steps.some((item) => item.name === first)) {
        return Promise.resolve({ ok: false, message: "not_found" });
      }
      const id = `wfi_fake${instances.length + 1}`;
      const at = FAKE_NOW.toISOString();
      const instance: WorkflowInstanceView = {
        id,
        project: entry.project,
        workflow: entry.name,
        input: text,
        state: "running",
        participants: isFlow ? {} : PARTICIPANTS,
        steps: entry.steps.map((item) => ({
          ...item,
          prompt: "",
          in: "",
          out: "",
        })),
        current: first === null ? null : { step: first, human_turn: false },
        started_by: { kind: "user" },
        created_at: at,
        finished_at: null,
      };
      instances = [
        {
          instance,
          last_reports: {},
          lines: [
            {
              instance: id,
              seq: "1",
              at,
              by: { kind: "user" },
              kind: "started",
              step: first,
              text,
            },
          ],
        },
        ...instances,
      ];
      return Promise.resolve({ ok: true, value: { instance: id } });
    },
    stopWorkflow(id) {
      const detail = instances.find((item) => item.instance.id === id);
      if (detail === undefined) {
        return Promise.resolve({ ok: false, message: "not_found" });
      }
      if (detail.instance.state === "stopped") {
        return Promise.resolve({ ok: false, message: "conflict" });
      }
      const at = FAKE_NOW.toISOString();
      const stopped: WorkflowLineView = {
        instance: id,
        seq: String(detail.lines.length + 1),
        at,
        by: { kind: "user" },
        kind: "stopped",
      };
      changeInstance(id, (item) => ({
        ...item,
        instance: { ...item.instance, state: "stopped", finished_at: at },
        lines: [...item.lines, stopped],
      }));
      return Promise.resolve({ ok: true, value: null });
    },
    files: () => Promise.resolve({ ok: true, value: [] }),
    layout: fakeLayoutSource(),
  };
}
