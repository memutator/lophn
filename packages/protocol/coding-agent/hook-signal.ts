// harness hook 신호를 agent event로 바꾸기 전의 중간값이다. 순수 함수이고 화면 출력이나 transcript는
// 읽지 않는다. 상태 계산은 core가 한다.
import { HARNESS_ADAPTERS } from "./harness-adapter.ts";
import type { HarnessId } from "./harness-id.ts";

const HOOK_SIGNAL_TYPES = [
  "SessionStarted",
  "TurnStarted",
  "TurnEnded",
  "PermissionRequested",
  "PermissionResolved",
  "SessionEnded",
  "SessionNamed",
  "ChildStarted",
  "ChildEnded",
] as const;

export type HookSignal = {
  type: (typeof HOOK_SIGNAL_TYPES)[number];
  // hook이 실제로 준 session id만 담는다. 어느 event에서든 읽는다(`session.id`).
  external_session?: string;
  // TurnStarted. hook payload가 싣는 사용자 prompt다. session 제목으로 쓴다.
  prompt?: string;
  // harness가 정한 session 이름이다. 어느 event에서든 읽는다(`session.name`). SessionNamed는 이것만 알린다.
  name?: string;
  // TurnEnded.
  outcome?: "completed" | "failed" | "interrupted";
  // TurnEnded. hook payload가 직접 싣는 마지막 답(실패면 오류 글)이다. transcript는 읽지 않는다.
  message?: string;
  // SessionEnded.
  reason?: string;
  // PermissionRequested.
  request?: { tool: string | null; summary: string | null };
  // ChildStarted·ChildEnded. harness 안에서 child(subagent)를 가르는 id다(Claude는 agent_id, OpenCode는 하위 session id).
  child?: string;
  // TurnEnded. Stop payload가 아직 살아 있다고 알린 agent child의 id들이다. 없으면 생략한다(background shell은 싣지 않는다).
  children?: readonly string[];
};

type SignalType = HookSignal["type"];

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

// Claude Stop payload의 `background_tasks` 항목 중 아직 도는 subagent의 id다. 항목 꼴과 종류 label("subagent")은 Claude Code
// CLI 2.1.316 bundle에서 읽었고 실제 payload로는 확인하지 못했다. teammate는 id가 lifecycle agent_id와 맞지 않고 끝나도
// running으로 남아 세지 않는다. shell·monitor·workflow도 세지 않는다.
function liveChildren(payload: Record<string, unknown>): string[] {
  const tasks = payload.background_tasks;
  if (!Array.isArray(tasks)) return [];
  const ids: string[] = [];
  for (const task of tasks) {
    if (!isRecord(task) || task.type !== "subagent") continue;
    if (task.status !== "running" && task.status !== "pending") continue;
    if (typeof task.id === "string" && task.id !== "") ids.push(task.id);
  }
  return ids;
}

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

// payload에서 `paths` 중 처음으로 값이 있는 문자열이다. 모양이 틀린 값은 없는 것으로 본다(신호는 버리지 않는다).
function textAt(
  paths: readonly string[],
  payload: Record<string, unknown>,
): string | undefined {
  for (const path of paths) {
    let value: unknown = payload;
    for (const key of path.split(".")) {
      value = isRecord(value) ? value[key] : undefined;
    }
    const text = textOf(value);
    if (text !== null && text !== INVALID && text !== "") return text;
  }
  return undefined;
}

export function hookSignalOf(
  harness: HarnessId,
  event: string,
  payload: unknown,
): HookSignal | null {
  const base = HARNESS_ADAPTERS[harness].events[event];
  if (base === undefined || !isRecord(payload)) return null;
  const signal = signalOf(harness, base, event, payload);
  if (signal === null) return null;
  // /clear나 resume으로 session이 바뀌는 것은 어느 event에서든 알 수 있어 모든 신호에서 읽는다. 이름도 같다.
  const { id, name } = HARNESS_ADAPTERS[harness].session;
  const external_session = textAt(id, payload);
  const sessionName = textAt(name, payload);
  return {
    ...signal,
    ...(external_session === undefined ? {} : { external_session }),
    ...(sessionName === undefined ? {} : { name: sessionName }),
  };
}

function signalOf(
  harness: HarnessId,
  base: SignalType,
  event: string,
  payload: Record<string, unknown>,
): HookSignal | null {
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

// `type: "agent"` hook이 내는 tool hook은 SubagentStop을 내지 않아 child로 세면 끝나지 않는다(Orca claude-events.ts:183-186).
const HOOK_AGENT_ID_PREFIX = "hook-agent-";

function agentIdOf(payload: Record<string, unknown>): string | undefined {
  const id = payload.agent_id;
  return typeof id === "string" &&
    id !== "" &&
    !id.startsWith(HOOK_AGENT_ID_PREFIX)
    ? id
    : undefined;
}

// payload는 hook이 stdin으로 준 JSON이다.
function commandHookSignal(
  harness: HarnessId,
  type: SignalType,
  event: string,
  payload: Record<string, unknown>,
): HookSignal | null {
  if (type === "ChildStarted" || type === "ChildEnded") {
    const child = agentIdOf(payload);
    return child === undefined ? null : { type, child };
  }
  // 하위 agent의 tool hook은 Start를 놓쳤어도 그 child가 살아 있다는 뜻이다. SubagentStop이 없는 harness는 끝을 몰라 child가
  // 남아 버리므로 이 길은 ChildEnded를 매핑한 harness만 쓴다.
  if (event === "PostToolUse" || event === "PostToolUseFailure") {
    const child = agentIdOf(payload);
    if (
      child !== undefined &&
      Object.values(HARNESS_ADAPTERS[harness].events).includes("ChildEnded")
    ) {
      return { type: "ChildStarted", child };
    }
  }
  if (isSubagent(harness, type, payload)) return null;
  // compact로 시작한 SessionStart와 clear로 끝난 SessionEnd는 session 경계가 아니다.
  if (event === "SessionStart" && payload.source === "compact") return null;
  if (event === "SessionEnd" && payload.reason === "clear") return null;
  switch (type) {
    case "TurnStarted": {
      // letta의 slash command는 model turn이 아니다.
      if (payload.is_command === true) return null;
      // sidebar 제목으로 쓰는 한 줄이라 첫 줄만 둔다.
      const prompt = summaryOf(
        typeof payload.prompt === "string"
          ? payload.prompt.trimStart().split("\n")[0]
          : undefined,
      );
      return prompt === null ? { type } : { type, prompt };
    }
    case "TurnEnded": {
      const outcome = turnOutcome(harness, event, payload);
      if (outcome === null) return null;
      const message = turnMessage(harness, payload);
      const children = liveChildren(payload);
      return {
        type,
        outcome,
        ...(message === null ? {} : { message }),
        ...(children.length === 0 ? {} : { children }),
      };
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

// OpenCode 계열 plugin의 payload는 `{type, properties}`다. 하위 session의 status는 plugin이 `lophn_child`를 달아 넘기고, 나머지 event는 root의 것만 온다.
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
      // plugin이 하위 session의 상태에 `lophn_child`(그 session id)를 달고 sessionID는 root로 바꿔 넘긴다.
      const child = properties.lophn_child;
      if (typeof child === "string" && child !== "") {
        if (status === "busy" || status === "retry") {
          return { type: "ChildStarted", child };
        }
        return status === "idle" ? { type: "ChildEnded", child } : null;
      }
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
      return payload.reason === "reload" ? null : { type };
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
      return { type };
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
      return { type };
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
