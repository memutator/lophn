// AgentTabSource의 메모리 fake. wireframe의 Agent 탭 장면 전부를 `scene` 이름으로 골라 낸다(gallery와 dev-mock이 쓴다).
// 대화는 session마다 ACP 상태(`AcpState`)이고, 쓰기는 ACP 갱신을 `reduceAcp`로 접어 상태를 바꾼 뒤 `changed`로
// 알린다. 그래서 장면 안에서 눌러 볼 수 있다. 시각과 id는 고정이다.

import {
  type AcpCommand,
  type AcpCapabilities,
  type AcpChildState,
  type AcpEntry,
  type AcpInput,
  type AcpItem,
  type AcpMessageItem,
  type AcpNoticeItem,
  type AcpModelAxis,
  type AcpModelCurrent,
  type AcpModelGroup,
  type AcpSender,
  type AcpRole,
  type AcpSessionMeta,
  type AcpState,
  type AcpTask,
  type AcpToggle,
  type AcpToolItem,
  type AcpTurn,
  type AcpUsage,
  acpNoticeId,
  EMPTY_ACP_CHILD_STATE,
  EMPTY_ACP_STATE,
  reduceAcp,
  type AcpUpdate,
} from "../../../protocol/acp/mod.ts";
import type { AgentValueLayer } from "../../../protocol/lophn-agent/agent-definitions.ts";
import { blocksText } from "../../../protocol/lophn-agent/content-block.ts";
import {
  CLI_COMMANDS,
  HARNESS_APP_COMMANDS,
  HARNESS_EXTRA_COMMANDS,
  LOPHN_COMMANDS,
} from "./agent-tab-fake-commands.ts";
import {
  BUILT_IN_GROUPS,
  CUSTOM_GROUP,
  DEFAULT_OPTIONS,
  effortLowToMax,
  SONNET,
} from "./agent-tab-fake-models.ts";
import type {
  AgentFace,
  AgentTabSource,
  Envelope,
  PermissionsView,
  QuestionAnswer,
  RewindPreviewView,
  SessionEntry,
  SessionSearchMatch,
  SourceResult,
  ToolCallBodyView,
} from "./agent-tab-source.ts";
import { rewindPointsOf } from "./agent-view-model.ts";

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
  /** 사람이 `!`로 돌린 shell 줄 둘(출력을 펼친 것, exit code가 0이 아닌 것). */
  "shell",
  /** session이 아직 없는 새 대화. */
  "empty",
  /** harness CLI의 session: mode 셋, CLI 명령, composer 위 dock(goal, todo, 도는 subagent·task, 줄 선 메시지), 명령 출력과 알림 줄. session 목록과 파일 복원은 없다. */
  "harness",
  /** harness가 plan을 내고 승인을 기다린다: plan markdown과 다음 mode 단추. */
  "plan-approval",
  /** 승인 카드의 세 범위(한 번, 이 session, 항상)와 file 바꾸기 subject. */
  "approval-scopes",
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
  workspace: { kind: "project", name: "phroner" },
  permissionSummary: "2 apps assigned",
};

const CLAUDE: AgentFace = {
  agent: "lophn",
  name: "Claude",
  profile: { kind: "vendor", vendor: "claude" },
  workspace: { kind: "project", name: "phroner" },
  permissionSummary: "",
};

const EVAL_ANALYST: AgentFace = {
  agent: fakeId("agt", 1),
  name: "Eval analyst",
  profile: { kind: "character", shape: "wide", color: "yellow" },
  workspace: { kind: "app", name: "Eval board" },
  permissionSummary: LOPHN.permissionSummary,
};

const REQUEST = "Write this week's eval report from the new findings.";
const QUESTION_LEAD =
  "There are 3 new findings since last week. Before I write the report I need two answers.";
const CLEANUP_LEAD =
  "The 2026-w40 report is superseded by this week's. I can delete the old folder with a shell command, so I need your OK first.";
const REPORT_LEAD =
  "I have the three findings. I need to write the report and clean up last week's file, so I need your OK first.";
const CLEANUP_COMMAND = "rm -r docs/reports/2026-w40";
const PLAN_LEAD =
  "I read the three findings. Here is how I would write the report.";
const PLAN_TEXT = [
  "## Plan: weekly eval report",
  "",
  "1. Read the three new findings in `eval/findings.md`.",
  "2. Count regressions per scenario with the run logs.",
  "3. Write `docs/reports/2026-w41.md` with a summary and a regressions table.",
  "4. Add the new report to `docs/reports/index.md`.",
  "5. Remove the superseded `2026-w40` report.",
  "",
  "### Files",
  "",
  "- `docs/reports/2026-w41.md` (new)",
  "- `docs/reports/index.md` (one line)",
  "- `docs/reports/2026-w40.md` (delete)",
  "",
  "### Checks",
  "",
  "- Every regression in the table links to its finding.",
  "- The numbers match the run logs.",
  "",
  "Nothing outside `docs/reports/` changes.",
].join("\n");

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
    origin: null,
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
    by: "agent",
    turn: turn1,
    ...fields,
    state: "ok",
    duration_ms: 1_200,
    detail: { kind: "generic" },
    body: null,
    ...over,
  };
}

