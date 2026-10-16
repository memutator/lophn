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
  // SessionEnded.
  reason?: string;
  // PermissionRequested.
  request?: { tool: string | null; summary: string | null };
};

type SignalType = HookSignal["type"];

// harness 별 event 이름 → 신호다. 표에 없는 이름은 신호가 아니다.
// PostToolUse·AfterTool·permission.replied는 tool이 실행됐거나 답이 왔다는 뜻이라 PermissionResolved다
// (대기 중이 아니면 core가 무시한다). opencode `session.status`는 이름만으로 갈리지 않아
// hookSignalOf가 status로 가른다(busy·retry는 TurnStarted, idle은 TurnEnded).
// hermes와 openclaw는 hook이 없어 표가 비어 있다.
export const HOOK_EVENT_TABLE: Readonly<
  Record<HarnessId, Readonly<Record<string, SignalType>>>
> = {
  claude: {
    SessionStart: "SessionStarted",
    UserPromptSubmit: "TurnStarted",
    Stop: "TurnEnded",
    StopFailure: "TurnEnded",
    PermissionRequest: "PermissionRequested",
    PostToolUse: "PermissionResolved",
    SessionEnd: "SessionEnded",
  },
  codex: {
    SessionStart: "SessionStarted",
    UserPromptSubmit: "TurnStarted",
    Stop: "TurnEnded",
    PermissionRequest: "PermissionRequested",
    PostToolUse: "PermissionResolved",
  },
  gemini: {
    SessionStart: "SessionStarted",
    BeforeAgent: "TurnStarted",
    AfterAgent: "TurnEnded",
    Notification: "PermissionRequested",
    AfterTool: "PermissionResolved",
    SessionEnd: "SessionEnded",
  },
  opencode: {
    "session.status": "TurnEnded",
    "session.idle": "TurnEnded",
    "permission.asked": "PermissionRequested",
    "permission.replied": "PermissionResolved",
  },
  pi: {
    session_start: "SessionStarted",
    agent_start: "TurnStarted",
    agent_settled: "TurnEnded",
  },
  hermes: {},
  openclaw: {},
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

export function hookSignalOf(
  harness: HarnessId,
  event: string,
  payload: unknown,
): HookSignal | null {
  const base = HOOK_EVENT_TABLE[harness][event];
  if (base === undefined || !isRecord(payload)) return null;
  if (harness === "opencode") return opencodeSignal(base, event, payload);
  if (harness === "pi") return piSignal(base, payload);
  return commandHookSignal(harness, base, event, payload);
}

// Claude Code·Codex·Gemini CLI. payload는 hook이 stdin으로 준 JSON이다.
function commandHookSignal(
  harness: HarnessId,
  type: SignalType,
  event: string,
  payload: Record<string, unknown>,
): HookSignal | null {
  // subagent의 event는 main session의 신호가 아니다.
  if (payload.agent_id !== undefined) return null;
  // compact로 시작한 SessionStart와 clear로 끝난 SessionEnd는 session 경계가 아니다.
  if (event === "SessionStart" && payload.source === "compact") return null;
  if (event === "SessionEnd" && payload.reason === "clear") return null;
  switch (type) {
    case "SessionStarted": {
      const id = textOf(payload.session_id);
      if (id === INVALID) return null;
      return id === null ? { type } : { type, external_session: id };
    }
    case "TurnEnded":
      return {
        type,
        outcome: event === "StopFailure" ? "failed" : "completed",
      };
    case "PermissionRequested": {
      // Gemini Notification은 ToolPermission만 권한 물음이다.
      if (
        harness === "gemini" && payload.notification_type !== "ToolPermission"
      ) {
        return null;
      }
      const tool = textOf(payload.tool_name);
      const summary = harness === "gemini" ? textOf(payload.message) : null;
      if (tool === INVALID) return null;
      return {
        type,
        request: { tool, summary: summary === INVALID ? null : summary },
      };
    }
    case "SessionEnded": {
      const reason = textOf(payload.reason);
      if (reason === INVALID) return null;
      return reason === null ? { type } : { type, reason };
    }
    default:
      return { type };
  }
}

// OpenCode plugin의 payload는 `{type, properties}`다. 하위 session은 plugin이 root event만 넘긴다.
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
      return status === "idle" ? { type: base, outcome: "completed" } : null;
    }
    case "session.idle":
      return { type: base, outcome: "completed" };
    case "permission.asked": {
      const tool = textOf(properties.permission);
      if (tool === INVALID) return null;
      return { type: base, request: { tool, summary: null } };
    }
    default:
      return { type: base };
  }
}

// pi extension의 payload는 `{event, session_id?, aborted?}`다. process 종료는 host가 안다.
function piSignal(
  type: SignalType,
  payload: Record<string, unknown>,
): HookSignal | null {
  if (type === "SessionStarted") {
    const id = textOf(payload.session_id);
    if (id === INVALID) return null;
    return id === null ? { type } : { type, external_session: id };
  }
  if (type === "TurnEnded") {
    return {
      type,
      outcome: payload.aborted === true ? "interrupted" : "completed",
    };
  }
  return { type };
}
