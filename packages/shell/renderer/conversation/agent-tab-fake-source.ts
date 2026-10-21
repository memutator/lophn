// AgentTabSource의 메모리 fake. wireframe의 Agent 탭 장면 전부를 `scene` 이름으로 골라 낸다(gallery와 dev-mock이 쓴다).
// 쓰기는 기록을 바꾸고 `changed`로 알려 장면 안에서 눌러 볼 수 있다. 시각과 id는 고정이다.
import type {
  AgentFace,
  AgentTabSource,
  ApprovalResultView,
  AskedQuestion,
  BodyPart,
  CallView,
  Envelope,
  ModelView,
  PermissionsView,
  QuestionAnswer,
  QueuedView,
  RewindPreviewView,
  SessionEntry,
  SourceResult,
  ThreadEntry,
  ThreadMessage,
  ThreadView,
} from "./agent-tab-source.ts";
import { EMPTY_THREAD } from "./agent-tab-source.ts";
import type { AgentValueLayer } from "../../../protocol/lophn-agent/agent-definitions.ts";
import type {
  PickerModelRef,
  PickerProviderGroup,
} from "./model-picker/types.ts";
import type { SlashGroupView } from "./slash-menu/types.ts";
import { t } from "@lophn/wording";
import {
  effortLowToMax,
  HAIKU,
  LAYOUT_ALL,
  OPUS,
  type PickerScenario,
  SOL,
  SONNET,
} from "./agent-tab-fake-models.ts";
import { COMMANDS_GROUP, SKILLS_GROUP } from "./agent-tab-fake-commands.ts";

/** 고를 수 있는 장면. 이름은 wireframe의 Agent 탭 장면을 따른다. */
export const AGENT_TAB_SCENES = [
  /** 끝난 일 하나: 요청, tool 줄, 답, 편집 카드, 끝난 turn. */
  "report",
  /** skip을 켠 session. 대화는 `report`와 같다. */
  "skip",
  /** 일하는 중에 steer로 보낸 메시지와 할 일. `/permissions`도 이 장면에서 연다. */
  "working",
  "queued",
  "request-error",
  "sender-chips",
  "call-open",
  "call-replies",
  "question",
  "question-answered",
  "question-ended",
  "approval",
  "approval-states",
  "rewind",
  /** session이 아직 없는 새 대화. */
  "empty",
] as const;
export type AgentTabScene = (typeof AGENT_TAB_SCENES)[number];

/** 화면이 받는 "지금". 모든 줄의 시각은 이 날의 아침이다. */
const NOW = Date.parse("2026-10-06T09:00:00Z");

function at(minutes: number): string {
  return new Date(NOW + minutes * 60_000).toISOString();
}

// core의 CODING_REACTION_TEXTS.ended와 같은 글. renderer는 core를 import하지 않는다.
const CODING_ENDED_TEXT =
  "The coding session ended. Its last message to you says what it did.";

function fakeId(prefix: string, n: number): string {
  return `${prefix}_01h455vb4pex5v6nkc6gd5f${String(n).padStart(3, "0")}`;
}

const sessionId = (n: number) => fakeId("ses", n);
const messageId = (n: number) => fakeId("msg", n);
const turnId = (n: number) => fakeId("trn", n);
const toolId = (n: number) => fakeId("tcl", n);
const callId = (n: number) => fakeId("cal", n);
const groupId = (n: number) => fakeId("qgr", n);
const requestId = (n: number) => fakeId("apr", n);
const appId = (n: number) => fakeId("app", n);

export const SESSION_MAIN = sessionId(1);
const SESSION_EARLIER = sessionId(2);
/** 기록만 읽는 archive한 session. */
export const SESSION_ARCHIVED = sessionId(3);

const LOPHN: AgentFace = {
  role: "lophn",
  name: "lophn",
  profile: { kind: "icon", icon: "search" },
  place: { kind: "project", name: "phroner" },
  permissionSummary: "2 apps assigned",
};

const APP_ENGINEER: AgentFace = {
  role: "app_engineer",
  name: "App Engineer",
  profile: { kind: "icon", icon: "apps" },
  place: { kind: "app", name: "Eval board" },
  permissionSummary: LOPHN.permissionSummary,
};

const REQUEST = "Write this week's eval report from the new findings.";
const QUESTION_LEAD =
  "There are 3 new findings since last week. Before I write the report I need two answers.";
const CLEANUP_LEAD =
  "The 2026-w40 report is superseded by this week's. I can delete the old folder with a shell command, so I need your OK first.";
const CLEANUP_COMMAND = "rm -r docs/reports/2026-w40";

const turn1 = turnId(1);

// ---- 장면이 쓰는 값 ----