/**
 * 사람이 `!`로 돌린 명령 하나. harness는 출력을 `body`에 싣고(`output`을 주면), lophn은 body가 null이라
 * `toolBodies`의 blob read로 읽는다.
 */
function userShell(
  n: number,
  minutes: number,
  command: string,
  over: Partial<AcpToolItem> = {},
  output: string | null = null,
): AcpToolItem {
  return tool(
    n,
    minutes,
    {
      tool: "shell",
      category: "command",
      title: command.split("\n")[0]!,
    },
    {
      by: "user",
      turn: null,
      duration_ms: 300,
      body:
        output === null ? null : { input: command, output, truncated: false },
      ...over,
    },
  );
}

const LS_OUTPUT = [
  "total 48",
  "drwxr-xr-x  7 phroner phroner 4096 Oct  6 09:12 .",
  "drwxr-xr-x 14 phroner phroner 4096 Oct  5 18:40 ..",
  "-rw-r--r--  1 phroner phroner  231 Oct  6 09:02 README.md",
  "drwxr-xr-x  3 phroner phroner 4096 Oct  5 18:41 docs",
  "drwxr-xr-x  4 phroner phroner 4096 Oct  6 08:55 eval",
  "-rw-r--r--  1 phroner phroner  612 Oct  5 18:40 package.json",
  "drwxr-xr-x  2 phroner phroner 4096 Oct  6 09:02 src",
].join("\n");

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

/** turn 밖의 알림 줄. 명령 출력과 compaction·rate limit 안내다. */
function notice(
  n: number,
  minutes: number,
  body: AcpNoticeItem["notice"],
): AcpNoticeItem {
  return {
    kind: "notice",
    id: fakeId("ntc", n),
    seq: 0,
    at: at(minutes),
    turn: null,
    notice: body,
  };
}

const CONTEXT_OUTPUT = [
  "## Context usage",
  "",
  "`claude-sonnet-5-5` · 43k / 200k tokens (21%)",
  "",
  "| Category | Tokens | Share |",
  "| --- | ---: | ---: |",
  "| System prompt | 3.2k | 1.6% |",
  "| System tools | 11.8k | 5.9% |",
  "| MCP tools | 4.1k | 2.1% |",
  "| Memory files | 2.0k | 1.0% |",
  "| Messages | 21.9k | 10.9% |",
  "| Free space | 157k | 78.5% |",
].join("\n");

const COST_OUTPUT = [
  "Total cost:            $0.42",
  "Total duration (API):  3m 12s",
  "Total duration (wall): 11m 40s",
  "Total code changes:    42 lines added, 3 lines removed",
  "Usage by model:",
  "    claude-sonnet-5-5:  312.4k input, 11.5k output, 301.4k cache read",
].join("\n");

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
    header: "Report workspace",
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

// ---- harness 장면의 dock: 도는 subagent 하나(자식 대화), 도는 shell task 하나, 줄 선 메시지 ----

const CHILD = "chd_01h455vb4pex5v6nkc6gd5f001";

/** 도는 subagent 줄. 자식 대화는 `CHILD`다. */
const SUBAGENT_CALL = tool(
  31,
  42,
  {
    tool: "Task",
    category: "other",
    title: "Find where the upload retry is called",
  },
  {
    state: "running",
    duration_ms: null,
    detail: {
      kind: "subagent",
      agent: "Explore",
      description: "Find where the upload retry is called",
      child: CHILD,
      state: "running",
      model: "Haiku 5.5",
      last: "Reading src/queue/worker.ts",
    },
  },
);

const childTool = (n: number, minutes: number, title: string): AcpToolItem =>
  tool(
    40 + n,
    minutes,
    { tool: "file.read", category: "read", title },
    { duration_ms: 600 },
  );

/** 자식 대화: 맡긴 일, 읽은 file 둘, 지금까지 찾은 것. */
const CHILD_STATE: AcpChildState = {
  ...EMPTY_ACP_CHILD_STATE,
  seq: 4,
  turn: { ...turnOf("working"), id: turnId(2), started_at: at(42) },
  items: [
    {
      ...user(41, 42, "Find where the upload retry is called."),
      seq: 1,
      turn: turnId(2),
    },
    {
      ...childTool(1, 42, "Search retry in src"),
      seq: 2,
      turn: turnId(2),
    },
    {
      ...childTool(2, 42, "Read src/upload.ts"),
      seq: 3,
      turn: turnId(2),
    },
    {
      ...agent(
        42,
        43,
        "`upload()` is called from `src/queue/worker.ts` and from the CLI entry. I am reading the worker to see how it handles a failed upload.",
      ),
      seq: 4,
      turn: turnId(2),
    },
  ],
};

/** 도는 shell task. 출력은 꼬리 몇 줄이다. */
const SHELL_TASK: AcpTask = {
  id: "tsk_01h455vb4pex5v6nkc6gd5f001",
  kind: "shell",
  description: "npm run dev",
  state: "running",
  started_at: at(40),
  output: [
    "> upload-service@1.4.0 dev",
    "> node --watch src/server.ts",
    "",
    "listening on :3000",
    "GET /health 200 2ms",
    "POST /upload 500 41ms",
  ].join("\n"),
};

