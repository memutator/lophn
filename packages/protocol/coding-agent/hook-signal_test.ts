import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HARNESS_ADAPTERS,
  hookStdout,
  hookStdoutRows,
} from "./harness-adapter.ts";
import { HARNESS_IDS, type HarnessId } from "./harness-id.ts";
import {
  launchArgsOfProcess,
  parseGuiLaunchArgs,
  sessionOfProcess,
} from "./harness-process.ts";
import { type HookSignal, hookSignalOf } from "./hook-signal.ts";

const status = (type: string, lophn_outcome?: string) => ({
  properties: { status: { type }, lophn_outcome },
});

// 가장 쉽게 다시 깨질 판정만 표로 본다. 같은 event 이름이 payload로 갈리거나, 하위 agent 거르기가 harness마다 다른 곳이다.
const CASES: [string, HarnessId, string, unknown, HookSignal | null][] = [
  [
    "grok: turn 끝의 Stop",
    "grok",
    "Stop",
    { reason: "end_turn" },
    {
      type: "TurnEnded",
      outcome: "completed",
    },
  ],
  // session 끝에 오는 Stop을 turn 끝으로 받으면 알림이 한 번 더 간다.
  ["grok: shutdown Stop", "grok", "Stop", { reason: "shutdown" }, null],
  [
    "grok: runtime이 끊은 StopCancelled",
    "grok",
    "StopCancelled",
    {
      cancelledBy: "runtime",
    },
    { type: "TurnEnded", outcome: "completed" },
  ],
  [
    "grok: subagent event",
    "grok",
    "UserPromptSubmit",
    {
      subagentType: "explore",
    },
    null,
  ],
  [
    "antigravity: 아직 idle이 아닌 Stop",
    "antigravity",
    "Stop",
    {
      fullyIdle: false,
    },
    null,
  ],
  [
    "antigravity: Go 빈 error 문자열로 끝난 Stop은 completed다",
    "antigravity",
    "Stop",
    {
      fullyIdle: true,
      error: "",
    },
    { type: "TurnEnded", outcome: "completed" },
  ],
  [
    "antigravity: 공백뿐인 error 문자열로 끝난 Stop도 completed다",
    "antigravity",
    "Stop",
    {
      fullyIdle: true,
      error: "   ",
    },
    { type: "TurnEnded", outcome: "completed" },
  ],
  [
    "antigravity: 비어 있지 않은 error로 끝난 Stop",
    "antigravity",
    "Stop",
    {
      fullyIdle: true,
      error: "boom",
    },
    { type: "TurnEnded", outcome: "failed" },
  ],
  [
    "antigravity: 대문자 terminationReason ERROR로 끝난 Stop",
    "antigravity",
    "Stop",
    {
      fullyIdle: true,
      terminationReason: "ERROR",
    },
    { type: "TurnEnded", outcome: "failed" },
  ],
  [
    "antigravity: snake_case termination_reason error로 끝난 Stop",
    "antigravity",
    "Stop",
    {
      fullyIdle: true,
      termination_reason: "error",
    },
    { type: "TurnEnded", outcome: "failed" },
  ],
  [
    "antigravity: PreToolUse 질문 도구는 PermissionRequested다",
    "antigravity",
    "PreToolUse",
    {
      conversationId: "conv-1",
      tool_name: "ask_question",
      tool_input: { questions: [{ question: "Proceed?" }] },
    },
    {
      type: "PermissionRequested",
      request: { tool: "ask_question", summary: "Proceed?" },
      external_session: "conv-1",
    },
  ],
  [
    "antigravity: PreToolUse camelCase toolName ask_user_question",
    "antigravity",
    "PreToolUse",
    {
      toolName: "ask_user_question",
    },
    {
      type: "PermissionRequested",
      request: { tool: "ask_user_question", summary: null },
    },
  ],
  [
    "antigravity: PreToolUse AskUserQuestion",
    "antigravity",
    "PreToolUse",
    {
      toolName: "AskUserQuestion",
    },
    {
      type: "PermissionRequested",
      request: { tool: "AskUserQuestion", summary: null },
    },
  ],
  [
    "antigravity: PreToolUse 실제 protojson toolCall 질문 도구는 PermissionRequested다",
    "antigravity",
    "PreToolUse",
    {
      conversationId: "conv-1",
      toolCall: {
        id: "toolu_01",
        name: "ask_question",
        args: { questions: [{ question: "Ship now?" }] },
      },
      stepIdx: 12,
    },
    {
      type: "PermissionRequested",
      request: { tool: "ask_question", summary: "Ship now?" },
      external_session: "conv-1",
    },
  ],
  [
    "antigravity: PreToolUse 실제 protojson toolCall invoke_subagent는 null이다",
    "antigravity",
    "PreToolUse",
    {
      conversationId: "conv-1",
      toolCall: {
        id: "toolu_02",
        name: "invoke_subagent",
        args: { TypeName: "self", Role: "Fixer" },
      },
    },
    null,
  ],
  [
    "antigravity: parentConversationId가 있는 subagent hook은 null이다",
    "antigravity",
    "SessionStart",
    {
      conversationId: "child-1",
      parentConversationId: "parent-1",
      rootConversationId: "parent-1",
      agentName: "self",
    },
    null,
  ],
  [
    "antigravity: rootConversationId가 conversationId와 다르면 subagent hook으로 null이다",
    "antigravity",
    "PostToolUse",
    {
      conversationId: "grandchild-1",
      rootConversationId: "parent-1",
      toolCall: { id: "toolu_03", name: "run_command", args: {} },
    },
    null,
  ],
  [
    "antigravity: parentConversationId가 비고 rootConversationId가 같으면 main 세션이다",
    "antigravity",
    "PreInvocation",
    {
      conversationId: "parent-1",
      parentConversationId: "",
      rootConversationId: "parent-1",
      lastUserInput: "Main prompt",
    },
    {
      type: "TurnStarted",
      prompt: "Main prompt",
      external_session: "parent-1",
    },
  ],
  [
    "antigravity: PreToolUse 일반 도구는 waiting을 만들지 않는다",
    "antigravity",
    "PreToolUse",
    {
      tool_name: "invoke_subagent",
    },
    null,
  ],
  [
    "antigravity: PreToolUse run_command는 null이다",
    "antigravity",
    "PreToolUse",
    {
      toolName: "run_command",
    },
    null,
  ],
  [
    "antigravity: PostToolUse는 PermissionResolved다",
    "antigravity",
    "PostToolUse",
    {
      conversationId: "conv-1",
      tool_name: "ask_question",
    },
    { type: "PermissionResolved", external_session: "conv-1" },
  ],
  [
    "antigravity: SessionStart의 conversationId",
    "antigravity",
    "SessionStart",
    { conversationId: "conv-1" },
    { type: "SessionStarted", external_session: "conv-1" },
  ],
  [
    "antigravity: PreInvocation의 lastUserInput을 prompt로 읽는다",
    "antigravity",
    "PreInvocation",
    {
      conversationId: "conv-1",
      lastUserInput: "Fix the bug\nwith details",
    },
    {
      type: "TurnStarted",
      prompt: "Fix the bug",
      external_session: "conv-1",
    },
  ],
  // 마지막 답은 payload가 직접 준 것만 싣는다. 줄바꿈은 공백이 되고 transcript는 읽지 않는다.
  [
    "claude: Stop의 마지막 답",
    "claude",
    "Stop",
    {
      last_assistant_message: "Done.\nTests pass.",
      transcript_path: "/tmp/t.jsonl",
    },
    { type: "TurnEnded", outcome: "completed", message: "Done. Tests pass." },
  ],
  [
    "claude: 실패한 turn의 오류 글",
    "claude",
    "StopFailure",
    {
      last_assistant_message: "API Error: rate limit",
    },
    {
      type: "TurnEnded",
      outcome: "failed",
      message: "API Error: rate limit",
    },
  ],
  [
    "claude: 마지막 답이 없는 Stop",
    "claude",
    "Stop",
    {
      transcript_path: "/tmp/t.jsonl",
    },
    { type: "TurnEnded", outcome: "completed" },
  ],
  [
    "cursor: stop은 답을 싣지 않는다",
    "cursor",
    "stop",
    {
      status: "completed",
      last_assistant_message: "ignored",
    },
    { type: "TurnEnded", outcome: "completed" },
  ],
  [
    "kiro: assistant_response",
    "kiro",
    "Stop",
    {
      assistant_response: "Hi",
    },
    { type: "TurnEnded", outcome: "completed", message: "Hi" },
  ],
  // letta는 main agent도 agent_id를 싣는다.
  [
    "letta: agent_id가 있어도 main",
    "letta",
    "UserPromptSubmit",
    {
      agent_id: "agent-1",
    },
    { type: "TurnStarted" },
  ],
  [
    "claude: subagent의 권한 물음",
    "claude",
    "PermissionRequest",
    {
      agent_id: "sub",
      tool_name: "Bash",
    },
    { type: "PermissionRequested", request: { tool: "Bash", summary: null } },
  ],
  ["claude: subagent의 Stop", "claude", "Stop", { agent_id: "sub" }, null],
  // 근거: 문서와 Claude Code CLI 2.1.316 bundle의 schema. 실제 harness를 돌려 받은 payload가 아니다.
  [
    "claude: SubagentStart",
    "claude",
    "SubagentStart",
    { agent_id: "a1", agent_type: "Explore", session_id: "s-1" },
    { type: "ChildStarted", child: "a1", external_session: "s-1" },
  ],
  [
    "claude: SubagentStop",
    "claude",
    "SubagentStop",
    { agent_id: "a1", agent_type: "Explore" },
    { type: "ChildEnded", child: "a1" },
  ],
  // Start를 놓쳐도 하위 agent의 tool hook으로 child가 살아 있음을 안다.
  [
    "claude: agent_id가 붙은 PostToolUse",
    "claude",
    "PostToolUse",
    { agent_id: "a1", tool_name: "Bash" },
    { type: "ChildStarted", child: "a1" },
  ],
  // `type: "agent"` hook은 SubagentStop을 내지 않아 child로 세면 끝나지 않는다.
  [
    "claude: hook agent의 PostToolUse",
    "claude",
    "PostToolUse",
    { agent_id: "hook-agent-1", tool_name: "Read" },
    { type: "PermissionResolved" },
  ],
  // 살아 있는 subagent만 children이 된다. shell·monitor·teammate와 끝난 항목은 세지 않는다.
  [
    "claude: Stop의 background_tasks",
    "claude",
    "Stop",
    {
      background_tasks: [
        { id: "a1", type: "subagent", status: "running", description: "x" },
        { id: "a2", type: "subagent", status: "pending", description: "x" },
        { id: "a3", type: "subagent", status: "completed", description: "x" },
        { id: "b1", type: "shell", status: "running", description: "x" },
        { id: "m1", type: "monitor", status: "running", description: "x" },
        { id: "t1", type: "teammate", status: "running", description: "x" },
      ],
    },
    { type: "TurnEnded", outcome: "completed", children: ["a1", "a2"] },
  ],
  [
    "claude: background shell만 남은 Stop",
    "claude",
    "Stop",
    {
      background_tasks: [
        { id: "b1", type: "shell", status: "running", description: "x" },
      ],
    },
    { type: "TurnEnded", outcome: "completed", children: [] },
  ],
  // SubagentStop을 매핑하지 않은 harness는 끝을 몰라 child 신호를 만들지 않는다.
  [
    "codex: agent_id가 붙은 PostToolUse",
    "codex",
    "PostToolUse",
    { agent_id: "a1", tool_name: "Bash" },
    { type: "PermissionResolved" },
  ],
  [
    "opencode: 하위 session의 busy",
    "opencode",
    "session.status",
    {
      properties: {
        sessionID: "root",
        lophn_child: "ses_c",
        status: { type: "busy" },
      },
    },
    { type: "ChildStarted", child: "ses_c", external_session: "root" },
  ],
  [
    "opencode: 하위 session의 idle",
    "opencode",
    "session.status",
    {
      properties: {
        sessionID: "root",
        lophn_child: "ses_c",
        status: { type: "idle" },
      },
    },
    { type: "ChildEnded", child: "ses_c", external_session: "root" },
  ],
  [
    "claude: 수동 compact는 알림 없이 끝",
    "claude",
    "PostCompact",
    {
      trigger: "manual",
    },
    { type: "TurnEnded", outcome: "interrupted" },
  ],
  [
    "claude: AskUserQuestion이 아닌 PreToolUse",
    "claude",
    "PreToolUse",
    {
      tool_name: "Bash",
    },
    null,
  ],
  [
    "droid: 끊김은 idle_prompt로 온다",
    "droid",
    "Notification",
    {
      notification_type: "idle_prompt",
    },
    { type: "TurnEnded", outcome: "interrupted" },
  ],
  [
    "opencode: 실패로 끝난 idle",
    "opencode",
    "session.status",
    status("idle", "failed"),
    {
      type: "TurnEnded",
      outcome: "failed",
    },
  ],
  [
    "kilo: outcome이 없는 idle",
    "kilo",
    "session.status",
    status("idle"),
    {
      type: "TurnEnded",
      outcome: "completed",
    },
  ],
  // plugin·extension이 싣는 마지막 답은 끝까지 간 turn의 것만 쓴다.
  [
    "opencode: completed idle의 lophn_message",
    "opencode",
    "session.status",
    {
      properties: {
        status: { type: "idle" },
        lophn_outcome: "completed",
        lophn_message: "Done.\nTests pass.",
      },
    },
    { type: "TurnEnded", outcome: "completed", message: "Done. Tests pass." },
  ],
  [
    "opencode: 실패한 idle은 message를 버린다",
    "opencode",
    "session.status",
    {
      properties: {
        status: { type: "idle" },
        lophn_outcome: "failed",
        lophn_message: "old",
      },
    },
    { type: "TurnEnded", outcome: "failed" },
  ],
  [
    "pi: agent_settled의 lophn_message",
    "pi",
    "agent_settled",
    { aborted: false, lophn_message: "Hi" },
    { type: "TurnEnded", outcome: "completed", message: "Hi" },
  ],
  [
    "omp: agent_end의 lophn_message",
    "omp",
    "agent_end",
    { outcome: "completed", lophn_message: "Hello" },
    { type: "TurnEnded", outcome: "completed", message: "Hello" },
  ],
  // OpenCode는 turn 끝을 session.status(idle) 하나로만 낸다. session.idle까지 받으면 TurnEnded가 두 번 간다.
  [
    "opencode: session.idle",
    "opencode",
    "session.idle",
    { properties: {} },
    null,
  ],
  [
    "pi: quit이 아닌 shutdown",
    "pi",
    "session_shutdown",
    { reason: "reload" },
    null,
  ],
  // session id는 SessionStarted만이 아니라 모든 신호에서 읽는다(/clear·resume으로 바뀐 session을 따라가려고).
  [
    "claude: UserPromptSubmit의 session_id",
    "claude",
    "UserPromptSubmit",
    { session_id: "s-1" },
    { type: "TurnStarted", external_session: "s-1" },
  ],
  [
    "claude: session_title이 name으로 실린다",
    "claude",
    "UserPromptSubmit",
    { session_id: "s-1", session_title: "my title", prompt: "hi" },
    {
      type: "TurnStarted",
      prompt: "hi",
      external_session: "s-1",
      name: "my title",
    },
  ],
  [
    "opencode: properties.sessionID",
    "opencode",
    "permission.replied",
    { type: "permission.replied", properties: { sessionID: "ses_1" } },
    { type: "PermissionResolved", external_session: "ses_1" },
  ],
  // 틀린 id 때문에 신호를 버리지 않는다.
  [
    "claude: 모양이 틀린 session_id",
    "claude",
    "Stop",
    { session_id: 7 },
    { type: "TurnEnded", outcome: "completed" },
  ],
];

