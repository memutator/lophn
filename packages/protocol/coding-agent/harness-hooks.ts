// harness마다 lophn hook을 어디에 어떤 꼴로 놓는지, hook이 stdout에 써야 하는 것이다. 순수 값이고 IO는 없다.
// 설치(`packages/coding-agent/harnesses`)와 shell main(설치를 물을지), launcher가 읽는다.
// 듣는 event 이름은 `HOOK_EVENT_TABLE`이 정본이고 설치는 그 key를 그대로 놓는다.
// null이면 hook을 놓지 않는 harness다(foreground icon만).
import type { HarnessId } from "./harness-id.ts";

// 경로는 모두 사용자 home 기준 상대 위치(전역)다.
export type HarnessHook =
  // JSON 설정. shape이 event 항목의 꼴이다.
  //   nested: `hooks[event] = [{matcher?, hooks:[{type, command, timeout?}]}]` (Claude 꼴)
  //   flat: `{version: 1, hooks: {event: [{type, command, timeout}]}}` (Cursor)
  //   copilot: flat과 같지만 항목이 `{type, bash, timeoutSec}`
  //   kiro: `{version: "v1", hooks: [{name, trigger, action:{type, command}, timeout}]}`
  //   named: `{lophn: {event: [handler]}}` (Antigravity, PreToolUse·PostToolUse만 nested)
  // `path`가 lophn 전용 file이든 사람의 설정이든 같은 방식으로 우리 항목만 고친다.
  | {
    format: "json";
    path: string;
    shape: "nested" | "flat" | "copilot" | "kiro" | "named";
    timeout?: number;
    // event → matcher. 값이 ""여도 matcher 칸을 쓴다.
    matchers?: Readonly<Record<string, string>>;
  }
  // Claude 꼴이고 JSONC다. 주석과 우리 항목 밖의 byte를 그대로 둔다(Devin).
  | { format: "jsonc"; path: string }
  // 표시한 block을 끝에 두는 TOML(Kimi). `[[hooks]]` 항목.
  | {
    format: "toml_block";
    path: string;
    timeout: number;
    matchers?: Readonly<Record<string, string>>;
  }
  // Muse: hook을 정의한 managed file(`path`)과 그 file을 가리키고 env 이름을 허용하는 `settings`.
  | { format: "managed_json"; path: string; settings: string; timeout: number }
  // Hermes: `path`(config.yaml)의 `hooks:`에 shell hook, `allowlist`에 trust 기록.
  | { format: "yaml_hooks"; path: string; allowlist: string; timeout: number }
  // Cline: event마다 실행 파일 하나(`path` 폴더 아래, 이름이 event).
  | { format: "script_dir"; path: string }
  // 우리 파일 하나다. 본문은 harness가 고른다.
  | { format: "plugin_file"; path: string };

const CLAUDE_SHAPED = { format: "json", shape: "nested", timeout: 10 } as const;