const DOCK_PLAN: NonNullable<AcpState["plan"]> = {
  entries: [
    { text: "Read the three findings", status: "completed" },
    { text: "Add a retry to upload()", status: "completed" },
    { text: "Write docs/reports/2026-w41.md", status: "in_progress" },
    { text: "Update docs/reports/index.md", status: "pending" },
    { text: "Remove the 2026-w40 draft", status: "cancelled" },
  ],
};

const DOCK_QUEUED: AcpState["queued"] = [
  {
    id: messageId(30),
    at: at(43),
    content: [{ type: "text", text: "Also add a test for the 4xx case." }],
  },
];

const DOCK_TOGGLES: AcpToggle[] = [
  {
    id: "plan",
    label: "Plan mode",
    description: "Plan first and ask before implementing.",
    on: false,
  },
];

const DOCK_GOAL = {
  objective: "Ship the weekly eval report",
  status: "active",
  detail: "Two of three sections are written.",
} as const;

const DOCK_ROLES: AcpRole[] = [
  { id: "default", label: "default", kind: "chat", model: "sonnet" },
  { id: "smol", label: "smol", kind: "chat", model: "haiku" },
  {
    id: "slow",
    label: "slow",
    kind: "chat",
    model: "anthropic/claude-opus-5-5",
  },
  { id: "image", label: "image", kind: "model", model: null },
];

const DOCK_LIMITS: AcpUsage["limits"] = [
  {
    id: "5h",
    label: "5-hour limit",
    used_percent: 82,
    left: null,
    resets_at: at(150),
  },
  {
    id: "week",
    label: "Weekly limit",
    used_percent: null,
    left: "$4.20 left",
    resets_at: at(60 * 52),
  },
];

const DOCK_CONTEXT_PARTS: NonNullable<AcpUsage["context"]>["parts"] = [
  { label: "System prompt", tokens: 3_200 },
  { label: "System tools", tokens: 11_800 },
  { label: "Memory files", tokens: 2_000 },
  { label: "Messages", tokens: 21_900 },
];

interface SceneData {
  agent: AgentFace;
  title: string;
  state: AcpState;
  /** harness CLI의 session이다(lophn이 아니다). */
  harness?: true;
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

// shell 장면: lophn이 낸 사람 shell 줄. 출력은 blob read가 읽고 exit code가 거기 실린다.
const SHELL_BODIES: SceneData["toolBodies"] = {
  [toolId(20)]: { output: shellBody(LS_OUTPUT) },
  [toolId(21)]: {
    output: resultBody("exit code 2", {
      exit_code: 2,
      timed_out: false,
      stdout: "",
      stderr: "ls: cannot access 'build': No such file or directory",
      stdout_truncated: false,
      stderr_truncated: false,
    }),
  },
};

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
    case "shell":
      return {
        agent: LOPHN,
        title: "Week 41 summary",
        state: numbered(
          [
            user(1, 41, REQUEST),
            agent(2, 42, "The report is in docs/reports/2026-w41.md."),
            turnEnd(43, 18_000, 0),
            userShell(20, 44, "ls -la"),
            userShell(21, 45, "ls build", { state: "error" }),
          ],
          { turn: turnOf("ended") },
        ),
        toolBodies: SHELL_BODIES,
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
                { header: "Report workspace", answer: "docs/reports/" },
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
              choices: ["once", "always", "reject"],
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
        choice: "once" | "session" | "always" | null,
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
        mode: null,
      });
      return {
        agent: LOPHN,
        title: "Weekly report",
        state: numbered(
          [
            user(1, 41, "Go on with the cleanup."),
            result(1, "allowed", "once", null),
            result(2, "allowed", "session", null),
            result(3, "allowed", "always", null),
            result(4, "denied", null, "Keep last week's report for now."),
            result(5, "cancelled", null, null),
            turnEnd(43, 3_900_000, 300_000),
          ],
          { turn: turnOf("ended") },
        ),
      };
    }
    case "harness":
      return {
        agent: CLAUDE,
        title: "Week 41 summary",
        harness: true,
        state: numbered(
          [
            notice(1, 38, {
              type: "command_output",
              command: "context",
              text: CONTEXT_OUTPUT,
              format: "markdown",
            }),
            notice(2, 39, {
              type: "command_output",
              command: "cost",
              text: COST_OUTPUT,
              format: "preformatted",
            }),
            notice(3, 40, {
              type: "info",
              text: "Conversation compacted · 182k → 24k tokens",
              level: "info",
            }),
            notice(4, 40, {
              type: "info",
              text: "You've used 82% of your 5-hour limit. It resets at 11:30.",
              level: "warning",
            }),
            notice(5, 40, {
              type: "info",
              text: "Forked from Week 40 summary",
              level: "info",
            }),
            userShell(
              30,
              40,
              "git status --short",
              {},
              " M docs/reports/index.md\n?? docs/reports/2026-w41.md",
            ),
            user(1, 41, REQUEST),
            ...REPORT_CALLS,
            SUBAGENT_CALL,
            agent(
              2,
              42,
              "I checked the three findings. Writing the report now.",
            ),
          ],
          {
            turn: turnOf("working"),
            plan: DOCK_PLAN,
            queued: DOCK_QUEUED,
            tasks: [SHELL_TASK],
            children: { [CHILD]: CHILD_STATE },
          },
        ),
        toolBodies: REPORT_TOOL_BODIES,
      };
    case "plan-approval":
      return {
        agent: CLAUDE,
        title: "Week 41 summary",
        harness: true,
        state: numbered([user(1, 41, REQUEST), agent(2, 41, PLAN_LEAD)], {
          turn: turnOf("waiting"),
          pending: {
            approval: {
              id: requestId(1),
              subject: {
                kind: "plan",
                plan: PLAN_TEXT,
                modes: [
                  { id: "acceptEdits", label: "Accept edits" },
                  { id: "default", label: "Ask for edits" },
                ],
              },
              choices: ["reject"],
              always_patterns: [],
            },
            question: null,
          },
        }),
      };
    case "approval-scopes":
      return {
        agent: CLAUDE,
        title: "Week 41 summary",
        harness: true,
        state: numbered([user(1, 41, REQUEST), agent(2, 41, REPORT_LEAD)], {
          turn: turnOf("waiting"),
          pending: {
            approval: {
              id: requestId(1),
              subject: {
                kind: "file_change",
                changes: [
                  {
                    path: "docs/reports/2026-w41.md",
                    change: "create",
                    added: 42,
                    removed: 0,
                  },
                  {
                    path: "docs/reports/index.md",
                    change: "update",
                    added: 1,
                    removed: 1,
                  },
                  {
                    path: "docs/reports/2026-w40.md",
                    change: "delete",
                    added: null,
                    removed: null,
                  },
                ],
              },
              choices: ["once", "session", "always", "reject"],
              always_patterns: ["Edit(docs/reports/**)"],
            },
            question: null,
          },
        }),
      };
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

