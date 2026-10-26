// Codex가 hook의 trust 기록(`config.toml`의 `[hooks.state."<key>"] trusted_hash`)에 쓰는 hash를 그대로 만든다.
// 원본은 codex-rs(rust-v0.164.0)의 `hooks/src/engine/discovery.rs` `hook_hash`와 `config/src/fingerprint.rs`
// `version_for_toml`이다. 한 hook(group 하나에 handler 하나로 정규화한 것)을 key를 정렬한 compact JSON으로 만들어
// sha256한다. Codex의 serde가 None 필드를 빼므로 없는 값은 key째 뺀다.

type Group = { matcher?: unknown };
type Handler = {
  command: string;
  timeout?: unknown;
  async?: unknown;
  statusMessage?: unknown;
};

// matcher를 읽는 event만 hash에 matcher가 들어간다(`matcher_pattern_for_event`). 나머지는 group에 있어도 버린다.
const MATCHER_EVENTS = new Set([
  "PreToolUse",
  "PermissionRequest",
  "PostToolUse",
  "SessionStart",
  "SessionEnd",
  "SubagentStart",
  "SubagentStop",
  "PreCompact",
  "PostCompact",
]);

// `hook_event_key_label`: `PostToolUse` -> `post_tool_use`.
function eventLabel(event: string): string {
  return event.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
}

// timeout을 안 쓴 hook은 Codex가 기본값을 채운 뒤 hash한다(`normalize_command_hook`).
function normalizedTimeout(event: string, timeout: unknown): number {
  if (event === "SessionEnd" || event === "Interrupt") {
    return Math.min(3, Math.max(1, typeof timeout === "number" ? timeout : 1));
  }
  return Math.max(1, typeof timeout === "number" ? timeout : 600);
}

// trust 기록의 table key다(`hook_key`). `hooksPath`는 Codex가 읽는 hooks.json 절대 경로다.
export function codexHookKey(
  hooksPath: string,
  event: string,
  groupIndex: number,
  handlerIndex: number,
): string {
  return `${hooksPath}:${eventLabel(event)}:${groupIndex}:${handlerIndex}`;
}

export async function codexHookHash(
  event: string,
  group: Group,
  handler: Handler,
): Promise<string> {
  // key를 알파벳 순으로 적어 둔다(`json.sort_all_objects()`와 같은 순서).
  const hook = {
    async: handler.async === true,
    command: handler.command,
    ...(typeof handler.statusMessage === "string"
      ? { statusMessage: handler.statusMessage }
      : {}),
    timeout: normalizedTimeout(event, handler.timeout),
    type: "command",
  };
  const identity = {
    event_name: eventLabel(event),
    hooks: [hook],
    ...(MATCHER_EVENTS.has(event) && typeof group.matcher === "string"
      ? { matcher: group.matcher }
      : {}),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(identity));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return `sha256:${
    Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")
  }`;
}
