// AgentTabSource의 메모리 fake. wireframe의 Agent 탭 장면 전부를 `scene` 이름으로 골라 낸다(gallery와 dev-mock이 쓴다).
// 대화는 session마다 ACP 상태(`AcpState`)이고, 쓰기는 ACP 갱신을 `reduceAcp`로 접어 상태를 바꾼 뒤 `changed`로
// 알린다. 그래서 장면 안에서 눌러 볼 수 있다. 시각과 id는 고정이다.

import { t } from "@lophn/i18n";
import {
  type AcpEntry,
  type AcpItem,
  type AcpMessageItem,
  type AcpNoticeItem,
  type AcpSender,
  type AcpState,
  type AcpToolItem,
  type AcpTurn,
  acpNoticeId,
  EMPTY_ACP_STATE,
  reduceAcp,
  type AcpUpdate,
} from "../../../protocol/acp/mod.ts";
import type { AgentValueLayer } from "../../../protocol/lophn-agent/agent-definitions.ts";
import { blocksText } from "../../../protocol/lophn-agent/content-block.ts";
import { COMMANDS_GROUP, SKILLS_GROUP } from "./agent-tab-fake-commands.ts";
import {
  effortLowToMax,
  HAIKU,
  LAYOUT_ALL,
  OPUS,
  type PickerScenario,
  SOL,
  SONNET,
} from "./agent-tab-fake-models.ts";
import type {
  AgentFace,
  AgentTabSource,
  Envelope,
  ModelView,
  PermissionsView,
  QuestionAnswer,
  RewindPreviewView,
  SessionEntry,
  SessionSearchMatch,
  SourceResult,
  StatusView,
  ToolCallBodyView,
} from "./agent-tab-source.ts";
import { rewindPointsOf } from "./agent-view-model.ts";
import type {
  PickerModelRef,
  PickerProviderGroup,
} from "./model-picker/types.ts";
import type { SlashGroupView } from "./slash-menu/types.ts";

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
  /** 도는 편집과 call. 종류가 시작 때부터 있어 일반 tool 줄이 아닌 카드와 블록으로 그려진다. */
  "tool-running",
  /** 실패·거절한 편집과 call. 종류를 지키고 실패 표시가 붙는다. */
  "tool-failed",
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
  agent: "lophn",
  name: "lophn",
  profile: { kind: "character", shape: "pear", color: "lavender" },
  place: { kind: "project", name: "phroner" },
  permissionSummary: "2 apps assigned",
};