const EVERYTHING: AcpCapabilities = {
  model: true,
  effort: true,
  mode: true,
  commands: true,
  rewind: true,
  rewind_files: true,
  fork: true,
  compact: true,
  rename: true,
  usage: true,
  steer: true,
  queue_edit: true,
  images: true,
  retry: true,
  sessions: true,
  stop_child: false,
  steer_child: false,
  tasks: false,
  toggles: false,
  goal: false,
  roles: false,
  shell: true,
  resume: false,
};

/** harness CLI(Claude)가 가진 만큼: lophn session 목록은 없고 CLI의 지난 session을 `resume`으로 연다. 파일 복원은 있고 앱 write는 없다. */
const HARNESS_CAPABILITIES: AcpCapabilities = {
  ...EVERYTHING,
  sessions: false,
  resume: true,
};

/** dock이 그리는 것(subagent, task, toggle, goal, role)까지 가진 harness. */
const DOCK_CAPABILITIES: AcpCapabilities = {
  ...HARNESS_CAPABILITIES,
  stop_child: true,
  steer_child: true,
  tasks: true,
  toggles: true,
  goal: true,
  roles: true,
};

function modelsOf(picker: FakePicker): {
  models: AcpModelGroup[];
  model: AcpModelCurrent | null;
} {
  const kind = picker.providers ?? "built_in";
  const all = [
    ...(kind === "none" ? [] : BUILT_IN_GROUPS),
    ...(kind === "custom" ? [CUSTOM_GROUP] : []),
  ];
  const wanted = picker.current ?? SONNET.label;
  const current = all
    .flatMap((group) => group.models)
    .find((one) => one.label === wanted);
  const on = picker.shown;
  return {
    models: all.map((group) => ({
      ...group,
      models: group.models.filter(
        (one) =>
          on === undefined || on.includes(one.label) || one.id === current?.id,
      ),
    })),
    // provider가 없으면 고른 model도 없다(core가 current null일 때 내는 값과 같다).
    model:
      current === undefined
        ? null
        : {
            model: current.id,
            label: current.label,
            options: { ...DEFAULT_OPTIONS[current.id] },
            layer: picker.layer === undefined ? "global" : picker.layer,
          },
  };
}

// 구독 OAuth 연결의 session. 금액은 구독이라 알 수 없고 token만 보인다.
function usageOf(over: Partial<AcpUsage>): AcpUsage {
  return {
    context: over.context ?? { tokens: 86_508, limit: 1_050_000, parts: [] },
    limits: over.limits ?? [],
    input_tokens: over.input_tokens ?? 412_890,
    output_tokens: over.output_tokens ?? 11_531,
    cache_read_tokens: over.cache_read_tokens ?? 301_440,
    cache_write_tokens: over.cache_write_tokens ?? 0,
    turns: over.turns ?? 3,
    costs: [
      ...(over.costs ?? [
        { kind: "subscription", currency: null, amount: null },
      ]),
    ],
    provider: over.provider ?? {
      name: "OpenAI",
      definition: "openai",
      account: "me@example.com",
      state: "available",
      until: null,
    },
  };
}

interface MetaOptions {
  readonly picker: FakePicker;
  readonly status: Partial<AcpUsage>;
  readonly title: string | null;
  readonly mode: "ask" | "skip";
  /** harness가 dock의 것(toggle, goal, role, 사용 한도, context 분해)을 싣는다. */
  readonly dock?: boolean;
  /** 어느 harness인가. role은 omp만 가진다. 기본은 claude다. */
  readonly harness?: "claude" | "omp" | "codex";
}