function user(
  n: number,
  minutes: number,
  text: string,
  over: Partial<ThreadMessage> = {},
): ThreadMessage {
  return {
    kind: "message",
    id: messageId(n),
    at: at(minutes),
    actor: "user",
    sender: null,
    call: null,
    replyTo: null,
    delivery: "next_turn",
    turn: turn1,
    text,
    ...over,
  };
}

function agent(
  n: number,
  minutes: number,
  over: Partial<ThreadMessage> = {},
): ThreadMessage {
  return user(n, minutes, "", { actor: "agent", text: null, ...over });
}

const tools = (minutes: number): ThreadEntry => ({
  kind: "tools",
  id: toolId(1),
  at: at(minutes),
  tool: {
    id: toolId(1),
    label: "Read 3 documents",
    lines: [
      "docs/reports/2026-w38.md",
      "docs/reports/2026-w39.md",
      "eval/findings.md",
    ],
  },
});

const reportEdit = (minutes: number): ThreadEntry => ({
  kind: "edit",
  id: "edit-1",
  at: at(minutes),
  edit: {
    id: "edit-1",
    document: fakeId("doc", 1),
    path: "docs/reports/2026-w41.md",
    added: 24,
    removed: 3,
  },
});

const TASKS = [
  { id: "task-1", text: "Read last week's findings", state: "done" },
  { id: "task-2", text: "Search eval", state: "done" },
  { id: "task-3", text: "Write report", state: "now" },
  { id: "task-4", text: "Link findings", state: "later" },
] as const;

const working = (): ThreadView["turn"] => ({
  id: turn1,
  phase: "working",
  startedAt: at(41),
});

function received(
  n: number,
  minutes: number,
  text: string,
  sender: NonNullable<ThreadMessage["sender"]>,
  over: Partial<ThreadMessage> = {},
): ThreadMessage {
  return user(n, minutes, text, {
    actor: "received",
    sender,
    turn: null,
    ...over,
  });
}

function call(
  n: number,
  minutes: number,
  view: Omit<CallView, "call">,
): ThreadEntry {
  return {
    kind: "call",
    id: callId(n),
    at: at(minutes),
    call: { call: callId(n), ...view },
  };
}

const CALL_OPEN = {
  to: "Operator · Eval analyst",
  task: "Find what the 3 regressions have in common.",
  reply: "result",
  status: { state: "accepted", reason: null },
} as const;

const CALL_FAILED = {
  to: "Operator · Experiment planner",
  task: "Plan exp-013 so it isolates the recipe lookup.",
  reply: "result",
  status: { state: "failed", reason: "receiver_ended" },
} as const;

const CALL_CANCELLED = {
  to: "Project Manager · phroner",
  task: "Check the eval context against the new reports.",
  reply: "result",
  status: { state: "cancelled", reason: null },
} as const;

const ASKED: readonly AskedQuestion[] = [
  {
    id: `${groupId(1)}:0`,
    header: "Report place",
    question: "Where should the weekly report go?",
    multiSelect: false,
    options: [
      { label: "docs/reports/", description: "Next to last week's reports" },
      { label: "eval/reports/", description: "Inside the eval folder" },
      {
        label: "A new file each week",
        description: "Named by date, no fixed folder",
      },
    ],
  },
  {
    id: `${groupId(1)}:1`,
    header: "Sections",
    question: "Which sections should the report have?",
    multiSelect: true,
    options: [
      { label: "Improvements", description: "Scenarios that got better" },
      { label: "Regressions", description: "Each one with its scenario" },
      { label: "Next experiments", description: "What to try next week" },
    ],
  },
];

function envelope(
  sender: Envelope["sender"],
  task: string,
  refs: Envelope["refs"],
  session: Envelope["session"],
): Envelope {
  return { sender, task, refs, session };
}

interface SceneData {
  agent: AgentFace;
  title: string;
  entries: ThreadEntry[];
  turn: ThreadView["turn"];
  tasks?: ThreadView["tasks"];
  queued?: QueuedView[];
  pending?: ThreadView["pending"];
  /** 메시지 id별 본문. 글만인 message는 text에서 만든다. */
  bodies?: Record<string, readonly BodyPart[]>;
  envelopes?: Record<string, Envelope>;
}