test("harness별 hook 신호 판정", () => {
  for (const [name, harness, event, payload, want] of CASES) {
    assert.deepStrictEqual(hookSignalOf(harness, event, payload), want, name);
  }
});

test("antigravity hookStdout은 PreToolUse가 빈 문자열이고 Stop과 나머지가 맞는다", () => {
  assert.strictEqual(hookStdout("antigravity", "PreToolUse"), "");
  assert.strictEqual(hookStdout("antigravity", "Stop"), '{"decision":"stop"}');
  assert.strictEqual(hookStdout("antigravity", "SessionStart"), "{}");
  assert.strictEqual(hookStdout("antigravity", "PreInvocation"), "{}");
  assert.strictEqual(hookStdout("antigravity", "PostToolUse"), "{}");
  assert.strictEqual(hookStdout("claude", "Stop"), null);
  assert.deepStrictEqual(
    hookStdoutRows().find(
      (row) => row.harness === "antigravity" && row.event === "PreToolUse",
    ),
    { harness: "antigravity", event: "PreToolUse", stdout: "" },
  );
});

test("harness 항목의 hook·events·session이 서로 맞는다", () => {
  for (const id of HARNESS_IDS) {
    const { hook, events, session } = HARNESS_ADAPTERS[id];
    if (Object.keys(events).length > 0) {
      assert.notEqual(hook, null, `${id}: events가 있으면 놓을 hook이 있다`);
    }
    if (session.resume !== null) {
      assert.ok(session.id.length > 0, `${id}: resume은 session id가 필요하다`);
      assert.ok(
        Object.keys(events).length > 0,
        `${id}: resume은 hook이 필요하다`,
      );
      assert.equal(
        session.resume.filter((arg) => arg.includes("{id}")).length,
        1,
        `${id}: {id}는 한 번`,
      );
    }
  }
});