function lophnMeta(options: MetaOptions): AcpSessionMeta {
  return {
    title: options.title,
    cli_session: null,
    capabilities: EVERYTHING,
    ...modelsOf(options.picker),
    modes: [
      { id: "ask", label: "Ask when needed", description: null },
      { id: "skip", label: "Skip permissions", description: null },
    ],
    mode: options.mode,
    commands: [...LOPHN_COMMANDS],
    usage: usageOf(options.status),
    toggles: [],
    goal: null,
    roles: null,
    harness: null,
  };
}

/** 이름이 메뉴 폭을 넘는 plugin 명령. 이름은 말줄임하고 설명은 그 옆에 남는다. */
const LONG_PLUGIN_COMMAND: AcpCommand = {
  name: "plugin-name:a-very-long-command-name",
  aliases: [],
  description: "A plugin command whose name is longer than the menu is wide",
  argument_hint: null,
  source: "plugin",
  opens: null,
};

// harness 탭의 지금 CLI session과 그 CLI가 폴더에 가진 지난 session(머리 session menu의 목록).
const CLI_CURRENT = "9f2c7d1e-5b1a-4c58-8a3e-0d6b7f2a41c9";
const CLI_EARLIER: readonly {
  readonly id: string;
  readonly title: string;
  readonly minutes: number;
  readonly question: string;
  readonly answer: string;
}[] = [
  {
    id: "3b7e41aa-6c20-47d8-9d15-71e0a3c58f02",
    title: "Fix the flaky upload test",
    minutes: -3 * 60,
    question: "The upload test fails one run in five. Can you find out why?",
    answer:
      "It races the mock server against the retry timer. I made the test wait for the first retry before it asserts.",
  },
  {
    id: "c0a1d2e3-7f4b-4a19-b6c8-2e9d5f1a7b34",
    title: "Week 40 summary",
    minutes: -2 * 24 * 60,
    question: "Summarize last week's eval runs.",
    answer: "Pass rate held at 91%. Two regressions, both in the date parser.",
  },
  {
    id: "58d9f0b2-1e6a-4c37-8b4d-a3f7c2e91d60",
    title: "Rename the config loader",
    minutes: -6 * 24 * 60,
    question: "Rename loadConfig to readConfig everywhere.",
    answer: "Done. 14 call sites changed and the exports file is updated.",
  },
];

// CLI가 주는 session 명령: `new`는 같은 탭에서 빈 session을 열고(Claude는 `clear`의 별칭), `resume`은 머리 session menu를 연다.
const HARNESS_SESSION_COMMANDS: readonly AcpCommand[] = [
  {
    name: "new",
    aliases: ["clear"],
    description: "Start a new session",
    argument_hint: null,
    source: "harness",
    opens: null,
  },
  {
    name: "resume",
    aliases: [],
    description: "Resume an earlier session",
    argument_hint: null,
    source: "harness",
    opens: "resume",
  },
];

const onOff = (
  id: string,
  label: string,
  off: string,
  on: string,
): AcpModelAxis => ({
  id,
  label,
  kind: "switch",
  values: [
    { value: "off", label: off },
    { value: "on", label: on },
  ],
});

// Claude의 fast·thinking은 model마다 지원할 때만 있는 켜고 끄는 축이다(Haiku에는 fast가 없다).
const CLAUDE_FAST = onOff("fast", "Speed", "Standard", "Fast");
const CLAUDE_THINKING = onOff("thinking", "Thinking", "Off", "On");
// Codex의 service tier(speed)와 omp의 fast도 그 model의 축이다.
const CODEX_SPEED = onOff("speed", "Speed", "Standard", "Fast");

const HARNESS_GROUPS: Readonly<
  Record<"claude" | "omp" | "codex", readonly AcpModelGroup[]>
> = {
  claude: [
    {
      id: "claude",
      label: "Claude",
      models: [
        {
          id: "sonnet",
          label: "Sonnet 5.5",
          axes: [effortLowToMax, CLAUDE_FAST, CLAUDE_THINKING],
        },
        {
          id: "opus",
          label: "Opus 5.5",
          axes: [effortLowToMax, CLAUDE_FAST, CLAUDE_THINKING],
        },
        { id: "haiku", label: "Haiku 5.5", axes: [CLAUDE_THINKING] },
      ],
    },
  ],
  // omp는 provider마다 묶는다. 묶음이 여럿이라 지금 model의 묶음만 펼쳐 있다.
  omp: [
    {
      id: "anthropic",
      label: "Anthropic",
      models: [
        {
          id: "sonnet",
          label: "Sonnet 5.5",
          axes: [effortLowToMax, onOff("fast", "Fast", "Off", "On")],
        },
        { id: "haiku", label: "Haiku 5.5", axes: [] },
      ],
    },
    {
      id: "openai",
      label: "OpenAI",
      models: [
        { id: "sol", label: "GPT-6.1 Sol", axes: [effortLowToMax] },
        { id: "mini", label: "GPT-6.1 Mini", axes: [] },
      ],
    },
    {
      id: "google",
      label: "Google",
      models: [{ id: "gemini", label: "Gemini 3.8 Flash", axes: [] }],
    },
    {
      id: "xai",
      label: "xAI",
      models: [{ id: "grok", label: "Grok 4.7", axes: [] }],
    },
  ],
  codex: [
    {
      id: "openai",
      label: "OpenAI",
      models: [
        {
          id: "sol",
          label: "GPT-6.1 Sol",
          axes: [effortLowToMax, CODEX_SPEED],
        },
        { id: "mini", label: "GPT-6.1 Mini", axes: [effortLowToMax] },
      ],
    },
  ],
};