function sceneData(scene: AgentTabScene): SceneData {
  switch (scene) {
    case "report":
    case "skip":
      return {
        agent: LOPHN,
        title: "Week 41 summary",
        entries: [
          user(1, 41, REQUEST),
          tools(41),
          agent(2, 42),
          reportEdit(42),
          {
            kind: "turn-end",
            id: "end-1",
            at: at(43),
            turn: turn1,
            outcome: "completed",
            durationMs: 18_000,
          },
        ],
        turn: { id: turn1, phase: "ended", startedAt: at(41) },
        bodies: {
          [messageId(2)]: [{
            kind: "text",
            text: "I wrote the report from the three findings.",
          }],
        },
      };
    case "working":
    case "rewind":
    case "queued": {
      const entries: ThreadEntry[] = [
        user(1, 41, REQUEST),
        agent(2, 41),
        reportEdit(41),
      ];
      const bodies: SceneData["bodies"] = {
        [messageId(2)]: [
          {
            kind: "text",
            text:
              "F-011 is a regression on query-recipe-gap. Here is the run from Eval board.",
          },
          { kind: "app_card", app: appId(1), view: "run" },
        ],
      };
      const steer = scene !== "queued";
      if (steer) {
        entries.push(
          user(3, 42, "Also add the exp-008 numbers to the report.", {
            delivery: "steer",
          }),
          agent(4, 42),
        );
        bodies[messageId(4)] = [{
          kind: "text",
          text:
            "Got it. I will add the exp-008 numbers when I reach the regression section.",
        }];
      }
      return {
        agent: LOPHN,
        title: "Week 41 summary",
        entries,
        turn: working(),
        tasks: TASKS,
        queued: steer ? [] : [{
          id: messageId(5),
          at: at(42),
          text: "Also add the exp-008 numbers to the report.",
        }],
        bodies,
      };
    }
    case "request-error":
      return {
        agent: LOPHN,
        title: "Week 41 summary",
        entries: [user(1, 41, REQUEST), {
          kind: "provider-error",
          id: "error-1",
          at: at(42),
          turn: turn1,
          code: "request_rejected",
          message:
            "OpenAI rejected the request (400): the Priority speed option is not enabled for this account. Nothing was changed.",
        }],
        turn: { id: turn1, phase: "ended", startedAt: at(41) },
      };
    case "sender-chips": {
      const notice = envelope(
        { kind: "program", label: null },
        CODING_ENDED_TEXT,
        [{
          kind: "session",
          text: "Claude Code · Eval board",
          target: sessionId(9),
        }],
        null,
      );
      const lophn = envelope(
        { kind: "agent", role: "lophn", name: "lophn" },
        "Keep the scenario names in Eval board as they are. A person asked for that, so do not rename them in the fix.",
        [{
          kind: "annotation",
          text: "Scenario list",
          target: fakeId("ann", 12),
        }],
        { id: SESSION_EARLIER, title: "Weekly report" },
      );
      const coding = envelope(
        { kind: "coding", product: "Claude Code" },
        "I finished the lookup change and the checks pass. Do you want the scenario names kept as they are?",
        [
          {
            kind: "session",
            text: "Claude Code · Eval board",
            target: sessionId(9),
          },
          { kind: "file", text: "src/lookup.ts", target: "src/lookup.ts" },
        ],
        { id: sessionId(9), title: "Claude Code · Eval board" },
      );
      return {
        agent: APP_ENGINEER,
        title: "Eval board keeps crashing",
        entries: [
          received(
            1,
            30,
            CODING_ENDED_TEXT,
            notice.sender,
          ),
          received(
            2,
            36,
            "About the fix for P-12: keep the scenario names as they are.",
            lophn.sender,
          ),
          received(
            3,
            52,
            "The lookup change is done and the checks pass.",
            coding.sender,
          ),
        ],
        turn: working(),
        envelopes: {
          [messageId(1)]: notice,
          [messageId(2)]: lophn,
          [messageId(3)]: coding,
        },
      };
    }
    case "call-open":
      return {
        agent: LOPHN,
        title: "Week 41 summary",
        entries: [
          user(1, 43, "Why did those 3 scenarios regress?"),
          agent(2, 44),
          call(1, 44, CALL_OPEN),
          agent(3, 45),
          call(2, 47, CALL_CANCELLED),
        ],
        turn: working(),
        bodies: {
          [messageId(2)]: [{
            kind: "text",
            text:
              "I will ask the Eval analyst to look for what they have in common, and go on with the report meanwhile.",
          }],
          [messageId(3)]: [{
            kind: "text",
            text:
              "While that runs, I am drafting the sections that do not need it. I cancelled the check on the eval context, because the answer changed nothing.",
          }],
        },
      };
    case "call-replies": {
      const answer = envelope(
        { kind: "agent", role: "operator", name: "Eval analyst" },
        "The 3 regressions share one cause: query-recipe-gap, sched-edit and wake-plant all call the lookup right after a plan edit.",
        [{
          kind: "file",
          text: "eval/experiments/exp-008-query-tools.md",
          target: "eval/experiments/exp-008-query-tools.md",
        }],
        { id: sessionId(8), title: "Regression on query-recipe-gap" },
      );
      const notice = envelope(
        { kind: "program", label: "lophn · Not answered" },
        "The session of Operator · Experiment planner ended before it answered your request.",
        [],
        null,
      );
      return {
        agent: LOPHN,
        title: "Week 41 summary",
        entries: [
          call(1, 44, {
            ...CALL_OPEN,
            status: { state: "done", reason: null },
          }),
          received(1, 48, answer.task, answer.sender, { replyTo: callId(1) }),
          call(3, 49, CALL_FAILED),
          received(2, 50, notice.task, notice.sender, { replyTo: callId(3) }),
        ],
        turn: { id: turn1, phase: "ended", startedAt: at(41) },
        envelopes: { [messageId(1)]: answer, [messageId(2)]: notice },
      };
    }
    case "question":
      return {
        agent: LOPHN,
        title: "Weekly report",
        entries: [user(1, 41, REQUEST), agent(2, 41)],
        turn: { id: turn1, phase: "waiting", startedAt: at(41) },
        pending: {
          approval: null,
          questions: {
            group: groupId(1),
            toolCall: toolId(4),
            questions: ASKED,
          },
        },
        bodies: { [messageId(2)]: [{ kind: "text", text: QUESTION_LEAD }] },
      };
    case "question-answered":
      return {
        agent: LOPHN,
        title: "Weekly report",
        entries: [
          user(1, 41, REQUEST),
          agent(2, 41),
          {
            kind: "questions",
            id: groupId(1),
            at: at(41),
            group: groupId(1),
            outcome: "submitted",
            lines: [
              { header: "Report place", answer: "docs/reports/" },
              { header: "Sections", answer: "Improvements, Regressions" },
            ],
          },
          agent(3, 41),
        ],
        turn: working(),
        bodies: {
          [messageId(2)]: [{ kind: "text", text: QUESTION_LEAD }],
          [messageId(3)]: [{
            kind: "text",
            text:
              "Thanks. I am writing the report into docs/reports/ with the sections you picked.",
          }],
        },
      };
    case "question-ended":
      return {
        agent: LOPHN,
        title: "Weekly report",
        entries: [
          user(1, 41, REQUEST),
          agent(2, 41),
          {
            kind: "questions",
            id: groupId(1),
            at: at(41),
            group: groupId(1),
            outcome: "human_message",
            lines: ASKED.map((question) => ({
              header: question.header,
              answer: null,
            })),
          },
          user(
            3,
            42,
            "Just put it in docs/reports/ with the regressions, no other sections.",
          ),
          agent(4, 42),
        ],
        turn: working(),
        bodies: {
          [messageId(2)]: [{ kind: "text", text: QUESTION_LEAD }],
          [messageId(4)]: [{
            kind: "text",
            text:
              "Understood. docs/reports/ with the regressions section only.",
          }],
        },
      };
    case "approval":
      return {
        agent: LOPHN,
        title: "Weekly report",
        entries: [user(1, 41, REQUEST), agent(2, 41)],
        turn: { id: turn1, phase: "waiting", startedAt: at(41) },
        pending: {
          approval: {
            id: requestId(1),
            subject: { kind: "shell", command: CLEANUP_COMMAND },
            always_patterns: ["rm -r *"],
          },
          questions: null,
        },
        bodies: { [messageId(2)]: [{ kind: "text", text: CLEANUP_LEAD }] },
      };
    case "approval-states": {
      const result = (
        n: number,
        outcome: ApprovalResultView["outcome"],
        choice: ApprovalResultView["choice"],
        reason: string | null,
      ): ThreadEntry => ({
        kind: "approval-result",
        id: requestId(n),
        at: at(41),
        result: {
          request: requestId(n),
          subject: { kind: "shell", command: CLEANUP_COMMAND },
          outcome,
          choice,
          reason,
        },
      });
      return {
        agent: LOPHN,
        title: "Weekly report",
        entries: [
          user(1, 41, "Go on with the cleanup."),
          result(1, "allowed", "once", null),
          result(2, "allowed", "always", null),
          result(3, "denied", null, "Keep last week's report for now."),
          result(4, "cancelled", null, null),
        ],
        turn: { id: turn1, phase: "ended", startedAt: at(41) },
      };
    }
    case "empty":
      return {
        agent: LOPHN,
        title: "",
        entries: [],
        turn: null,
      };
  }
}