export const HARNESS_HOOKS: Readonly<Record<HarnessId, HarnessHook | null>> = {
  claude: {
    format: "json",
    shape: "nested",
    path: ".claude/settings.json",
    matchers: { PreToolUse: "AskUserQuestion" },
  },
  codex: {
    format: "json",
    shape: "nested",
    path: ".codex/hooks.json",
    matchers: { PreToolUse: "request_user_input" },
  },
  opencode: {
    format: "plugin_file",
    path: ".config/opencode/plugins/lophn-status.ts",
  },
  kilo: {
    format: "plugin_file",
    path: ".config/kilo/plugin/lophn-status.ts",
  },
  mimocode: {
    format: "plugin_file",
    path: ".config/mimocode/plugins/lophn-status.ts",
  },
  pi: { format: "plugin_file", path: ".pi/agent/extensions/lophn-status.ts" },
  omp: { format: "plugin_file", path: ".omp/agent/extensions/lophn-status.ts" },
  amp: { format: "plugin_file", path: ".config/amp/plugins/lophn-status.ts" },
  cursor: {
    format: "json",
    shape: "flat",
    path: ".cursor/hooks.json",
    timeout: 10,
  },
  copilot: {
    format: "json",
    shape: "copilot",
    path: ".copilot/hooks/lophn.json",
    timeout: 10,
  },
  kimi: {
    format: "toml_block",
    path: ".kimi-code/config.toml",
    timeout: 10,
    matchers: { PreToolUse: "^AskUserQuestion$" },
  },
  kiro: {
    format: "json",
    shape: "kiro",
    path: ".kiro/hooks/lophn.json",
    timeout: 10,
  },
  antigravity: {
    format: "json",
    shape: "named",
    path: ".gemini/config/hooks.json",
    timeout: 10,
  },
  grok: { ...CLAUDE_SHAPED, path: ".grok/hooks/lophn.json" },
  droid: {
    format: "json",
    shape: "nested",
    path: ".factory/settings.json",
  },
  devin: { format: "jsonc", path: ".config/devin/config.json" },
  qwen: { ...CLAUDE_SHAPED, path: ".qwen/settings.json" },
  qoder: { ...CLAUDE_SHAPED, path: ".qoder/settings.json" },
  hermes: {
    format: "yaml_hooks",
    path: ".hermes/config.yaml",
    allowlist: ".hermes/shell-hooks-allowlist.json",
    timeout: 10,
  },
  muse: {
    format: "managed_json",
    path: ".config/muse/lophn-hooks.json",
    settings: ".config/muse/settings.json",
    timeout: 10,
  },
  codebuddy: { ...CLAUDE_SHAPED, path: ".codebuddy/settings.json" },
  "command-code": {
    ...CLAUDE_SHAPED,
    path: ".commandcode/settings.json",
    matchers: { PreToolUse: "shell|read|write|edit" },
  },
  "prime-agent": null,
  cline: { format: "script_dir", path: ".cline/hooks" },
  letta: {
    format: "json",
    shape: "nested",
    path: ".letta/settings.json",
    // timeout이 ms다.
    timeout: 10_000,
    // tool event는 matcher 칸이 있어야 불린다.
    matchers: {
      PreToolUse: "",
      PermissionRequest: "",
      PostToolUse: "",
      PostToolUseFailure: "",
    },
  },
};

function parentOf(path: string): string {
  return path.slice(0, path.lastIndexOf("/"));
}

// `harness install`이 읽고 쓰는 위치(home 기준)다. file이 놓일 폴더를 준다(처음이면 폴더도 만든다).
// Hermes만 폴더(`.hermes`에는 session과 db가 있다) 대신 건드리는 file 둘을 준다.
export function hookPaths(hook: HarnessHook): string[] {
  switch (hook.format) {
    case "yaml_hooks":
      return [hook.path, hook.allowlist];
    case "script_dir":
      return [hook.path];
    default:
      return [parentOf(hook.path)];
  }
}

// hook이 stdout에 써야 하는 것이다. 없는 harness·event는 아무것도 쓰지 않는다. event `*`는 나머지 전부다.
// Antigravity는 JSON 객체가 없으면, Cursor는 `beforeSubmitPrompt`에 `continue`가 없으면 막는다.
// 그 밖의 harness는 stdout이 model context로 들어갈 수 있어 쓰지 않는다.
export const HOOK_STDOUT: readonly {
  harness: HarnessId;
  event: string;
  stdout: string;
}[] = [
  { harness: "antigravity", event: "Stop", stdout: '{"decision":"stop"}' },
  { harness: "antigravity", event: "*", stdout: "{}" },
  {
    harness: "cursor",
    event: "beforeSubmitPrompt",
    stdout: '{"continue":true}',
  },
  { harness: "cursor", event: "*", stdout: "{}" },
];

export function hookStdout(harness: string, event: string): string | null {
  const rows = HOOK_STDOUT.filter((row) => row.harness === harness);
  return (rows.find((row) => row.event === event) ??
    rows.find((row) => row.event === "*"))?.stdout ?? null;
}
