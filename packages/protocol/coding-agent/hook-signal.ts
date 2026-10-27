// harness hook 신호를 agent event로 바꾸기 전의 중간값이다. 순수 함수이고 화면 출력이나 transcript는
// 읽지 않는다. 상태 계산은 core가 한다.
import type { HarnessId } from "./harnesses.ts";

const HOOK_SIGNAL_TYPES = [
  "SessionStarted",
  "TurnStarted",
  "TurnEnded",
  "PermissionRequested",
  "PermissionResolved",
  "SessionEnded",
] as const;

export type HookSignal = {
  type: (typeof HOOK_SIGNAL_TYPES)[number];
  // SessionStarted. hook이 실제로 준 것만 담는다.
  external_session?: string;
  // TurnEnded.
  outcome?: "completed" | "failed" | "interrupted";
  // TurnEnded. hook payload가 직접 싣는 마지막 답(실패면 오류 글)이다. transcript는 읽지 않는다.
  message?: string;
  // SessionEnded.
  reason?: string;
  // PermissionRequested.
  request?: { tool: string | null; summary: string | null };
};

type SignalType = HookSignal["type"];

// harness 별 event 이름 → 신호다. 표에 없는 이름은 신호가 아니다. 이름은 harness가 내는 그대로다(대소문자 포함).
// json·toml·script·hermes 형식은 설치가 이 표의 key를 그대로 hook event로 놓는다. 그래서 여기에는 매핑하는 event만 둔다.
// plugin·extension 형식은 plugin 본문이 이 이름으로 hook을 부른다.
// PostToolUse·permission.replied는 tool이 실행됐거나 답이 왔다는 뜻이라 PermissionResolved다(대기 중이 아니면 core가 무시한다).
// 같은 이름이 payload로 갈리는 것은 hookSignalOf가 가른다(opencode `session.status`, droid `Notification`, grok `Stop`).
// hook이 없는 harness는 표가 비어 있다(foreground icon만).
const OPENCODE_EVENTS = {
  "session.status": "TurnEnded",
  "permission.asked": "PermissionRequested",
  "permission.replied": "PermissionResolved",
  "question.asked": "PermissionRequested",
  "question.replied": "PermissionResolved",
  "question.rejected": "PermissionResolved",
} as const;

// Claude 꼴(SessionStart·UserPromptSubmit·Stop·StopFailure·PermissionRequest·PostToolUse(Failure)·SessionEnd)이다.
const CLAUDE_SHAPED = {
  SessionStart: "SessionStarted",
  UserPromptSubmit: "TurnStarted",
  Stop: "TurnEnded",
  StopFailure: "TurnEnded",
  PermissionRequest: "PermissionRequested",
  PostToolUse: "PermissionResolved",
  // 실패하거나 거절된 tool도 대기 중인 권한 물음을 끝낸다.
  PostToolUseFailure: "PermissionResolved",
  SessionEnd: "SessionEnded",
} as const;

export const HOOK_EVENT_TABLE: Readonly<
  Record<HarnessId, Readonly<Record<string, SignalType>>>