// ---- 읽기 값 ----

const PERMISSIONS_VIEW: PermissionsView = {
  apps: [
    { name: "Eval board", removed: [] },
    { name: "Expense tracker", removed: ["delete_expense"] },
  ],
};

const REWIND_PREVIEW: RewindPreviewView = {
  files: [
    { path: "docs/reports/2026-w41.md", skipped: null },
    { path: "docs/reports/index.md", skipped: null },
  ],
  apps: [
    {
      app: appId(1),
      name: "Eval board",
      writes: [
        { at: at(44), text: "start_run for week 41", unknown: false },
        { at: at(49), text: "add_note on query-recipe-gap", unknown: false },
      ],
      others: [
        { by: "Eval analyst", text: "tag_regression on sched-edit, 09:52" },
        { by: "You", text: "edited a scenario in the app, 09:55" },
      ],
      outside: ["Sent the run summary by email to 3 people at 09:49"],
    },
    {
      app: appId(2),
      name: "Scenario tracker",
      writes: [
        {
          at: at(47),
          text: "import_scenarios from eval/scenarios",
          unknown: false,
        },
        { at: at(48), text: "rename_scenario wake-plant", unknown: true },
      ],
      others: [],
      outside: [],
    },
  ],
};

const CUSTOM_PROVIDER = "pvd_01arz3ndektsv4rrffq69g5fa4";
// 앞 둘은 provider가 알려 준 이름이고, 마지막은 사람이 정보(effort 포함)를 적은 model이다.
const CUSTOM_MODELS = ["llama-3.3-70b", "qwen-3-coder", "deepseek-v4.1-flash"];
const CUSTOM_WITH_INFO = "deepseek-v4.1-flash";

