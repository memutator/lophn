// command hook을 주는 제품(Claude Code·Codex·Gemini CLI)의 normalizer다.
// payload는 제품이 stdin으로 준 hook JSON이고 `hook_event_name`·`session_id`·`transcript_path`·`cwd`를 읽는다.
// 표에 없는 event는 상태 evidence가 아니라 null이다. Stop·AfterAgent는 turn 끝이라 ready이고 ended가 아니다.
// ended는 SessionEnd뿐이며 `clear`는 같은 process의 session 교체라 ended가 아니다.
import { cwdOf, type Evidence, type Normalizer, textOf } from "./model.ts";
import type { SessionState } from "../../../protocol/coding-agent/mod.ts";

type Table = Readonly<Record<string, SessionState>>;

function hookNormalizer(
  harness: string,
  kind: string,
  table: Table,
  special: (
    event: string,
    payload: Record<string, unknown>,
  ) => SessionState | null | undefined,
): Normalizer {
  return (payload) => {
    const event = textOf(payload.hook_event_name);
    // subagent의 event는 main session의 상태가 아니다.
    if (event === null || payload.agent_id !== undefined) return null;
    const override = special(event, payload);
    if (override === null) return null;
    const state = override ?? table[event];
    if (state === undefined) return null;
    const id = textOf(payload.session_id);
    const evidence: Evidence = {
      state,
      source: "hook",
      // Notification은 ToolPermission만 여기까지 온다.
      ref: event === "Notification"
        ? `${harness}:Notification:ToolPermission`
        : `${harness}:${event}`,
      session: id === null ? null : {
        kind,
        id,
        transcriptPath: textOf(payload.transcript_path),
      },
      cwd: cwdOf(payload.cwd),
      reason: null,
    };
    return evidence;
  };
}

// compact로 시작한 SessionStart와 clear로 끝난 SessionEnd는 session 경계가 아니다.
function boundary(
  event: string,
  payload: Record<string, unknown>,
): null | undefined {
  if (event === "SessionStart" && payload.source === "compact") return null;
  if (event === "SessionEnd" && payload.reason === "clear") return null;
  return undefined;
}

// Claude Notification의 정확한 schema는 배포 version에서 확인하지 못해 표에 없다.
export const normalizeClaude: Normalizer = hookNormalizer(
  "claude",
  "claude_code",
  {
    SessionStart: "ready",
    UserPromptSubmit: "working",
    PostToolUse: "working",
    PostCompact: "working",
    PermissionRequest: "waiting_input",
    Stop: "ready",
    SessionEnd: "ended",
  },
  boundary,
);

export const normalizeCodex: Normalizer = hookNormalizer(
  "codex",
  "codex",
  {
    SessionStart: "ready",
    UserPromptSubmit: "working",
    PostToolUse: "working",
    PermissionRequest: "waiting_input",
    Stop: "ready",
  },
  boundary,
);

// Before/AfterAgent·Tool만으로 permission 대기를 추정하지 않는다. 정확한 대기 evidence는
// `Notification`의 `notification_type=ToolPermission`뿐이고 다른 notification은 상태가 아니다.
export const normalizeGemini: Normalizer = hookNormalizer(
  "gemini",
  "gemini_cli",
  {
    SessionStart: "ready",
    BeforeAgent: "working",
    BeforeTool: "working",
    AfterTool: "working",
    AfterAgent: "ready",
    SessionEnd: "ended",
  },
  (event, payload) => {
    if (event === "Notification") {
      return payload.notification_type === "ToolPermission"
        ? "waiting_input"
        : null;
    }
    return boundary(event, payload);
  },
);