const HARNESS_CURRENT: Readonly<
  Record<"claude" | "omp" | "codex", AcpModelCurrent>
> = {
  claude: {
    model: "sonnet",
    label: "Sonnet 5.5",
    options: { effort: "high", fast: "on", thinking: "on" },
    layer: null,
  },
  omp: {
    model: "sonnet",
    label: "Sonnet 5.5",
    options: { effort: "high" },
    layer: null,
  },
  codex: {
    model: "sol",
    label: "GPT-6.1 Sol",
    options: { effort: "high", speed: "on" },
    layer: null,
  },
};

function harnessMeta(options: MetaOptions): AcpSessionMeta {
  const omp = options.harness === "omp";
  const kind = options.harness ?? "claude";
  return {
    title: options.title,
    cli_session: CLI_CURRENT,
    capabilities:
      options.dock !== true
        ? HARNESS_CAPABILITIES
        : { ...DOCK_CAPABILITIES, roles: omp },
    models: [...HARNESS_GROUPS[kind]],
    model: { ...HARNESS_CURRENT[kind] },
    modes: [
      { id: "default", label: "Default", description: null },
      { id: "acceptEdits", label: "Accept edits", description: null },
      { id: "plan", label: "Plan", description: null },
    ],
    mode: "default",
    commands: [
      ...HARNESS_APP_COMMANDS,
      ...CLI_COMMANDS,
      ...HARNESS_SESSION_COMMANDS,
      ...HARNESS_EXTRA_COMMANDS,
      LONG_PLUGIN_COMMAND,
    ],
    usage: {
      ...usageOf(options.status),
      provider: null,
      costs: [],
      context: {
        tokens: 43_000,
        limit: 200_000,
        parts: options.dock === true ? DOCK_CONTEXT_PARTS : [],
      },
      ...(options.dock === true ? { limits: DOCK_LIMITS } : {}),
    },
    toggles: options.dock === true ? DOCK_TOGGLES : [],
    goal: options.dock === true ? { ...DOCK_GOAL } : null,
    roles: options.dock === true && omp ? DOCK_ROLES : null,
    harness: kind,
  };
}