// 알려 준 이름만 있는 custom provider model은 catalog 항목이 없어 option 축이 없다. 사람이 적은 effort는 축이 된다.
const customScenario = (modelName: string): PickerScenario => ({
  current: { provider: CUSTOM_PROVIDER, modelName },
  currentLabel: modelName,
  axes: modelName === CUSTOM_WITH_INFO ? [effortLowToMax] : [],
  optionValues: modelName === CUSTOM_WITH_INFO ? { effort: "high" } : {},
});

const SCENARIOS: Readonly<Record<string, PickerScenario>> = {
  "Sonnet 5.5": SONNET,
  "Opus 5.5": OPUS,
  "Haiku 5.5": HAIKU,
  "GPT-6.1 Sol": SOL,
  ...Object.fromEntries(
    CUSTOM_MODELS.map((name) => [name, customScenario(name)]),
  ),
};

/** gallery가 model picker의 상태를 정하는 설정. 기본은 내장 provider 셋과 global 층이다. */
export interface FakePicker {
  /** none은 연결된 provider가 없다. custom은 내장 셋에 custom provider 하나를 더한다. */
  readonly providers?: "none" | "built_in" | "custom";
  /** 지금 model이 온 층. */
  readonly layer?: AgentValueLayer | null;
  /** 처음에 고른 model의 이름. 기본은 Sonnet 5.5다. */
  readonly current?: string;
  /** Manage models에서 끈 model 이름. 목록에서 빠지지만 지금 고른 model은 꺼져 있어도 남는다. */
  readonly hidden?: readonly string[];
}

function modelView(
  scenario: PickerScenario,
  query: string,
  picker: FakePicker,
): ModelView {
  const needle = query.trim().toLowerCase();
  const off = picker.hidden ?? [];
  const matches = (name: string) =>
    (needle === "" || name.toLowerCase().includes(needle)) &&
    (!off.includes(name) || name === scenario.current.modelName);
  const kind = picker.providers ?? "built_in";
  const builtIn = kind === "none" ? [] : LAYOUT_ALL.providers;
  const custom: PickerProviderGroup[] = kind === "custom"
    ? [{
      provider: CUSTOM_PROVIDER,
      label: "Local server",
      models: CUSTOM_MODELS.map((modelName) => ({
        provider: CUSTOM_PROVIDER,
        modelName,
      })),
    }]
    : [];
  const groups = [...builtIn, ...custom];
  // provider가 없으면 고른 model도 없다(core가 current null일 때 내는 값과 같다).
  const none = kind === "none";
  return {
    current: none ? { provider: "", modelName: "" } : scenario.current,
    currentLabel: none
      ? t("project-workspace.label.agent-no-model")
      : scenario.currentLabel,
    axes: none ? [] : scenario.axes,
    optionValues: none ? {} : scenario.optionValues,
    layout: {
      providers: groups
        .map((group) => ({
          ...group,
          models: group.models.filter((row) => matches(row.modelName)),
        }))
        .filter((group) => group.models.length > 0),
    },
    layer: picker.layer === undefined ? "global" : picker.layer,
  };
}

const ALL_COMMANDS: readonly SlashGroupView[] = [COMMANDS_GROUP, SKILLS_GROUP];