const EVAL_ANALYST: AgentFace = {
  agent: fakeId("agt", 1),
  name: "Eval analyst",
  profile: { kind: "character", shape: "wide", color: "yellow" },
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

// report 장면의 agent 답. 수식·diagram·목록을 한 글에 담아 markdown 그리기를 다 보인다.
const REPORT_ANSWER = [
  "I wrote the report from the three findings. The regression share fell to $0.4\\%$ this week:",
  "",
  "$$",
  "\\text{regressions} = \\frac{11}{24}",
  "$$",
  "",
  "```mermaid",
  "flowchart LR",
  "  edit[plan edit] --> lookup[recipe lookup]",
  "  lookup --> gap[query-recipe-gap]",
  "```",
].join("\n");

// working 장면에서 쓰는 중인 글. 짧은 문단, 목록 하나, 닫히지 않은 ts code fence로 끝난다.
const LIVE_TEXT = [
  "F-011 is the query-recipe-gap regression. The other two changed for the same reason:",
  "",
  "- sched-edit calls the recipe lookup right after a plan edit",
  "- wake-plant rebuilds its schedule with the same lookup",
  "",
  "I am checking the run log before I write this into the report.",
  "",
  "```ts",
  "const recipe = await lookup(",
].join("\n");

// report·skip 장면의 agent 답 앞 reasoning. provider summary처럼 굵은 제목 한 줄과 두세 문장이다.
const REASONING = [
  "**Checked the three findings against last week's reports**",
  "All three regressions touch the recipe lookup, and the run logs show the same stale cache read before each failure. The report states this once instead of repeating it for each finding.",
].join("\n\n");

// question-answered 장면에서 쓰는 중인 reasoning. 아직 답 글이 시작하지 않아 "Thinking"으로 보인다.
const LIVE_REASONING =
  "I have both answers. Next I write the weekly report into docs/reports/ with the two sections you picked.";

// ---- 장면이 쓰는 값 ----

function user(
  n: number,
  minutes: number,
  text: string,
  over: Partial<AcpMessageItem> = {},
): AcpMessageItem {
  return {
    kind: "message",
    id: messageId(n),
    seq: 0,
    at: at(minutes),
    actor: "user",
    sender: null,
    call: null,
    reply_to: null,
    delivery: "next_turn",
    turn: turn1,
    content: text === "" ? [] : [{ type: "text", text }],
    reasoning: null,
    cards: [],
    complete: true,
    ...over,
  };
}

function agent(
  n: number,
  minutes: number,
  text: string,
  over: Partial<AcpMessageItem> = {},
): AcpMessageItem {
  return user(n, minutes, text, { actor: "agent", ...over });
}

/** tool call 하나. 시각은 장면의 분 단위 시각이다. */
function tool(
  n: number,
  minutes: number,
  fields: Pick<AcpToolItem, "tool" | "category" | "title">,
  over: Partial<AcpToolItem> = {},
): AcpToolItem {
  return {
    kind: "tool",
    id: toolId(n),
    seq: 0,
    at: at(minutes),
    turn: turn1,
    ...fields,
    state: "ok",
    duration_ms: 1_200,
    detail: { kind: "generic" },
    ...over,
  };
}

// report 장면: 탐색 묶음 하나와 description을 제목으로 쓰는 command 하나.
const REPORT_CALLS: readonly AcpToolItem[] = [
  tool(
    1,
    41,
    {
      tool: "file.read",
      category: "read",
      title: "Read docs/reports/2026-w39.md",
    },
    { duration_ms: 900 },
  ),
  tool(
    2,
    41,
    {
      tool: "file.read",
      category: "read",
      title: "Read eval/findings.md",
    },
    { duration_ms: 700 },
  ),
  tool(
    3,
    41,
    {
      tool: "file.grep",
      category: "search",
      title: "Search regression in eval",
    },
    { duration_ms: 2_400 },
  ),
  tool(
    4,
    41,
    {
      tool: "file.glob",
      category: "list",
      title: "List eval/runs/*.json",
    },
    { duration_ms: 300 },
  ),
  tool(
    5,
    42,
    {
      tool: "shell.run",
      category: "command",
      title: "Count regressions per scenario",
    },
    { duration_ms: 3_100 },
  ),
];

// working 장면: 끝난 command와 도는 command 하나.
const WORKING_CALLS: readonly AcpToolItem[] = [
  tool(
    6,
    41,
    {
      tool: "shell.run",
      category: "command",
      title: "Run the weekly eval",
    },
    { duration_ms: 4_200 },
  ),
  tool(
    7,
    41,
    {
      tool: "shell.run",
      category: "command",
      title: "Check the run log",
    },
    {
      state: "running",
      at: new Date(NOW - 5_000).toISOString(),
      duration_ms: null,
    },
  ),
];

function inputBody(value: unknown): ToolCallBodyView {
  return { value, truncated: false };
}

function resultBody(summary: string, content: unknown): ToolCallBodyView {
  return {
    value: {
      status: "success",
      summary,
      content,
      complete: true,
      source: null,
      continuation: null,
      pending: [],
    },
    truncated: false,
  };
}

function shellBody(stdout: string): ToolCallBodyView {
  return resultBody("exit code 0", {
    exit_code: 0,
    timed_out: false,
    stdout,
    stderr: "",
    stdout_truncated: false,
    stderr_truncated: false,
  });
}

/** 편집 카드가 되는 tool call. [Show diff]가 읽는 입력이 `toolBodies`에 있다. */
const EDIT_TOOL = toolId(8);

// 편집 카드의 [Show diff]가 읽는 file.edit 입력. 앞뒤 글에서 unified diff를 만든다.
const REPORT_EDIT_INPUT = inputBody({
  path: "docs/reports/2026-w41.md",
  old_string: "## Regressions\n\n- F-011 query-recipe-gap\n- F-012 sched-edit",
  new_string:
    "## Regressions\n\n- F-011 query-recipe-gap — fixed in 0.10.3\n- F-012 sched-edit — still open\n- F-014 tool-retry-loop",
});

const REPORT_TOOL_BODIES: SceneData["toolBodies"] = {
  [EDIT_TOOL]: { input: REPORT_EDIT_INPUT },
  [toolId(1)]: {
    input: inputBody({ path: "docs/reports/2026-w39.md" }),
    output: resultBody("read docs/reports/2026-w39.md lines 1-28", {
      text: "# Week 39\n\nRegressions: 2\nImprovements: 5",
      start_line: 1,
      end_line: 28,
      total_lines: 28,
    }),
  },
  [toolId(2)]: {
    input: inputBody({ path: "eval/findings.md" }),
    output: resultBody("read eval/findings.md lines 1-16", {
      text: "## Findings\n\n- F-011 query-recipe-gap\n- F-012 sched-edit",
      start_line: 1,
      end_line: 16,
      total_lines: 16,
    }),
  },
  [toolId(3)]: {
    input: inputBody({ pattern: "regression", path: "eval" }),
    output: resultBody("found 3 matches", {
      matches: [
        { path: "eval/findings.md", line: 4, text: "- F-011 query-recipe-gap" },
        { path: "eval/findings.md", line: 5, text: "- F-012 sched-edit" },
      ],
    }),
  },
  [toolId(4)]: {
    input: inputBody({ pattern: "eval/runs/*.json" }),
    output: resultBody("found 6 files", {
      paths: [
        "eval/runs/week-37.json",
        "eval/runs/week-38.json",
        "eval/runs/week-39.json",
        "eval/runs/week-40.json",
      ],
    }),
  },
  [toolId(5)]: {
    input: inputBody({
      command: "rg -c regression eval/runs/*.json | sort -t: -k2 -nr",
      description: "Count regressions per scenario",
    }),
    // 64 KiB를 넘는 결과는 JSON 글의 앞부분 문자열로 온다.
    output: {
      truncated: true,
      value:
        '{"status":"success","summary":"exit code 0","content":{"exit_code":0,"stdout":"11 eval/runs/week-39.json\\n8 eval/runs/week-40.json\\n',
    },
  },
};

const WORKING_TOOL_BODIES: SceneData["toolBodies"] = {
  [EDIT_TOOL]: { input: REPORT_EDIT_INPUT },
  [toolId(6)]: {
    input: inputBody({
      command: "npm run eval -- --week 41",
      description: "Run the weekly eval",
    }),
    output: shellBody("Ran 24 scenarios: 21 passed, 3 failed."),
  },
  // 도는 call은 아직 출력이 없다(not_found).
  [toolId(7)]: {
    input: inputBody({
      command: "tail -n 40 .dev-data/eval/run.log",
      description: "Check the run log",
    }),
  },
};

const reportEdit = (minutes: number): AcpToolItem =>
  tool(
    8,
    minutes,
    {
      tool: "file.edit",
      category: "other",
      title: "Edit docs/reports/2026-w41.md",
    },
    {
      detail: {
        kind: "edit",
        document: fakeId("doc", 1),
        path: "docs/reports/2026-w41.md",
        added: 3,
        removed: 2,
      },
    },
  );

const turnEnd = (
  minutes: number,
  activeMs: number,
  waitedMs: number,
): AcpNoticeItem => ({
  kind: "notice",
  id: acpNoticeId(turn1),
  seq: 0,
  at: at(minutes),
  turn: turn1,
  notice: {
    type: "turn_end",
    outcome: "completed",
    active_ms: activeMs,
    waited_ms: waitedMs,
  },
});

const turnOf = (phase: AcpTurn["phase"]): AcpTurn => ({
  id: turn1,
  phase,
  started_at: at(41),
  elapsed: phase === "ended" ? null : { active_ms: 0, at: at(41) },
});

/** 항목에 1부터 순번을 붙여 상태를 만든다. */
function numbered(
  items: readonly AcpItem[],
  extra: Partial<AcpState> = {},
): AcpState {
  const numbered = items.map((item, index) => ({
    ...item,
    seq: index + 1,
  })) as AcpItem[];
  return {
    ...EMPTY_ACP_STATE,
    seq: numbered.length,
    items: numbered,
    ...extra,
  };
}

const fromEnvelope = (sender: Envelope["sender"]): AcpSender =>
  sender.kind === "program"
    ? { kind: "program" }
    : { kind: "agent", agent: sender.agent, name: sender.name };

function received(
  n: number,
  minutes: number,
  text: string,
  sender: Envelope["sender"],
  over: Partial<AcpMessageItem> = {},
): AcpMessageItem {
  return user(n, minutes, text, {
    actor: "received",
    sender: fromEnvelope(sender),
    turn: null,
    ...over,
  });
}

function call(
  n: number,
  minutes: number,
  detail: Omit<
    Extract<AcpToolItem["detail"], { kind: "call" }>,
    "kind" | "call"
  >,
): AcpToolItem {
  return tool(
    20 + n,
    minutes,
    {
      tool: "call.send",
      category: "other",
      title: `Send a call to ${detail.to}`,
    },
    { detail: { kind: "call", call: callId(n), ...detail } },
  );
}

// 종류는 시작 때부터 있다. 입력에서 뽑는 칸은 차 있고, 보내지 못한 call은 id와 상태가 없다.
const editOf = (
  n: number,
  minutes: number,
  state: AcpToolItem["state"],
  path: string,
): AcpToolItem =>
  tool(
    n,
    minutes,
    { tool: "file.edit", category: "other", title: `Edit ${path}` },
    {
      state,
      duration_ms: state === "running" ? null : 300,
      detail: {
        kind: "edit",
        document: fakeId("doc", n),
        path,
        added: 4,
        removed: 1,
      },
    },
  );

const unsentCall = (
  n: number,
  minutes: number,
  state: AcpToolItem["state"],
): AcpToolItem =>
  tool(
    20 + n,
    minutes,
    {
      tool: "call.send",
      category: "other",
      title: "Send a call to Eval analyst",
    },
    {
      state,
      duration_ms: state === "running" ? null : 300,
      detail: {
        kind: "call",
        call: null,
        to: "Eval analyst",
        task: "Find what the 3 regressions have in common.",
        reply: "result",
        state: null,
        fail_reason: null,
        session: null,
      },
    },
  );

const CALL_HANDOFF = {
  to: "lophn · Recipes",
  task: "The person wants a weekly meal plan screen in Recipes. Decided: plans by week, one recipe per meal.",
  reply: "none",
  state: "done",
  fail_reason: null,
  session: sessionId(12),
} as const;

const CALL_OPEN = {
  to: "Eval analyst",
  task: "Find what the 3 regressions have in common.",
  reply: "result",
  state: "accepted",
  fail_reason: null,
  session: sessionId(10),
} as const;

const CALL_FAILED = {
  to: "Experiment planner",
  task: "Plan exp-013 so it isolates the recipe lookup.",
  reply: "result",
  state: "failed",
  fail_reason: "receiver_ended",
  session: sessionId(8),
} as const;

const CALL_CANCELLED = {
  to: "lophn · phroner",
  task: "Check the eval context against the new reports.",
  reply: "result",
  state: "cancelled",
  fail_reason: null,
  session: sessionId(11),
} as const;

type AskedQuestions = NonNullable<
  NonNullable<AcpState["pending"]["question"]>["questions"]
>;

const ASKED: AskedQuestions = [
  {
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

/** 사람에게 묻는 `ask` tool call. 풀리기 전에는 outcome이 null이다. */
function askTool(
  detail: Extract<AcpToolItem["detail"], { kind: "question" }>,
  over: Partial<AcpToolItem> = {},
): AcpToolItem {
  return tool(
    4,
    41,
    { tool: "ask", category: "other", title: "Ask the person" },
    { detail, ...over },
  );
}

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
  state: AcpState;
  envelopes?: Record<string, Envelope>;
  /** call id별 입력·출력. 없는 칸은 not_found다. */
  toolBodies?: Record<
    string,
    {
      readonly input?: ToolCallBodyView;
      readonly output?: ToolCallBodyView;
    }
  >;
}

function sceneData(scene: AgentTabScene): SceneData {
  switch (scene) {
    case "report":
    case "skip":
      return {
        agent: LOPHN,
        title: "Week 41 summary",
        state: numbered(
          [
            user(1, 41, REQUEST),
            ...REPORT_CALLS,
            agent(2, 42, REPORT_ANSWER, {
              reasoning: { text: REASONING, duration_ms: 12_000 },
            }),
            reportEdit(42),
            turnEnd(43, 18_000, 0),
          ],
          { turn: turnOf("ended") },
        ),
        toolBodies: REPORT_TOOL_BODIES,
      };
    case "working":
    case "rewind":
    case "queued": {
      const items: AcpItem[] = [
        user(1, 41, REQUEST),
        agent(
          2,
          41,
          "F-011 is a regression on query-recipe-gap. Here is the run from Eval board.",
          { cards: [{ app: appId(1), view: "run" }] },
        ),
        reportEdit(41),
        ...WORKING_CALLS,
      ];
      const steer = scene !== "queued";
      if (steer) {
        items.push(
          user(3, 42, "Also add the exp-008 numbers to the report.", {
            delivery: "steer",
          }),
          agent(
            4,
            42,
            "Got it. I will add the exp-008 numbers when I reach the regression section.",
          ),
        );
      }
      return {
        agent: LOPHN,
        title: "Week 41 summary",
        state: numbered(items, {
          turn: turnOf("working"),
          writing:
            scene === "working"
              ? {
                  turn: turn1,
                  model_call: fakeId("mcl", 1),
                  text: LIVE_TEXT,
                  reasoning: "",
                  at: at(42),
                }
              : null,
          queued: steer
            ? []
            : [
                {
                  id: messageId(5),
                  at: at(42),
                  content: [
                    {
                      type: "text",
                      text: "Also add the exp-008 numbers to the report.",
                    },
                  ],
                },
                {
                  id: messageId(6),
                  at: at(43),
                  content: [
                    {
                      type: "text",
                      text: "Then check the latency table against the raw runs.",
                    },
                  ],
                },
              ],
        }),
        toolBodies: WORKING_TOOL_BODIES,
      };
    }
    case "request-error":
      return {
        agent: LOPHN,
        title: "Week 41 summary",
        state: numbered(
          [
            user(1, 41, REQUEST),
            {
              kind: "notice",
              id: acpNoticeId(turn1),
              seq: 0,
              at: at(42),
              turn: turn1,
              notice: {
                type: "error",
                code: "request_rejected",
                message:
                  "OpenAI rejected the request (400): the Priority speed option is not enabled for this account. Nothing was changed.",
              },
            },
          ],
          { turn: turnOf("ended") },
        ),
      };
    case "sender-chips": {
      const notice = envelope(
        { kind: "program", label: null },
        "The nightly eval moved to 08:00. The next run starts in 20 minutes.",
        [
          {
            kind: "session",
            text: "Claude Code · Eval board",
            target: sessionId(9),
          },
        ],
        null,
      );
      const lophn = envelope(
        { kind: "agent", agent: "lophn", name: "lophn" },
        "Keep the scenario names in Eval board as they are. A person asked for that, so do not rename them in the fix.",
        [
          {
            kind: "annotation",
            text: "Scenario list",
            target: fakeId("ann", 12),
          },
        ],
        { id: SESSION_EARLIER, title: "Weekly report" },
      );
      return {
        agent: EVAL_ANALYST,
        title: "Eval board keeps crashing",
        state: numbered(
          [
            received(
              1,
              30,
              "The nightly eval moved to 08:00. The next run starts in 20 minutes.",
              notice.sender,
            ),
            received(
              2,
              36,
              "About the fix for P-12: keep the scenario names as they are.",
              lophn.sender,
            ),
          ],
          { turn: turnOf("working") },
        ),
        envelopes: {
          [messageId(1)]: notice,
          [messageId(2)]: lophn,
        },
      };
    }
    case "call-open":
      return {
        agent: LOPHN,
        title: "Week 41 summary",
        state: numbered(
          [
            user(1, 43, "Why did those 3 scenarios regress?"),
            agent(
              2,
              44,
              "I will ask the Eval analyst to look for what they have in common, and go on with the report meanwhile.",
            ),
            call(4, 44, CALL_HANDOFF),
            call(1, 44, CALL_OPEN),
            agent(
              3,
              45,
              "While that runs, I am drafting the sections that do not need it. I cancelled the check on the eval context, because the answer changed nothing.",
            ),
            call(2, 47, CALL_CANCELLED),
          ],
          { turn: turnOf("working") },
        ),
      };
    case "tool-running":
      return {
        agent: LOPHN,
        title: "Week 41 summary",
        state: numbered(
          [
            user(1, 41, REQUEST),
            agent(
              2,
              42,
              "I am updating the report and asking the Eval analyst about the regressions.",
            ),
            editOf(1, 42, "running", "docs/reports/2026-w41.md"),
            unsentCall(1, 42, "running"),
          ],
          { turn: turnOf("working") },
        ),
      };
    case "tool-failed":
      return {
        agent: LOPHN,
        title: "Week 41 summary",
        state: numbered(
          [
            user(1, 41, REQUEST),
            agent(2, 42, "Some changes did not go through."),
            editOf(1, 42, "error", "docs/reports/2026-w41.md"),
            editOf(2, 42, "denied", "docs/reports/2026-w40.md"),
            unsentCall(1, 43, "error"),
            unsentCall(2, 43, "denied"),
          ],
          { turn: turnOf("ended") },
        ),
      };
    case "call-replies": {
      const answer = envelope(
        { kind: "agent", agent: fakeId("agt", 1), name: "Eval analyst" },
        "The 3 regressions share one cause: query-recipe-gap, sched-edit and wake-plant all call the lookup right after a plan edit.",
        [
          {
            kind: "file",
            text: "eval/experiments/exp-008-query-tools.md",
            target: "eval/experiments/exp-008-query-tools.md",
          },
        ],
        { id: sessionId(8), title: "Regression on query-recipe-gap" },
      );
      const notice = envelope(
        { kind: "program", label: "lophn · Not answered" },
        "The session of Experiment planner ended before it answered your request.",
        [],
        null,
      );
      return {
        agent: LOPHN,
        title: "Week 41 summary",
        state: numbered(
          [
            call(1, 44, { ...CALL_OPEN, state: "done" }),
            received(1, 48, answer.task, answer.sender, {
              reply_to: callId(1),
            }),
            call(3, 49, CALL_FAILED),
            received(2, 50, notice.task, notice.sender, {
              reply_to: callId(3),
            }),
          ],
          { turn: turnOf("ended") },
        ),
        envelopes: { [messageId(1)]: answer, [messageId(2)]: notice },
      };
    }
    case "question":
      return {
        agent: LOPHN,
        title: "Weekly report",
        state: numbered(
          [
            user(1, 41, REQUEST),
            agent(2, 41, QUESTION_LEAD),
            askTool(
              { kind: "question", group: groupId(1), outcome: null, lines: [] },
              { state: "running", duration_ms: null },
            ),
          ],
          {
            turn: turnOf("waiting"),
            pending: {
              approval: null,
              question: {
                group: groupId(1),
                tool_call: toolId(4),
                questions: ASKED,
              },
            },
          },
        ),
      };
    case "question-answered":
      return {
        agent: LOPHN,
        title: "Weekly report",
        state: numbered(
          [
            user(1, 41, REQUEST),
            agent(2, 41, QUESTION_LEAD),
            askTool({
              kind: "question",
              group: groupId(1),
              outcome: "submitted",
              lines: [
                { header: "Report place", answer: "docs/reports/" },
                { header: "Sections", answer: "Improvements, Regressions" },
              ],
            }),
            agent(
              3,
              41,
              "Thanks. I am writing the report into docs/reports/ with the sections you picked.",
            ),
          ],
          {
            turn: turnOf("working"),
            writing: {
              turn: turn1,
              model_call: fakeId("mcl", 2),
              at: at(41),
              text: "",
              reasoning: LIVE_REASONING,
            },
          },
        ),
      };
    case "question-ended":
      return {
        agent: LOPHN,
        title: "Weekly report",
        state: numbered(
          [
            user(1, 41, REQUEST),
            agent(2, 41, QUESTION_LEAD),
            askTool({
              kind: "question",
              group: groupId(1),
              outcome: "human_message",
              lines: ASKED.map((question) => ({
                header: question.header,
                answer: null,
              })),
            }),
            user(
              3,
              42,
              "Just put it in docs/reports/ with the regressions, no other sections.",
            ),
            agent(
              4,
              42,
              "Understood. docs/reports/ with the regressions section only.",
            ),
          ],
          { turn: turnOf("working") },
        ),
      };
    case "approval":
      return {
        agent: LOPHN,
        title: "Weekly report",
        state: numbered([user(1, 41, REQUEST), agent(2, 41, CLEANUP_LEAD)], {
          turn: turnOf("waiting"),
          pending: {
            approval: {
              id: requestId(1),
              subject: { kind: "shell", command: CLEANUP_COMMAND },
              always_patterns: ["rm -r *"],
            },
            question: null,
          },
        }),
      };
    case "approval-states": {
      const result = (
        n: number,
        outcome: "allowed" | "denied" | "cancelled",
        choice: "once" | "always" | null,
        reason: string | null,
      ): AcpItem => ({
        kind: "approval",
        id: requestId(n),
        seq: 0,
        at: at(41),
        subject: { kind: "shell", command: CLEANUP_COMMAND },
        outcome,
        choice,
        reason,
      });
      return {
        agent: LOPHN,
        title: "Weekly report",
        state: numbered(
          [
            user(1, 41, "Go on with the cleanup."),
            result(1, "allowed", "once", null),
            result(2, "allowed", "always", null),
            result(3, "denied", null, "Keep last week's report for now."),
            result(4, "cancelled", null, null),
            turnEnd(43, 3_900_000, 300_000),
          ],
          { turn: turnOf("ended") },
        ),
      };
    }
    case "empty":
      return {
        agent: LOPHN,
        title: "",
        state: EMPTY_ACP_STATE,
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

// 구독 OAuth 연결의 session. 금액은 구독이라 알 수 없고 token만 보인다.
const statusView = (session: string): StatusView => ({
  session,
  title: "Weekly report",
  model: { name: "gpt-6.1-sol", options: { effort: "high" } },
  provider: {
    name: "OpenAI",
    definition: "openai",
    account: "me@example.com",
    state: "available",
    until: null,
  },
  context: { tokens: 86_508, limit: 1_050_000 },
  calls: 14,
  turns: 3,
  inputTokens: 412_890,
  outputTokens: 11_531,
  cacheReadTokens: 301_440,
  cacheWriteTokens: 0,
  costs: [{ kind: "subscription", currency: null, amount: null }],
});

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
  /** Manage models에서 켠 model 이름. 없으면 모두 보인다. 켠 것만 목록에 남고 지금 고른 model은 꺼져 있어도 남는다. */
  readonly shown?: readonly string[];
}

function modelView(
  scenario: PickerScenario,
  query: string,
  picker: FakePicker,
): ModelView {
  const needle = query.trim().toLowerCase();
  const on = picker.shown;
  const matches = (name: string) =>
    (needle === "" || name.toLowerCase().includes(needle)) &&
    (on === undefined ||
      on.includes(name) ||
      name === scenario.current.modelName);
  const kind = picker.providers ?? "built_in";
  const builtIn = kind === "none" ? [] : LAYOUT_ALL.providers;
  const custom: PickerProviderGroup[] =
    kind === "custom"
      ? [
          {
            provider: CUSTOM_PROVIDER,
            label: "Local server",
            models: CUSTOM_MODELS.map((modelName) => ({
              provider: CUSTOM_PROVIDER,
              modelName,
            })),
          },
        ]
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
  "status",
]);

function filterGroups(
  query: string,
  hasSession: boolean,
): readonly SlashGroupView[] {
  const needle = query.toLowerCase();
  const startsWord = (text: string, separator: RegExp) =>
    text
      .toLowerCase()
      .split(separator)
      .some((word) => word.startsWith(needle));
  return ALL_COMMANDS.map((group) => ({
    ...group,
    entries: group.entries.filter(
      (entry) =>
        (hasSession || !NEEDS_SESSION.has(entry.name)) &&
        (needle === "" ||
          entry.name.startsWith(needle) ||
          startsWord(entry.name, /-/) ||
          startsWord(entry.description, /\s+/)),
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

const SEARCH_SNIPPET_BEFORE = 40;
const SEARCH_SNIPPET_AFTER = 80;
const SEARCH_MATCH_MAX = 20;

/** 처음 맞은 곳 앞뒤를 한 줄로 줄인다. core의 SearchSessionMessages와 같은 모양이다. */
function searchSnippet(text: string, needle: string): string | null {
  const flat = text.replace(/\s+/g, " ").trim();
  const at = flat.toLowerCase().indexOf(needle);
  if (at === -1) return null;
  const start = Math.max(0, at - SEARCH_SNIPPET_BEFORE);
  const end = Math.min(flat.length, at + needle.length + SEARCH_SNIPPET_AFTER);
  return `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
}

/** 숨긴 구간 안의 항목도 기록이므로 같이 본다. */
function allItems(items: readonly AcpItem[]): readonly AcpEntry[] {
  return items.flatMap((item) =>
    item.kind === "hidden" ? allItems(item.items) : [item],
  );
}

export function createFakeAgentTabSource(
  options: {
    scene?: AgentTabScene;
    picker?: FakePicker;
    /** status panel과 푸터가 읽는 값. 준 칸만 기본값을 덮는다(예: 창 사용률이 높은 상태). */
    status?: Partial<StatusView>;
    /** 보낸 말과 시작한 turn의 시각. 없으면 장면의 고정 시각이다(gallery). */
    now?: () => number;
  } = {},
): AgentTabSource {
  const sentAt = () =>
    options.now === undefined ? at(50) : new Date(options.now()).toISOString();
  const picker = options.picker ?? {};
  const pickerView = (scenario: PickerScenario, query: string) =>
    modelView(scenario, query, picker);
  const data = sceneData(options.scene ?? "report");
  const envelopes = new Map(Object.entries(data.envelopes ?? {}));
  const models = new Map<string, PickerScenario>();
  let sessions: SessionEntry[] =
    options.scene === "empty"
      ? []
      : [
          {
            id: SESSION_MAIN,
            title: data.title,
            status:
              data.state.turn?.phase === "waiting"
                ? "waiting"
                : data.state.turn?.phase === "working"
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
            title: data.title,
            status: "idle",
            activeAt: at(-12 * 24 * 60),
            archived: true,
            skip: false,
          },
        ];
  const states = new Map<string, AcpState>();
  if (options.scene !== "empty") {
    states.set(SESSION_MAIN, data.state);
    states.set(SESSION_EARLIER, EMPTY_ACP_STATE);
    // archive한 session도 report 장면과 같은 기록을 보인다.
    states.set(SESSION_ARCHIVED, {
      ...EMPTY_ACP_STATE,
      seq: data.state.seq,
      items: data.state.items,
      turn: data.state.turn,
    });
  }

  const listeners = new Set<() => void>();
  let counter = 100;
  const nextId = (prefix: string) => fakeId(prefix, counter++);
  // 올린 이미지의 blob 주소. 메모리에만 있다.
  const images = new Map<string, string>();
  const notify = () => listeners.forEach((listener) => listener());
  const stateOf = (session: string) => states.get(session) ?? EMPTY_ACP_STATE;
  /** 상태를 바꾸고 알린다. 갱신이 없는 변경(대기 줄 고치기 등)도 이 길로 낸다. */
  const change = (session: string, next: (state: AcpState) => AcpState) => {
    states.set(session, next(stateOf(session)));
    notify();
    return DONE;
  };
  /** ACP 갱신을 `reduceAcp`로 접는다. core가 내는 갱신과 같은 모양이다. */
  const apply = (session: string, ...updates: readonly AcpUpdate[]) =>
    change(session, (state) => updates.reduce(reduceAcp, state));
  const patchSession = (session: string, patch: Partial<SessionEntry>) => {
    sessions = sessions.map((item) =>
      item.id === session ? { ...item, ...patch } : item,
    );
  };
  const sessionOfTurn = (turn: string) =>
    [...states].find(([, state]) => state.turn?.id === turn)?.[0];
  const sessionOfQueued = (queued: string) =>
    [...states].find(([, state]) =>
      state.queued.some((item) => item.id === queued),
    )?.[0];
  /** 이 call을 든 tool 항목. */
  const callItemOf = (call: string) => {
    for (const [session, state] of states) {
      for (const item of state.items) {
        if (
          item.kind === "tool" &&
          item.detail.kind === "call" &&
          item.detail.call === call
        ) {
          return { session, state, item, detail: item.detail };
        }
      }
    }
    return undefined;
  };
  const stopTurn = (turn: string): Promise<SourceResult<void>> => {
    const session = sessionOfTurn(turn);
    if (session === undefined) return fail("not_found");
    return apply(session, {
      type: "turn_ended",
      turn,
      at: at(52),
      outcome: "stopped",
      active_ms: 4000,
      error: null,
      messages: [],
      seq: stateOf(session).seq + 1,
    });
  };
  // 실패했거나 끝난 turn을 다시 도는 모습으로 되돌린다. fake는 turn의 입력 글을 보관하지 않아 그것을 새로 보내지
  // 않고, 화면에서 오류 줄의 [Retry]를 눌렀을 때 turn이 다시 서는 모습만 보인다.
  const restartTurn = (turn: string): Promise<SourceResult<void>> => {
    const session = sessionOfTurn(turn);
    if (session === undefined) return fail("not_found");
    return change(session, (state) =>
      reduceAcp(
        {
          ...state,
          items: state.items.filter(
            (item) => !(item.kind === "notice" && item.notice.type === "error"),
          ),
        },
        { type: "turn_started", turn: nextId("trn"), at: sentAt() },
      ),
    );
  };
  const scenarioOf = (session: string | null) =>
    models.get(session ?? "new") ?? SCENARIOS[picker.current ?? ""] ?? SONNET;

  const source: AgentTabSource = {
    agent: () => ok(data.agent),
    sessions: () => ok([...sessions]),
    searchMessages(query) {
      const needle = query.trim().toLowerCase();
      if (needle === "") return ok([]);
      const matches: SessionSearchMatch[] = [];
      for (const entry of sessions) {
        const state = states.get(entry.id);
        if (state === undefined) continue;
        for (const item of allItems(state.items)) {
          if (item.kind !== "message" || item.actor === "received") continue;
          const snippet = searchSnippet(blocksText(item.content), needle);
          if (snippet === null) continue;
          matches.push({
            session: entry.id,
            message: item.id,
            at: item.at,
            snippet,
          });
        }
      }
      matches.sort((a, b) => b.at.localeCompare(a.at));
      return ok(matches.slice(0, SEARCH_MATCH_MAX));
    },
    acp(session) {
      return sessions.some((item) => item.id === session)
        ? ok(stateOf(session))
        : fail("not_found");
    },
    envelope(message) {
      const found = envelopes.get(message);
      return found === undefined ? fail("not_found") : ok(found);
    },
    callState(call) {
      const found = callItemOf(call);
      return found === undefined || found.detail.state === null
        ? fail("not_found")
        : ok({ state: found.detail.state, reason: found.detail.fail_reason });
    },
    toolCallBody(toolCall, part) {
      const found = data.toolBodies?.[toolCall]?.[part];
      return found === undefined ? fail("not_found") : ok(found);
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
    status: (session) =>
      ok({ ...statusView(session), ...options.status, session }),

    uploadImage(image) {
      const blob = nextId("blob");
      images.set(blob, URL.createObjectURL(image));
      return ok({ blob });
    },
    imageUrl: (_session, id) => Promise.resolve(images.get(id) ?? null),

    send({ session, id, content, delivery }) {
      const text = blocksText(content);
      const state = stateOf(session);
      const running =
        state.turn?.phase === "working" || state.turn?.phase === "waiting";
      if (session && sessions.some((item) => item.id === session)) {
        const known = sessions.find((item) => item.id === session)!;
        if (known.title === null && text !== "") {
          patchSession(session, { title: text.slice(0, 60) });
        }
      }
      const startedAt = sentAt();
      if (running && delivery === "next_turn") {
        return apply(session, {
          type: "message_queued",
          queued: { id, at: startedAt, content: [...content] },
        });
      }
      const turn = running ? state.turn!.id : nextId("trn");
      patchSession(session, { status: "working" });
      return apply(
        session,
        ...(running
          ? []
          : [{ type: "turn_started", turn, at: startedAt } as const]),
        {
          type: "message_added",
          item: {
            ...user(0, 50, "", { id, delivery, turn, content: [...content] }),
            seq: state.seq + 1,
            at: startedAt,
          },
        },
      );
    },
    sendQueuedNow(queued) {
      const session = sessionOfQueued(queued);
      if (session === undefined) return fail("not_found");
      return apply(session, {
        type: "message_taken",
        message: queued,
        seq: stateOf(session).seq + 1,
        delivery: "steer",
        turn: null,
      });
    },
    removeQueued(queued) {
      const session = sessionOfQueued(queued);
      if (session === undefined) return fail("not_found");
      return apply(session, { type: "message_removed", message: queued });
    },
    editQueued(queued, text) {
      const session = sessionOfQueued(queued);
      if (session === undefined) return fail("not_found");
      return change(session, (state) => ({
        ...state,
        queued: state.queued.map((one) =>
          one.id === queued
            ? {
                ...one,
                content: [
                  { type: "text", text },
                  ...one.content.filter((block) => block.type !== "text"),
                ],
              }
            : one,
        ),
      }));
    },
    moveQueued(queued, direction) {
      const session = sessionOfQueued(queued);
      if (session === undefined) return fail("not_found");
      return change(session, (state) => {
        const index = state.queued.findIndex((one) => one.id === queued);
        const target = index + (direction === "up" ? -1 : 1);
        if (index < 0 || target < 0 || target >= state.queued.length) {
          return state;
        }
        const list = [...state.queued];
        [list[index], list[target]] = [list[target]!, list[index]!];
        return { ...state, queued: list };
      });
    },
    stop: (turn) => stopTurn(turn),
    retryTurn: restartTurn,
    answerQuestions({ session, toolCall, answers }) {
      const state = stateOf(session);
      const asked = state.pending.question;
      if (asked?.tool_call !== toolCall) return fail("conflict");
      return apply(
        session,
        { type: "question_resolved", group: asked.group, outcome: "submitted" },
        // 접은 갱신은 답 글을 모른다. 실제로는 snapshot을 다시 읽어 채우는 자리다.
        {
          type: "tool_ended",
          tool_call: toolCall,
          state: "ok",
          at: sentAt(),
          detail: {
            kind: "question",
            group: asked.group,
            outcome: "submitted",
            lines: (asked.questions ?? []).map((question) => ({
              header: question.header,
              answer: answerText(answers, question.question),
            })),
          },
        },
      );
    },
    decidePermission(session, request, choice, reason) {
      const state = stateOf(session);
      if (state.pending.approval?.id !== request) return fail("conflict");
      return apply(session, {
        type: "approval_closed",
        request,
        outcome: choice === "reject" ? "denied" : "allowed",
        choice: choice === "reject" ? null : choice,
        reason: reason ?? null,
        seq: state.seq + 1,
        at: sentAt(),
      });
    },
    cancelCall(call) {
      const found = callItemOf(call);
      if (found === undefined) return fail("not_found");
      return apply(found.session, {
        type: "tool_ended",
        tool_call: found.item.id,
        state: "ok",
        at: sentAt(),
        detail: { ...found.detail, state: "cancelled", fail_reason: null },
      });
    },

    openSession({ id }) {
      sessions = [
        ...sessions,
        {
          id,
          title: null,
          status: "idle",
          activeAt: at(0),
          archived: false,
          skip: false,
        },
      ];
      states.set(id, EMPTY_ACP_STATE);
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
    stopSession(session) {
      const turn = stateOf(session).turn;
      return turn === null || turn.phase === "ended" ? DONE : stopTurn(turn.id);
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
      states.delete(session);
      notify();
      return DONE;
    },
    forkSession({ id, session, through }) {
      const origin = sessions.find((item) => item.id === session);
      if (origin === undefined) return fail("not_found");
      const items = stateOf(session).items;
      const last =
        through === null
          ? items.length
          : items.findIndex((item) => item.id === through) + 1;
      // fork는 skip을 가져가지 않는다.
      sessions = [...sessions, { ...origin, id, status: "idle", skip: false }];
      states.set(
        id,
        numbered(
          items.slice(0, last).filter((item) => item.kind === "message"),
        ),
      );
      notify();
      return DONE;
    },
    compactSession: () => DONE,

    rewindPoints: (session) => ok(rewindPointsOf(stateOf(session))),
    rewindPreview: () => ok(REWIND_PREVIEW),
    rewind(session, message, choice) {
      const state = stateOf(session);
      const from = state.items.findIndex((item) => item.id === message);
      if (from < 0 || state.turn?.phase === "working") return fail("conflict");
      const hidden = state.items.slice(from) as AcpEntry[];
      return apply(session, {
        type: "hidden_added",
        item: {
          kind: "hidden",
          id: nextId("rwd"),
          seq: hidden[0]!.seq,
          at: at(53),
          checkpoint: message,
          choice: choice.files ? "restore_all" : "messages_only",
          count: hidden.filter((item) => item.kind === "message").length,
          restored: choice.files ? REWIND_PREVIEW.files.length : 0,
          left: [],
          items: hidden,
        },
      });
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
  question: string,
): string | null {
  const found = answers.find((item) => item.question === question);
  return found === undefined || found.status === "unanswered"
    ? null
    : found.answer.join(", ");
}