> = {
  claude: {
    ...CLAUDE_SHAPED,
    // 수동 /compact는 UserPromptSubmit만 내고 Stop을 내지 않는다.
    PostCompact: "TurnEnded",
    // AskUserQuestion은 PreToolUse에서 막힌다. 설치는 이 matcher만 건다.
    PreToolUse: "PermissionRequested",
  },
  codex: {
    SessionStart: "SessionStarted",
    UserPromptSubmit: "TurnStarted",
    Stop: "TurnEnded",
    // Interrupt hook은 Codex 0.150 이상에만 있다. 낮은 판은 이 hook을 부르지 않을 뿐이다.
    Interrupt: "TurnEnded",
    PermissionRequest: "PermissionRequested",
    PostToolUse: "PermissionResolved",
    // plan mode의 request_user_input은 PermissionRequest 없이 PreToolUse에서 막힌다.
    PreToolUse: "PermissionRequested",
  },
  opencode: OPENCODE_EVENTS,
  kilo: OPENCODE_EVENTS,
  mimocode: OPENCODE_EVENTS,
  pi: {
    session_start: "SessionStarted",
    agent_start: "TurnStarted",
    agent_settled: "TurnEnded",
    session_shutdown: "SessionEnded",
  },
  omp: {
    session_start: "SessionStarted",
    agent_start: "TurnStarted",
    agent_end: "TurnEnded",
    tool_approval_requested: "PermissionRequested",
    tool_approval_resolved: "PermissionResolved",
  },
  amp: {
    "session.start": "SessionStarted",
    "agent.start": "TurnStarted",
    "agent.end": "TurnEnded",
  },
  cursor: {
    sessionStart: "SessionStarted",
    beforeSubmitPrompt: "TurnStarted",
    stop: "TurnEnded",
    sessionEnd: "SessionEnded",
  },
  copilot: {
    SessionStart: "SessionStarted",
    UserPromptSubmit: "TurnStarted",
    Stop: "TurnEnded",
    ErrorOccurred: "TurnEnded",
    SessionEnd: "SessionEnded",
    // PermissionRequest는 allow·ask·deny 판정 전에 오므로 쓰지 않는다.
    Notification: "PermissionRequested",
    PostToolUse: "PermissionResolved",
    PostToolUseFailure: "PermissionResolved",
  },
  kimi: {
    SessionStart: "SessionStarted",
    UserPromptSubmit: "TurnStarted",
    Stop: "TurnEnded",
    StopFailure: "TurnEnded",
    // Esc는 Stop 대신 Interrupt를 낸다.
    Interrupt: "TurnEnded",
    PermissionRequest: "PermissionRequested",
    PermissionResult: "PermissionResolved",
    // AskUserQuestion은 PreToolUse에서 막힌다. 설치는 이 matcher만 건다.
    PreToolUse: "PermissionRequested",
    PostToolUse: "PermissionResolved",
    PostToolUseFailure: "PermissionResolved",
    SessionEnd: "SessionEnded",
  },
  kiro: {
    SessionStart: "SessionStarted",
    UserPromptSubmit: "TurnStarted",
    Stop: "TurnEnded",
    SessionEnd: "SessionEnded",
  },
  antigravity: {
    PreInvocation: "TurnStarted",
    Stop: "TurnEnded",
  },
  grok: {
    SessionStart: "SessionStarted",
    UserPromptSubmit: "TurnStarted",
    Stop: "TurnEnded",
    StopFailure: "TurnEnded",
    StopCancelled: "TurnEnded",
    SessionEnd: "SessionEnded",
  },
  droid: {
    SessionStart: "SessionStarted",
    UserPromptSubmit: "TurnStarted",
    Stop: "TurnEnded",
    SessionEnd: "SessionEnded",
    // permission_prompt는 권한 물음이고, 사람이 끊으면 Stop 대신 idle_prompt가 온다.
    Notification: "PermissionRequested",
    PostToolUse: "PermissionResolved",
  },
  devin: {
    SessionStart: "SessionStarted",
    UserPromptSubmit: "TurnStarted",
    Stop: "TurnEnded",
    PermissionRequest: "PermissionRequested",
    PostToolUse: "PermissionResolved",
    SessionEnd: "SessionEnded",
  },
  qwen: CLAUDE_SHAPED,
  qoder: CLAUDE_SHAPED,
  hermes: {
    on_session_start: "SessionStarted",
    pre_llm_call: "TurnStarted",
    // 이름과 달리 turn이 끝날 때마다 온다.
    on_session_end: "TurnEnded",
    on_human_input_request: "PermissionRequested",
    on_human_input_resolved: "PermissionResolved",
    on_session_finalize: "SessionEnded",
  },
  muse: {
    SessionStart: "SessionStarted",
    UserPromptSubmit: "TurnStarted",
    Stop: "TurnEnded",
    StopFailure: "TurnEnded",
    // 권한은 Notification의 permission_prompt만 본다(PermissionRequest와 같이 보면 두 번 센다).
    Notification: "PermissionRequested",
    PostToolUse: "PermissionResolved",
    PostToolUseFailure: "PermissionResolved",
    SessionEnd: "SessionEnded",
  },
  codebuddy: {
    UserPromptSubmit: "TurnStarted",
    Stop: "TurnEnded",
    StopFailure: "TurnEnded",
    // AskUserQuestion도 이 길로 온다. PermissionRequest는 같이 보지 않는다(두 번 센다).
    Notification: "PermissionRequested",
    PostToolUse: "PermissionResolved",
    PostToolUseFailure: "PermissionResolved",
    SessionEnd: "SessionEnded",
  },
  "command-code": {
    SessionStart: "SessionStarted",
    // UserPromptSubmit이 없어 첫 tool 호출을 turn 시작으로 본다. 도구 없는 turn은 running이 되지 않는다.
    PreToolUse: "TurnStarted",
    Stop: "TurnEnded",
  },
  "prime-agent": {},
  cline: {
    UserPromptSubmit: "TurnStarted",
    TaskComplete: "TurnEnded",
    TaskCancel: "TurnEnded",
    TaskError: "TurnEnded",
    SessionShutdown: "SessionEnded",
  },
  letta: {
    SessionStart: "SessionStarted",
    UserPromptSubmit: "TurnStarted",
    Stop: "TurnEnded",
    PermissionRequest: "PermissionRequested",
    PostToolUse: "PermissionResolved",
    PostToolUseFailure: "PermissionResolved",
    SessionEnd: "SessionEnded",
  },
};