const NEEDS_SESSION = new Set([
  "rename",
  "archive",
  "compact",
  "fork",
  "permissions",
]);

function filterGroups(
  query: string,
  hasSession: boolean,
): readonly SlashGroupView[] {
  const needle = query.toLowerCase();
  const startsWord = (text: string, separator: RegExp) =>
    text.toLowerCase().split(separator).some((word) => word.startsWith(needle));
  return ALL_COMMANDS.map((group) => ({
    ...group,
    entries: group.entries.filter((entry) =>
      (hasSession || !NEEDS_SESSION.has(entry.name)) &&
      (needle === "" || entry.name.startsWith(needle) ||
        startsWord(entry.name, /-/) ||
        startsWord(entry.description, /\s+/))
    ),
  })).filter((group) => group.entries.length > 0);
}

// ---- fake ----

function ok<T>(value: T): Promise<SourceResult<T>> {
  return Promise.resolve({ ok: true, value });
}

function fail<T>(code: string): Promise<SourceResult<T>> {
  return Promise.resolve({ ok: false, code });
}

const DONE = ok<void>(undefined);

export function createFakeAgentTabSource(
  options: { scene?: AgentTabScene; picker?: FakePicker } = {},
): AgentTabSource {
  const picker = options.picker ?? {};
  const pickerView = (scenario: PickerScenario, query: string) =>
    modelView(scenario, query, picker);
  const data = sceneData(options.scene ?? "report");
  const bodies = new Map<string, readonly BodyPart[]>(
    Object.entries(data.bodies ?? {}),
  );
  const envelopes = new Map(Object.entries(data.envelopes ?? {}));
  const models = new Map<string, PickerScenario>();
  let sessions: SessionEntry[] = options.scene === "empty" ? [] : [
    {
      id: SESSION_MAIN,
      title: data.title,
      status: data.turn?.phase === "waiting"
        ? "waiting"
        : data.turn?.phase === "working"
        ? "working"
        : "idle",
      activeAt: at(-5),
      archived: false,
      skip: options.scene === "skip",
    },
    {
      id: SESSION_EARLIER,
      title: "Release notes check",
      status: "idle",
      activeAt: at(-2 * 24 * 60),
      archived: false,
      skip: false,
    },
    {
      id: SESSION_ARCHIVED,
      title: "Which docs are not linked",
      status: "idle",
      activeAt: at(-12 * 24 * 60),
      archived: true,
      skip: false,
    },
  ];
  const threads = new Map<string, ThreadView>();
  if (options.scene !== "empty") {
    threads.set(SESSION_MAIN, {
      entries: data.entries,
      turn: data.turn,
      tasks: data.tasks ?? [],
      queued: data.queued ?? [],
      pending: data.pending ?? EMPTY_THREAD.pending,
    });
    threads.set(SESSION_EARLIER, EMPTY_THREAD);
    threads.set(SESSION_ARCHIVED, {
      ...EMPTY_THREAD,
      entries: [
        user(30, -12 * 24 * 60, "Which folders in docs/ are not linked?"),
        agent(31, -12 * 24 * 60 + 2),
        {
          kind: "turn-end",
          id: "end-30",
          at: at(-12 * 24 * 60 + 3),
          turn: turnId(30),
          outcome: "completed",
          durationMs: 9_000,
        },
      ],
      turn: { id: turnId(30), phase: "ended", startedAt: at(-12 * 24 * 60) },
    });
    bodies.set(messageId(31), [{
      kind: "text",
      text:
        "Two: docs/drafts/ and docs/old-reports/. Nothing links to them and the newest file is from March.",
    }]);
  }
  for (const entry of data.entries) {
    if (entry.kind === "message" && entry.text !== null) {
      bodies.set(entry.id, [{ kind: "text", text: entry.text }]);
    }
  }
  for (const queued of data.queued ?? []) {
    bodies.set(queued.id, [{ kind: "text", text: queued.text }]);
  }

  const listeners = new Set<() => void>();
  let counter = 100;
  const nextId = (prefix: string) => fakeId(prefix, counter++);
  const notify = () => listeners.forEach((listener) => listener());
  const thread = (session: string) => threads.get(session) ?? EMPTY_THREAD;
  const change = (session: string, patch: (view: ThreadView) => ThreadView) => {
    threads.set(session, patch(thread(session)));
    notify();
    return DONE;
  };
  const patchSession = (session: string, patch: Partial<SessionEntry>) => {
    sessions = sessions.map((item) =>
      item.id === session ? { ...item, ...patch } : item
    );
  };
  const sessionOfTurn = (turn: string) =>
    [...threads].find(([, view]) => view.turn?.id === turn)?.[0];
  const sessionOfQueued = (queued: string) =>
    [...threads].find(([, view]) =>
      view.queued.some((item) => item.id === queued)
    )?.[0];
  const scenarioOf = (session: string | null) =>
    models.get(session ?? "new") ?? SCENARIOS[picker.current ?? ""] ?? SONNET;

  const source: AgentTabSource = {
    agent: () => ok(data.agent),
    sessions: () => ok([...sessions]),
    thread(session) {
      return sessions.some((item) => item.id === session)
        ? ok(thread(session))
        : fail("not_found");
    },
    body(message) {
      const parts = bodies.get(message);
      return parts === undefined ? fail("not_found") : ok(parts);
    },
    envelope(message) {
      const found = envelopes.get(message);
      return found === undefined ? fail("not_found") : ok(found);
    },
    callState(call) {
      for (const view of threads.values()) {
        for (const entry of view.entries) {
          if (entry.kind === "call" && entry.call.call === call) {
            return ok(entry.call.status);
          }
        }
      }
      return fail("not_found");
    },
    questions(session, toolCall) {
      const asked = thread(session).pending.questions;
      return asked?.toolCall === toolCall && asked.questions !== null
        ? ok(asked.questions)
        : fail("not_found");
    },

    model: (session, query) => ok(pickerView(scenarioOf(session), query)),
    chooseModel(session, model: PickerModelRef, query) {
      const target = SCENARIOS[model.modelName] ?? SONNET;
      models.set(session ?? "new", target);
      return ok(pickerView(target, query));
    },
    setModelOption(session, axis, value, query) {
      const current = scenarioOf(session);
      const next = {
        ...current,
        optionValues: { ...current.optionValues, [axis]: value },
      };
      models.set(session ?? "new", next);
      return ok(pickerView(next, query));
    },

    commands: (session, query) => ok(filterGroups(query, session !== null)),
    runCommand: () => DONE,
    permissions: () => ok(PERMISSIONS_VIEW),

    send({ session, id, text, delivery }) {
      bodies.set(id, [{ kind: "text", text }]);
      const view = thread(session);
      const running = view.turn?.phase === "working" ||
        view.turn?.phase === "waiting";
      if (session && sessions.some((item) => item.id === session)) {
        const known = sessions.find((item) => item.id === session)!;
        if (known.title === null) {
          patchSession(session, { title: text.slice(0, 60) });
        }
      }
      if (running && delivery === "next_turn") {
        return change(session, (current) => ({
          ...current,
          queued: [...current.queued, { id, at: at(50), text }],
        }));
      }
      const turn = running ? view.turn!.id : nextId("trn");
      patchSession(session, { status: "working" });
      return change(session, (current) => ({
        ...current,
        entries: [
          ...current.entries,
          user(0, 50, text, {
            id,
            delivery,
            turn,
          }),
        ],
        turn: running ? current.turn : {
          id: turn,
          phase: "working",
          startedAt: at(50),
        },
      }));
    },
    sendQueuedNow(queued) {
      const session = sessionOfQueued(queued);
      if (session === undefined) return fail("not_found");
      return change(session, (view) => {
        const item = view.queued.find((one) => one.id === queued)!;
        return {
          ...view,
          queued: view.queued.filter((one) => one.id !== queued),
          entries: [
            ...view.entries,
            user(0, 51, item.text, {
              id: item.id,
              delivery: "steer",
              turn: view.turn?.id ?? null,
            }),
          ],
        };
      });
    },
    removeQueued(queued) {
      const session = sessionOfQueued(queued);
      if (session === undefined) return fail("not_found");
      return change(session, (view) => ({
        ...view,
        queued: view.queued.filter((one) => one.id !== queued),
      }));
    },
    stop(turn) {
      const session = sessionOfTurn(turn);
      if (session === undefined) return fail("not_found");
      return change(session, (view) => ({
        ...view,
        turn: { ...view.turn!, phase: "ended" },
        tasks: [],
        pending: EMPTY_THREAD.pending,
        entries: [...view.entries, {
          kind: "turn-end",
          id: nextId("end"),
          at: at(52),
          turn,
          outcome: "stopped",
          durationMs: 4000,
        }],
      }));
    },
    retryTurn(turn) {
      const session = sessionOfTurn(turn);
      if (session === undefined) return fail("not_found");
      return change(session, (view) => ({
        ...view,
        turn: { ...view.turn!, phase: "working" },
        entries: view.entries.filter((entry) =>
          entry.kind !== "provider-error"
        ),
      }));
    },
    answerQuestions({ session, toolCall, answers }) {
      const asked = thread(session).pending.questions;
      if (asked?.toolCall !== toolCall) return fail("conflict");
      return change(session, (view) => ({
        ...view,
        turn: view.turn && { ...view.turn, phase: "working" },
        pending: { ...view.pending, questions: null },
        entries: [...view.entries, {
          kind: "questions",
          id: asked.group,
          at: at(51),
          group: asked.group,
          outcome: "submitted",
          lines: (asked.questions ?? []).map((question) => ({
            header: question.header,
            answer: answerText(answers, question),
          })),
        }],
      }));
    },
    decidePermission(session, request, choice, reason) {
      const approval = thread(session).pending.approval;
      if (approval?.id !== request) return fail("conflict");
      const denied = choice === "reject";
      return change(session, (view) => ({
        ...view,
        turn: view.turn && { ...view.turn, phase: "working" },
        pending: { ...view.pending, approval: null },
        entries: [...view.entries, {
          kind: "approval-result",
          id: request,
          at: at(51),
          result: {
            request,
            subject: approval.subject,
            outcome: denied ? "denied" : "allowed",
            choice: choice === "reject" ? null : choice,
            reason: reason ?? null,
          },
        }],
      }));
    },
    cancelCall(call) {
      for (const [session, view] of threads) {
        const found = view.entries.some((entry) =>
          entry.kind === "call" && entry.call.call === call
        );
        if (!found) continue;
        return change(session, (current) => ({
          ...current,
          entries: current.entries.map((entry) =>
            entry.kind === "call" && entry.call.call === call
              ? {
                ...entry,
                call: {
                  ...entry.call,
                  status: { state: "cancelled", reason: null },
                },
              }
              : entry
          ),
        }));
      }
      return fail("not_found");
    },

    openSession({ id }) {
      sessions = [...sessions, {
        id,
        title: null,
        status: "idle",
        activeAt: at(0),
        archived: false,
        skip: false,
      }];
      threads.set(id, EMPTY_THREAD);
      const picked = models.get("new");
      if (picked !== undefined) {
        models.set(id, picked);
        models.delete("new");
      }
      notify();
      return DONE;
    },
    renameSession(session, title) {
      patchSession(session, { title });
      notify();
      return DONE;
    },
    changeSkip(session, skip) {
      patchSession(session, { skip });
      notify();
      return DONE;
    },
    archiveSession(session) {
      patchSession(session, { archived: true });
      notify();
      return DONE;
    },
    deleteSession(session) {
      sessions = sessions.filter((item) => item.id !== session);
      threads.delete(session);
      notify();
      return DONE;
    },
    forkSession({ id, session, through }) {
      const origin = sessions.find((item) => item.id === session);
      if (origin === undefined) return fail("not_found");
      const entries = thread(session).entries;
      const last = through === null
        ? entries.length
        : entries.findIndex((entry) => entry.id === through) + 1;
      // fork는 skip을 가져가지 않는다.
      sessions = [...sessions, { ...origin, id, status: "idle", skip: false }];
      threads.set(id, {
        ...EMPTY_THREAD,
        entries: entries.slice(0, last).filter((entry) =>
          entry.kind === "message"
        ),
      });
      notify();
      return DONE;
    },
    compactSession: () => DONE,

    rewindPoints(session) {
      const hidden = new Set<string>();
      for (const entry of thread(session).entries) {
        if (entry.kind === "hidden") {
          entry.entries.forEach((inner) => hidden.add(inner.id));
        }
      }
      return ok(
        thread(session).entries.flatMap((entry) =>
          entry.kind === "message" && entry.actor === "user" &&
            entry.delivery === "next_turn" && !hidden.has(entry.id)
            ? [entry.id]
            : []
        ),
      );
    },
    rewindPreview: () => ok(REWIND_PREVIEW),
    rewind(session, message, choice) {
      const view = thread(session);
      const from = view.entries.findIndex((entry) => entry.id === message);
      if (from < 0 || view.turn?.phase === "working") return fail("conflict");
      const hidden = view.entries.slice(from);
      return change(session, (current) => ({
        ...current,
        entries: [...current.entries.slice(0, from), {
          kind: "hidden",
          id: nextId("rwd"),
          at: at(53),
          checkpoint: message,
          choice: choice.files ? "restore_all" : "messages_only",
          count: hidden.length,
          restored: choice.files ? REWIND_PREVIEW.files.length : 0,
          left: [],
          entries: hidden,
        }],
      }));
    },

    changed(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return source;
}

function answerText(
  answers: readonly QuestionAnswer[],
  question: AskedQuestion,
): string | null {
  const found = answers.find((item) => item.question === question.question);
  return found === undefined || found.status === "unanswered"
    ? null
    : found.answer.join(", ");
}