/** wireframe의 harness GUI 탭이 첫 갱신으로 싣는 session 기능. role은 omp만 가진다. */
export const fakeHarnessMeta = (
  harness: "claude" | "omp" | "codex" = "claude",
): AcpSessionMeta =>
  harnessMeta({
    picker: {},
    status: {},
    title: "Add a retry to the upload helper",
    mode: "ask",
    dock: true,
    harness,
  });

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
    status?: Partial<AcpUsage>;
    /** 보낸 말과 시작한 turn의 시각. 없으면 장면의 고정 시각이다(gallery). */
    now?: () => number;
  } = {},
): AgentTabSource {
  const sentAt = () =>
    options.now === undefined ? at(50) : new Date(options.now()).toISOString();
  const data = sceneData(options.scene ?? "report");
  const envelopes = new Map(Object.entries(data.envelopes ?? {}));
  /** 새 session이 처음 갖는 session 기능. */
  const freshMeta = (title: string | null, mode: "ask" | "skip" = "ask") =>
    (data.harness === true ? harnessMeta : lophnMeta)({
      picker: options.picker ?? {},
      status: options.status ?? {},
      title,
      mode,
      dock: options.scene === "harness",
    });
  const withMeta = (state: AcpState, meta: AcpSessionMeta): AcpState => ({
    ...state,
    session: meta,
  });
  let sessions: SessionEntry[] =
    options.scene === "empty"
      ? [
          {
            id: SESSION_EARLIER,
            title: "Release notes check",
            status: "idle",
            activeAt: at(-2 * 24 * 60),
            archived: false,
          },
        ]
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
          },
          {
            id: SESSION_EARLIER,
            title: "Release notes check",
            status: "idle",
            activeAt: at(-2 * 24 * 60),
            archived: false,
          },
          {
            id: SESSION_ARCHIVED,
            title: data.title,
            status: "idle",
            activeAt: at(-12 * 24 * 60),
            archived: true,
          },
        ];
  const states = new Map<string, AcpState>();
  states.set(
    SESSION_EARLIER,
    withMeta(EMPTY_ACP_STATE, freshMeta("Release notes check")),
  );
  if (options.scene !== "empty") {
    states.set(
      SESSION_MAIN,
      withMeta(
        data.state,
        freshMeta(data.title, options.scene === "skip" ? "skip" : "ask"),
      ),
    );
    // archive한 session도 report 장면과 같은 기록을 보인다.
    states.set(
      SESSION_ARCHIVED,
      withMeta(
        {
          ...EMPTY_ACP_STATE,
          seq: data.state.seq,
          items: data.state.items,
          turn: data.state.turn,
        },
        freshMeta(data.title),
      ),
    );
  }

  const listeners = new Set<() => void>();
  // harness 탭의 지금 CLI session. `open_session`이 바꾼다.
  let cliCurrent = CLI_CURRENT;
  let counter = 100;
  const nextId = (prefix: string) => fakeId(prefix, counter++);
  // 올린 이미지의 blob 주소. 메모리에만 있다.
  const images = new Map<string, string>();
  const notify = () => listeners.forEach((listener) => listener());
  /** 이 fake가 받은 `run_shell`의 출력(lophn 쪽은 blob read로 읽는다). */
  const shellRuns = new Map<string, ToolCallBodyView>();
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

  /** 허락 카드를 닫는다. 거절은 이유를 싣는다. */
  const decide = (
    session: string,
    request: string,
    choice: Extract<AcpInput, { type: "decide" }>["choice"],
  ) => {
    const state = stateOf(session);
    if (state.pending.approval?.id !== request) return fail("conflict");
    return apply(session, {
      type: "approval_closed",
      request,
      outcome: choice.kind === "reject" ? "denied" : "allowed",
      choice:
        choice.kind === "reject" || choice.kind === "mode" ? null : choice.kind,
      reason: choice.kind === "reject" ? (choice.reason ?? null) : null,
      mode: choice.kind === "mode" ? choice.mode : null,
      seq: state.seq + 1,
      at: sentAt(),
    });
  };
  const rewind = (
    session: string,
    message: string,
    files: boolean,
  ): Promise<SourceResult<void>> => {
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
        choice: files ? "restore_all" : "messages_only",
        count: hidden.filter((item) => item.kind === "message").length,
        restored: files ? REWIND_PREVIEW.files.length : 0,
        left: [],
        items: hidden,
      },
    });
  };
  const fork = (session: string, through: string | null) => {
    const origin = sessions.find((item) => item.id === session);
    if (origin === undefined) return fail<{ session?: string }>("not_found");
    const items = stateOf(session).items;
    const last =
      through === null
        ? items.length
        : items.findIndex((item) => item.id === through) + 1;
    const id = nextId("ses");
    // fork는 skip을 가져가지 않는다.
    sessions = [...sessions, { ...origin, id, status: "idle" }];
    states.set(
      id,
      withMeta(
        numbered(
          items.slice(0, last).filter((item) => item.kind === "message"),
        ),
        freshMeta(origin.title),
      ),
    );
    notify();
    return ok<{ session?: string }>({ session: id });
  };
  /** 새 ACP 입력. core가 route로 옮기는 일을 메모리 상태 변경으로 흉내 낸다. */
  const act = async (
    session: string,
    input: AcpInput,
  ): Promise<SourceResult<{ session?: string }>> => {
    const changed = async (
      meta: Partial<AcpSessionMeta>,
    ): Promise<SourceResult<{ session?: string }>> => {
      await apply(session, { type: "session_changed", session: meta });
      return { ok: true, value: {} };
    };
    const lift = async (
      call: Promise<SourceResult<unknown>>,
    ): Promise<SourceResult<{ session?: string }>> => {
      const result = await call;
      return result.ok ? { ok: true, value: {} } : result;
    };
    switch (input.type) {
      case "set_model": {
        const groups = stateOf(session).session?.models ?? [];
        const found = groups
          .flatMap((group) => group.models)
          .find((one) => one.id === input.model);
        if (found === undefined) return { ok: false, code: "invalid_input" };
        return changed({
          model: {
            model: found.id,
            label: found.label,
            options: input.options,
            layer: "session",
          },
        });
      }
      case "set_mode":
        return changed({ mode: input.mode });
      case "rename":
        patchSession(session, { title: input.title });
        notify();
        return changed({ title: input.title });
      case "decide":
        return lift(decide(session, input.request, input.choice));
      case "rewind":
        return lift(rewind(session, input.message, input.files));
      case "fork":
        // session 목록이 없는 source는 같은 탭의 상태가 바뀌고 새 session을 열지 않는다.
        return stateOf(session).session?.capabilities.sessions === false
          ? { ok: true, value: {} }
          : fork(session, input.message);
      case "set_toggle": {
        const toggles = stateOf(session).session?.toggles ?? [];
        return changed({
          toggles: toggles.map((one) =>
            one.id === input.id ? { ...one, on: input.on } : one,
          ),
        });
      }
      case "set_goal": {
        const goal = stateOf(session).session?.goal ?? null;
        return changed({
          goal:
            input.objective === null
              ? null
              : {
                  objective: input.objective,
                  status: input.paused ? "paused" : "active",
                  detail: goal?.detail ?? null,
                },
        });
      }
      case "use_role": {
        const state = stateOf(session);
        const role = state.session?.roles?.find((one) => one.id === input.role);
        const found = state.session?.models
          .flatMap((group) => group.models)
          .find((one) => one.id === role?.model);
        if (found === undefined) return { ok: false, code: "invalid_input" };
        return changed({
          model: {
            model: found.id,
            label: found.label,
            options: {},
            layer: null,
          },
        });
      }
      case "stop_child": {
        const item = stateOf(session).items.find(
          (one) =>
            one.kind === "tool" &&
            one.detail.kind === "subagent" &&
            one.detail.child === input.child,
        );
        if (item?.kind !== "tool" || item.detail.kind !== "subagent") {
          return { ok: false, code: "not_found" };
        }
        return lift(
          apply(session, {
            type: "tool_detail_changed",
            tool_call: item.id,
            detail: { ...item.detail, state: "cancelled" },
          }),
        );
      }
      case "steer_child": {
        const child = stateOf(session).children[input.child];
        if (child === undefined) return { ok: false, code: "not_found" };
        return lift(
          apply(session, {
            type: "child_update",
            child: input.child,
            update: {
              type: "message_added",
              item: {
                ...user(0, 44, input.text, {
                  id: nextId("msg"),
                  delivery: "steer",
                  turn: child.turn?.id ?? null,
                }),
                seq: child.seq + 1,
              },
            },
          }),
        );
      }
      case "stop_task":
        return lift(
          apply(session, {
            type: "tasks_changed",
            tasks: stateOf(session).tasks.map((one) =>
              one.id === input.task ? { ...one, state: "stopped" } : one,
            ),
          }),
        );
      case "run_shell": {
        // lophn은 끝나야 답하고 item도 그때 온다. `sleep`은 도는 줄을 gallery에서 보이려고 오래 기다린다.
        // harness는 줄이 먼저 오고(도는 줄에 stop 단추), `stop_shell`이 닫는다.
        const state = stateOf(session);
        const harness = state.session?.harness != null;
        const running = input.command.includes("sleep");
        if (running && !harness) {
          await new Promise((resolve) => setTimeout(resolve, 600_000));
        }
        const id = nextId("tcl");
        const output = `${input.command}: ok\n${LS_OUTPUT}`;
        if (!harness) shellRuns.set(id, shellBody(output));
        return lift(
          apply(session, {
            type: "tool_started",
            item: {
              ...userShell(
                0,
                50,
                input.command,
                {
                  id,
                  seq: state.seq + 1,
                  at: sentAt(),
                  ...(running && harness ? { state: "running" as const } : {}),
                },
                harness ? output : null,
              ),
            },
          }),
        );
      }
      case "stop_shell":
        return lift(
          apply(session, {
            type: "tool_ended",
            tool_call: input.item,
            state: "cancelled",
            at: sentAt(),
            detail: null,
            body: null,
          }),
        );
      case "open_session": {
        // 같은 탭에서 다른 CLI session을 연다: 상태를 비우고(`session_reset`) 그 session의 대화를 다시 채운다.
        const target = CLI_EARLIER.find((one) => one.id === input.cli_session);
        if (target === undefined) return { ok: false, code: "not_found" };
        cliCurrent = target.id;
        const seq = stateOf(session).seq;
        await apply(
          session,
          { type: "session_reset" },
          {
            type: "session_changed",
            session: { cli_session: target.id, title: target.title },
          },
          {
            type: "message_added",
            item: user(60, target.minutes, target.question, {
              seq: seq + 1,
              turn: null,
            }),
          },
          {
            type: "message_added",
            item: agent(61, target.minutes, target.answer, { seq: seq + 2 }),
          },
        );
        return { ok: true, value: {} };
      }
      case "run_command":
        // 새 session 명령은 CLI가 같은 탭에서 빈 session을 연다.
        if (input.name === "new" || input.name === "clear") {
          cliCurrent = `new-${counter++}`;
          await apply(
            session,
            { type: "session_reset" },
            {
              type: "session_changed",
              session: { cli_session: cliCurrent, title: null },
            },
          );
        }
        return { ok: true, value: {} };
      case "compact":
        return { ok: true, value: {} };
      default:
        return { ok: false, code: "invalid_input" };
    }
  };

  const source: AgentTabSource = {
    agent: () => ok(data.agent),
    sessions: () =>
      ok(
        data.harness === true
          ? [
              {
                id: cliCurrent,
                title: data.title,
                status: "idle" as const,
                activeAt: at(-5),
                archived: false,
              },
              ...CLI_EARLIER.map((one) => ({
                id: one.id,
                title: one.title,
                status: "idle" as const,
                activeAt: at(one.minutes),
                archived: false,
              })),
            ]
          : [...sessions],
      ),
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
    // 새 session이 처음 갖는 meta: 첫 말을 보내 session을 열면 받을 값에서 제목과 사용량을 뺀 것.
    draft: () =>
      ok({
        ...freshMeta(null),
        usage: null,
      }),
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
      const found =
        part === "output" && shellRuns.has(toolCall)
          ? shellRuns.get(toolCall)
          : data.toolBodies?.[toolCall]?.[part];
      return found === undefined ? fail("not_found") : ok(found);
    },

    permissions: () => ok(PERMISSIONS_VIEW),

    act,
    uploadImage(image) {
      const blob = nextId("blob");
      images.set(blob, URL.createObjectURL(image));
      return ok({
        block: {
          type: "image",
          mimeType: image.type as "image/png",
          blob,
        },
      });
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
          body: null,
        },
      );
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
        body: null,
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
        },
      ];
      states.set(id, withMeta(EMPTY_ACP_STATE, freshMeta(null)));
      notify();
      return DONE;
    },
    stopSession(session) {
      const turn = stateOf(session).turn;
      return turn === null || turn.phase === "ended" ? DONE : stopTurn(turn.id);
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

    rewindPoints: (session) => ok(rewindPointsOf(stateOf(session))),
    // harness는 file tool로 바꾼 파일만 알고 앱 write는 없다.
    rewindPreview: () =>
      ok(
        data.harness === true
          ? { files: REWIND_PREVIEW.files, apps: [] }
          : REWIND_PREVIEW,
      ),

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