const TEXT_MAX_CODE_POINTS = 1_024;

const INVALID = Symbol("invalid");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 없으면 null, 올바른 문자열이면 그 값, 모양이 틀리거나 상한을 넘거나 제어 문자가 있으면 INVALID다.
function textOf(value: unknown): string | null | typeof INVALID {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return INVALID;
  if (/\p{Cc}/u.test(value)) return INVALID;
  if ([...value].length > TEXT_MAX_CODE_POINTS) return INVALID;
  return value;
}

// 권한 물음의 설명이다. 길거나 줄바꿈이 있어도 물음 자체를 버리면 안 되어 다듬어서 쓴다.
function summaryOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = [...value.replace(/\p{Cc}+/gu, " ").trim()]
    .slice(0, TEXT_MAX_CODE_POINTS)
    .join("");
  return text === "" ? null : text;
}

// turn 끝 payload가 마지막 답을 직접 싣는 field다. 없는 harness는 message 없이 알린다.
const CLAUDE_MESSAGE = ["last_assistant_message"] as const;
const TURN_MESSAGE_FIELDS: Partial<Record<HarnessId, readonly string[]>> = {
  claude: CLAUDE_MESSAGE,
  qwen: CLAUDE_MESSAGE,
  qoder: CLAUDE_MESSAGE,
  codebuddy: CLAUDE_MESSAGE,
  kimi: CLAUDE_MESSAGE,
  muse: CLAUDE_MESSAGE,
  devin: CLAUDE_MESSAGE,
  codex: CLAUDE_MESSAGE,
  droid: CLAUDE_MESSAGE,
  "command-code": CLAUDE_MESSAGE,
  antigravity: CLAUDE_MESSAGE,
  grok: ["last_assistant_message", "lastAssistantMessage"],
  // ErrorOccurred는 답 대신 오류 글을 싣는다.
  copilot: [
    "last_assistant_message",
    "lastAssistantMessage",
    "error_message",
    "errorMessage",
    "error",
  ],
  kiro: ["assistant_response"],
};

function turnMessage(
  harness: HarnessId,
  payload: Record<string, unknown>,
): string | null {
  for (const key of TURN_MESSAGE_FIELDS[harness] ?? []) {
    const text = summaryOf(payload[key]);
    if (text !== null) return text;
  }
  return null;
}

type Outcome = NonNullable<HookSignal["outcome"]>;

// plugin·extension이 `lophn_message`에 실어 보낸 마지막 답이다. 끝까지 간 turn의 것만 쓴다.
function pluginTurnEnded(
  type: SignalType,
  outcome: Outcome,
  text: unknown,
): HookSignal {
  const message = outcome === "completed" ? summaryOf(text) : null;
  return message === null ? { type, outcome } : { type, outcome, message };
}

function outcomeOf(value: unknown): Outcome {
  return value === "failed" || value === "interrupted" ? value : "completed";
}

function sessionStarted(id: unknown): HookSignal | null {
  const text = textOf(id);
  if (text === INVALID) return null;
  return text === null
    ? { type: "SessionStarted" }
    : { type: "SessionStarted", external_session: text };
}

export function hookSignalOf(
  harness: HarnessId,
  event: string,
  payload: unknown,
): HookSignal | null {
  const base = HOOK_EVENT_TABLE[harness][event];
  if (base === undefined || !isRecord(payload)) return null;
  switch (harness) {
    case "opencode":
    case "kilo":
    case "mimocode":
      return opencodeSignal(base, event, payload);
    case "pi":
      return piSignal(base, event, payload);
    case "omp":
      return ompSignal(base, event, payload);
    case "amp":
      return ampSignal(base, event, payload);
    default:
      return commandHookSignal(harness, base, event, payload);
  }
}

// 하위 agent의 권한 물음은 main agent도 같이 막는다. 이 harness들은 그 event를 main의 신호로 받는다.
const SUBAGENT_PERMISSION_PASSES: readonly HarnessId[] = [
  "claude",
  "codex",
  "qwen",
  "qoder",
];

