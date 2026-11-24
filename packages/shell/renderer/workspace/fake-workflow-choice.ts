// 서로 대신하는 step이 있는 workflow의 fixture: 조사를 Claude Code가 하거나 Antigravity가 하고, 둘 다 design으로 넘긴다.
// 조사 step에 붙는 입력(`steps`)과, 다른 project에서 도는 coding agent session이 step에 붙은 run 하나를 가진다.
import type {
  WorkflowEntryView,
  WorkflowInstanceDetailView,
  WorkflowInstanceView,
} from "./source.ts";

const PROJECT = "prj_01h455vb4pex5v6nkc6gd5fd00";
const LAB_PROJECT = "prj_01h455vb4pex5v6nkc6gd5fd02";
const INSTANCE = "wfi_01h455vb4pex5v6nkc6gd5fd15";
const RESEARCH_SESSION = "ses_01h455vb4pex5v6nkc6gd5fd31";
const WORKER_SESSION = "ses_01h455vb4pex5v6nkc6gd5fd32";
const DESIGN_SESSION = "ses_01h455vb4pex5v6nkc6gd5fd33";

const NOW = new Date("2026-10-22T09:30:00.000Z");
const minutesAgo = (minutes: number) =>
  new Date(NOW.getTime() - minutes * 60_000).toISOString();

const PARTICIPANTS = {
  me: { kind: "human" },
  planner: { agent: "lophn" },
  builder: { agent: "Eval analyst" },
  researcher: { agent: "claude", workspace: { project: "eval-lab" } },
  "researcher-antigravity": {
    agent: "antigravity",
    workspace: { project: "eval-lab" },
  },
} as const;

const STEPS = [
  { name: "research", by: "researcher", with: null, next: ["design"] },
  {
    name: "research-antigravity",
    by: "researcher-antigravity",
    with: null,
    next: ["design"],
  },
  {
    name: "design",
    by: "me",
    with: "planner",
    next: ["build", "research", "research-antigravity", "end"],
    open: "tab",
  },
  { name: "build", by: "builder", with: null, next: ["review", "design"] },
  { name: "review", by: "planner", with: null, next: ["end", "build"] },
] as const;

export const FAKE_CHOICE_WORKFLOW: WorkflowEntryView = {
  key: "phroner/feature-build",
  project: PROJECT,
  name: "feature-build",
  invalid: false,
  kind: "agent",
  startable: true,
  problem: null,
  inputs: {
    depth: {
      type: "select",
      label: "Research depth",
      description: "How far the research lead digs before reporting.",
      required: true,
      default: "auto",
      options: [
        { value: "auto", label: "Let the agent decide" },
        { value: "deep", label: "Deep" },
        { value: "quick", label: "Quick" },
      ],
      steps: ["research", "research-antigravity"],
    },
  },
  participants: PARTICIPANTS,
  steps: STEPS.map((step) => ({ ...step, next: [...step.next] })),
  artifacts: { static: false, instance: false },
};

const INPUT =
  "Look at how other tools let you pick an account per session, then design ours";

const instance: WorkflowInstanceView = {
  id: INSTANCE,
  project: PROJECT,
  workflow: "feature-build",
  input: INPUT,
  inputs: { depth: "quick" },
  state: "running",
  participants: PARTICIPANTS,
  steps: STEPS.map((step) => ({
    name: step.name,
    by: step.by,
    with: step.with,
    prompt: "",
    in: "",
    out: "",
    next: [...step.next],
  })),
  current: { step: "design", human_turn: true },
  started_by: { kind: "user" },
  created_at: minutesAgo(35),
  finished_at: null,
};

const researchReport = {
  instance: INSTANCE,
  seq: "3",
  at: minutesAgo(11),
  by: { kind: "agent", session: RESEARCH_SESSION },
  kind: "report",
  step: "research-antigravity",
  text: "topic: multi-credential\nSix products covered. Most switch accounts per profile, two per session. The spec and the comparison with our code are written; five product questions are open.",
  next: "design",
  session: "new",
  refs: [
    "/home/mina/work/eval-lab/_report/multi-credential/README.md",
    "/home/mina/work/eval-lab/_report/multi-credential/spec.md",
  ],
} as const;

/** 사람 차례(design)인 run. 조사는 Antigravity가 했고 Claude Code 쪽 step은 지나가지 않았다. */
export const FAKE_CHOICE_RUN: WorkflowInstanceDetailView = {
  instance,
  derived_status: "needs_you",
  inputs: { depth: "quick" },
  last_reports: { "research-antigravity": researchReport },
  lines: [
    {
      instance: INSTANCE,
      seq: "1",
      at: minutesAgo(35),
      by: { kind: "user" },
      kind: "started",
      step: "research-antigravity",
      text: INPUT,
    },
    {
      instance: INSTANCE,
      seq: "2",
      at: minutesAgo(35),
      by: { kind: "lophn" },
      kind: "handed",
      step: "research-antigravity",
      participant: "researcher-antigravity",
      receiver: RESEARCH_SESSION,
      human_turn: false,
      cause: "start",
      session: "new",
    },
    researchReport,
    {
      instance: INSTANCE,
      seq: "4",
      at: minutesAgo(11),
      by: { kind: "lophn" },
      kind: "handed",
      step: "design",
      participant: "planner",
      receiver: DESIGN_SESSION,
      human_turn: true,
      cause: "report",
      session: "new",
    },
  ],
  remote_steps: [],
  sessions: [
    {
      session: RESEARCH_SESSION,
      parent: null,
      agent: "coding_antigravity",
      workspace: { kind: "project", id: LAB_PROJECT },
      step: "research-antigravity",
      state: "idle",
      waiting_for: null,
      last_assistant_preview:
        "Research is done. The report, the spec and the comparison are in _report/multi-credential.",
      last_error: null,
      harness: "antigravity",
    },
    {
      session: WORKER_SESSION,
      parent: RESEARCH_SESSION,
      agent: "coding_claude",
      workspace: { kind: "project", id: LAB_PROJECT },
      step: "research-antigravity",
      state: "idle",
      waiting_for: null,
      last_assistant_preview: null,
      last_error: "no_answer",
      harness: "claude",
    },
    {
      session: DESIGN_SESSION,
      parent: null,
      agent: `lophn_${PROJECT}`,
      workspace: { kind: "project", id: PROJECT },
      step: "design",
      state: "waiting",
      waiting_for: "question",
      last_assistant_preview:
        "I wrote the roadmap draft. Five decisions are yours; the first is whether a session keeps the account it started with.",
      last_error: null,
    },
  ],
  refs: [...researchReport.refs],
};
