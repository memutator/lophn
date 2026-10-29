import assert from "node:assert/strict";
import { test } from "node:test";

import { HARNESS_ADAPTERS } from "./harness-adapter.ts";
import { HARNESS_IDS, type HarnessId } from "./harness-id.ts";
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
    "antigravity: error로 끝난 Stop",
    "antigravity",
    "Stop",
    {
      fullyIdle: true,
      terminationReason: "error",
    },
    { type: "TurnEnded", outcome: "failed" },
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