test("sessionOfProcess extracts resumed CLI session ids across flag styles and rejects invalid values", () => {
  assert.equal(
    sessionOfProcess("antigravity", [
      "agy",
      "--dangerously-skip-permissions",
      "--conversation",
      "26e8bf45-50c5-4e72-b332-855cf6cff86e",
    ]),
    "26e8bf45-50c5-4e72-b332-855cf6cff86e",
  );
  assert.equal(
    sessionOfProcess("antigravity", ["agy", "--conversation=conv_1"]),
    "conv_1",
  );
  assert.equal(
    sessionOfProcess("antigravity", [
      "node",
      "/usr/local/bin/agy",
      "--conversation",
      "conv-2",
    ]),
    "conv-2",
  );
  assert.equal(
    sessionOfProcess("claude", ["claude", "--resume=ses-1"]),
    "ses-1",
  );
  assert.equal(
    sessionOfProcess("codex", ["codex", "resume", "thr_1"]),
    "thr_1",
  );
  assert.equal(sessionOfProcess("codex", ["codex", "resume", "--last"]), null);
  assert.equal(
    sessionOfProcess("kiro", ["kiro-cli", "chat", "--resume-id", "k-1"]),
    "k-1",
  );
  assert.equal(
    sessionOfProcess("antigravity", ["agy", "--conversation", "../etc"]),
    null,
  );
  assert.equal(
    sessionOfProcess("antigravity", ["agy", "--conversation", "--model"]),
    null,
  );
  assert.equal(
    sessionOfProcess("antigravity", ["agy", "--", "--conversation", "conv-3"]),
    null,
  );
});

test("parseGuiLaunchArgs separates resume id from launch flags and rejects invalid session ids", () => {
  assert.deepEqual(
    parseGuiLaunchArgs("antigravity", [
      "--dangerously-skip-permissions",
      "--gui",
      "--conversation",
      "conv-1",
      "--model",
      "gemini-3",
    ]),
    {
      ok: true,
      resume: "conv-1",
      args: ["--dangerously-skip-permissions", "--model", "gemini-3"],
    },
  );
  assert.deepEqual(
    parseGuiLaunchArgs("codex", [
      "--no-daemon",
      "-m",
      "o3",
      "resume",
      "thr_1",
      "--dangerously-bypass-approvals-and-sandbox",
    ]),
    {
      ok: true,
      resume: "thr_1",
      args: ["-m", "o3", "--dangerously-bypass-approvals-and-sandbox"],
    },
  );
  assert.deepEqual(
    launchArgsOfProcess("claude", [
      "claude",
      "--dangerously-skip-permissions",
      "--resume",
      "ses-1",
      "--model",
      "opus",
    ]),
    ["--dangerously-skip-permissions", "--model", "opus"],
  );
  assert.equal(parseGuiLaunchArgs("claude", ["--resume", "../etc"]).ok, false);
});