// subagent의 event는 main session의 신호가 아니다. 표지는 harness마다 다르다.
function isSubagent(
  harness: HarnessId,
  type: SignalType,
  payload: Record<string, unknown>,
): boolean {
  switch (harness) {
    // letta는 main agent도 agent_id를 싣는다.
    case "letta":
      return false;
    case "grok":
      return payload.subagentType !== undefined;
    // Muse 1.3의 하위 session은 session_id를 turn_id로도 쓴다.
    case "muse":
      return (
        payload.turn_id !== undefined && payload.turn_id === payload.session_id
      );
    case "cline":
      return Boolean(payload.parent_agent_id);
    case "hermes":
      return isRecord(payload.extra) && payload.extra.platform === "subagent";
    default:
      if (
        SUBAGENT_PERMISSION_PASSES.includes(harness) &&
        (type === "PermissionRequested" || type === "PermissionResolved")
      ) {
        return false;
      }
      return payload.agent_id !== undefined;
  }
}

const SESSION_ID_KEYS = [
  "session_id",
  "sessionId",
  "conversation_id",
  "conversationId",
  "taskId",
];

function turnOutcome(
  harness: HarnessId,
  event: string,
  payload: Record<string, unknown>,
): Outcome | null {
  switch (event) {
    case "StopFailure":
    case "TaskError":
      return "failed";
    case "Interrupt":
    case "TaskCancel":
      return "interrupted";
    // max_turns·no_progress처럼 runtime이 끝낸 것은 사람이 끊은 것이 아니다.
    case "StopCancelled":
      return payload.cancelledBy === "runtime" ? "completed" : "interrupted";
    // 수동 /compact는 Stop 없이 끝나 탭이 running에 남는다. 알림 없이 끝내려고 interrupted로 닫는다.
    case "PostCompact":
      return payload.trigger === "manual" ? "interrupted" : null;
    case "ErrorOccurred":
      return payload.recoverable === false ? "failed" : null;
    case "stop":
      return payload.status === "error"
        ? "failed"
        : payload.status === "aborted"
          ? "interrupted"
          : "completed";
    case "on_session_end": {
      const extra = isRecord(payload.extra) ? payload.extra : {};
      return extra.failed === true
        ? "failed"
        : extra.interrupted === true
          ? "interrupted"
          : "completed";
    }
    case "Stop":
      // grok은 session 끝에 reason이 channel_closed·shutdown인 Stop을 또 낸다.
      if (harness === "grok" && payload.reason !== "end_turn") return null;
      if (harness === "antigravity") {
        if (payload.fullyIdle !== true) return null;
        return payload.terminationReason === "error" ||
          (payload.error !== undefined && payload.error !== null)
          ? "failed"
          : "completed";
      }
      return payload.is_interrupt === true ? "interrupted" : "completed";
    default:
      return "completed";
  }
}

// payload는 hook이 stdin으로 준 JSON이다.
function commandHookSignal(
  harness: HarnessId,
  type: SignalType,
  event: string,
  payload: Record<string, unknown>,
): HookSignal | null {
  if (isSubagent(harness, type, payload)) return null;
  // compact로 시작한 SessionStart와 clear로 끝난 SessionEnd는 session 경계가 아니다.
  if (event === "SessionStart" && payload.source === "compact") return null;
  if (event === "SessionEnd" && payload.reason === "clear") return null;
  switch (type) {
    case "SessionStarted": {
      const id = SESSION_ID_KEYS.map((key) => payload[key]).find(
        (value) => value !== undefined && value !== null,
      );
      return sessionStarted(id);
    }
    case "TurnStarted":
      // letta의 slash command는 model turn이 아니다.
      return payload.is_command === true ? null : { type };
    case "TurnEnded": {
      const outcome = turnOutcome(harness, event, payload);
      if (outcome === null) return null;
      const message = turnMessage(harness, payload);
      return message === null ? { type, outcome } : { type, outcome, message };
    }
    case "PermissionRequested":
      return permissionRequested(harness, event, payload);
    case "SessionEnded": {
      const reason = textOf(payload.reason);
      if (reason === INVALID) return null;
      return reason === null ? { type } : { type, reason };
    }
    default:
      return { type };
  }
}

function permissionRequested(
  harness: HarnessId,
  event: string,
  payload: Record<string, unknown>,
): HookSignal | null {
  const type = "PermissionRequested";
  switch (event) {
    case "Notification": {
      const kind = payload.notification_type;
      // droid는 사람이 turn을 끊으면 Stop 대신 idle_prompt를 낸다.
      if (harness === "droid" && kind === "idle_prompt") {
        return { type: "TurnEnded", outcome: "interrupted" };
      }
      if (
        kind !== "permission_prompt" &&
        !(harness === "copilot" && kind === "elicitation_dialog")
      )
        return null;
      return {
        type,
        request: { tool: null, summary: summaryOf(payload.message) },
      };
    }
    case "PreToolUse": {
      // 사람에게 묻는 tool만 권한 물음이다. 설치도 이 matcher만 건다.
      const ask =
        harness === "codex" ? "request_user_input" : "AskUserQuestion";
      if (payload.tool_name !== ask) return null;
      return { type, request: { tool: ask, summary: null } };
    }
    case "on_human_input_request": {
      const extra = isRecord(payload.extra) ? payload.extra : {};
      const tool = textOf(extra.kind);
      if (tool === INVALID) return null;
      return { type, request: { tool, summary: summaryOf(extra.prompt) } };
    }
    default: {
      const tool = textOf(payload.tool_name);
      if (tool === INVALID) return null;
      return { type, request: { tool, summary: null } };
    }
  }
}

// OpenCode 계열 plugin의 payload는 `{type, properties}`다. 하위 session은 plugin이 root event만 넘긴다.
// turn 끝의 outcome은 plugin이 session 오류·중단 event를 보고 `properties.lophn_outcome`에, 마지막 답은 `properties.lophn_message`에 싣는다.
function opencodeSignal(
  base: SignalType,
  event: string,
  payload: Record<string, unknown>,
): HookSignal | null {
  const properties = payload.properties;
  if (!isRecord(properties)) return null;
  switch (event) {
    case "session.status": {
      const status = isRecord(properties.status)
        ? properties.status.type
        : null;
      if (status === "busy" || status === "retry") {
        return { type: "TurnStarted" };
      }
      return status === "idle"
        ? pluginTurnEnded(
            base,
            outcomeOf(properties.lophn_outcome),
            properties.lophn_message,
          )
        : null;
    }
    case "permission.asked": {
      const tool = textOf(properties.permission);
      if (tool === INVALID) return null;
      return { type: base, request: { tool, summary: null } };
    }
    case "question.asked":
      return { type: base, request: { tool: "question", summary: null } };
    default:
      return { type: base };
  }
}

// pi extension의 payload는 `{event, session_id?, aborted?, reason?, lophn_message?}`다. process 종료는 host가 안다.
function piSignal(
  type: SignalType,
  event: string,
  payload: Record<string, unknown>,
): HookSignal | null {
  switch (event) {
    // reload는 같은 session을 다시 읽는 것이다.
    case "session_start":
      return payload.reason === "reload"
        ? null
        : sessionStarted(payload.session_id);
    case "agent_settled":
      return pluginTurnEnded(
        type,
        payload.aborted === true ? "interrupted" : "completed",
        payload.lophn_message,
      );
    // fork·resume·reload로도 닫히는 session이 있어 quit만 session 끝이다.
    case "session_shutdown":
      return payload.reason === "quit" ? { type, reason: "quit" } : null;
    default:
      return { type };
  }
}

// omp extension은 main이 아닌 agent와 이어질 turn(willContinue)을 걸러 `{event, session_id?, outcome?, lophn_message?, tool_name?, reason?}`로 보낸다.
function ompSignal(
  type: SignalType,
  event: string,
  payload: Record<string, unknown>,
): HookSignal | null {
  switch (event) {
    case "session_start":
      return sessionStarted(payload.session_id);
    case "agent_end":
      return pluginTurnEnded(
        type,
        outcomeOf(payload.outcome),
        payload.lophn_message,
      );
    case "tool_approval_requested": {
      const tool = textOf(payload.tool_name);
      if (tool === INVALID) return null;
      return { type, request: { tool, summary: summaryOf(payload.reason) } };
    }
    default:
      return { type };
  }
}

// amp plugin의 payload는 `{event, session_id?, status?, lophn_message?}`다.
function ampSignal(
  type: SignalType,
  event: string,
  payload: Record<string, unknown>,
): HookSignal | null {
  switch (event) {
    case "session.start":
      return sessionStarted(payload.session_id);
    case "agent.end":
      return pluginTurnEnded(
        type,
        payload.status === "error"
          ? "failed"
          : payload.status === "cancelled"
            ? "interrupted"
            : "completed",
        payload.lophn_message,
      );
    default:
      return { type };
  }
}
