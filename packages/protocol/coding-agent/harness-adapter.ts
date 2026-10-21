// harness adapter의 순수 값이다. 제품별 실행 파일 이름, probe, 첫 prompt 전달 방법,
// skill·hook 위치, turn 끝 신호를 표로 둔다. IO는 없다. 감지·설치·실행은 이 표를 읽는 쪽이 한다.
import type { HarnessId } from "./harnesses.ts";

export type HarnessAdapter = {
  id: HarnessId;
  label: string;
  // PATH에서 찾을 실행 파일 이름이다.
  commands: readonly string[];
  version_probe: { argv: readonly string[] } | null;
  // 없으면 로그인은 "확인 못함"이다.
  login_probe: { argv: readonly string[] } | null;
  // 실행 옵션의 model을 넘기는 argv 조각이다. model 값이 이 뒤에 붙는다.
  model_flag: readonly string[] | null;
  // 첫 prompt를 넘기는 방법이다. null이면 맡길 수 없는 제품이다(Settings에 보인다).
  // 화면 출력으로 준비를 짐작하는 방법은 두지 않는다.
  prompt:
    | { kind: "argv"; flag: string | null }
    | { kind: "paste_after_hook" }
    | null;
  // lophn MCP endpoint를 session 실행 계획에만 실어 붙이는 방법이다(`withCodingMcp`). 사람의 전역 설정은 쓰지 않는다.
  // null이면 붙이지 않는다.
  mcp: "argv_after_prompt" | "argv_before_prompt" | "env" | null;
  // 사용자 home 기준 상대 위치(전역)다. skill을 놓는 곳이고 확인한 제품만 적는다.
  skill_dir: string | null;
  // 사용자 home 기준 상대 위치(전역)다. 확인한 제품만 적는다.
  hook: {
    path: string;
    format: "json" | "plugin_file";
  } | null;
};

export const CODING_SKILL_NAMES = ["lophn-build-app"] as const;

export const HARNESS_ADAPTERS: Readonly<Record<HarnessId, HarnessAdapter>> = {
  claude: {
    id: "claude",
    label: "Claude Code",
    commands: ["claude"],
    version_probe: null,
    login_probe: null,
    model_flag: ["--model"],
    prompt: { kind: "argv", flag: null },
    // 확인함(2.1.303): `--mcp-config <JSON>`은 variadic이라 prompt 뒤 맨 끝에 둔다. 인라인 JSON header의 `${LOPHN_CODING_TOKEN}`이 env로 풀린다.
    mcp: "argv_after_prompt",
    // 확인함: code.claude.com/docs/en/skills (~/.claude/skills), /docs/en/hooks (~/.claude/settings.json).
    skill_dir: ".claude/skills",
    hook: { path: ".claude/settings.json", format: "json" },
  },
  codex: {
    id: "codex",
    label: "Codex",
    commands: ["codex"],
    version_probe: { argv: ["codex", "--version"] },
    login_probe: { argv: ["codex", "login", "status"] },
    model_flag: ["--model"],
    prompt: { kind: "argv", flag: null },
    // 확인함(0.161.0): 앞에 둔 `-c mcp_servers.lophn.*` override가 `codex mcp get`에 먹는다.
    mcp: "argv_before_prompt",
    skill_dir: ".agents/skills",
    // 확인함: ~/.codex/hooks.json, feature flag 불필요(hook 기본 켜짐). 다만 codex는 새·바뀐 hook을
    // 사람이 /hooks에서 trust하기 전까지 건너뛴다(learn.chatgpt.com/docs/hooks). trust는 쓰지 않는다.
    hook: { path: ".codex/hooks.json", format: "json" },
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    commands: ["opencode", "opencode2"],
    version_probe: { argv: ["opencode", "--version"] },
    login_probe: null,
    model_flag: ["--model"],
    prompt: { kind: "argv", flag: "--prompt" },
    // 확인함(1.18.35): `OPENCODE_CONFIG_CONTENT`의 mcp.lophn을 읽고 `{env:...}`를 header에 푼다.
    mcp: "env",
    // 확인함: opencode.ai/docs/skills (~/.config/opencode/skills).
    skill_dir: ".config/opencode/skills",
    // 확인함: opencode.ai/docs/plugins (`~/.config/opencode/plugins/` 전역 plugin, 시작 때 읽힘). 파일 이름 규칙은
    // 문서에 없다(이 컴퓨터의 전역 plugins 폴더에서 다른 도구의 `*.js`가 같은 위치로 쓰이는 것을 봤다).
    // event payload는 @opencode-ai/sdk 1.18.29 types로 확인했다. plugin 실행기가 Bun인지는 확인 못함이고,
    // node:child_process만 쓴다.
    hook: {
      path: ".config/opencode/plugins/lophn-status.ts",
      format: "plugin_file",
    },
  },
  gemini: {
    id: "gemini",
    label: "Gemini CLI",
    commands: ["gemini"],
    version_probe: null,
    login_probe: null,
    model_flag: ["--model"],
    prompt: { kind: "argv", flag: "--prompt-interactive" },
    // MCP는 settings.json에서만 정한다(per-session flag·env를 확인 못함).
    mcp: null,
    // 확인함: geminicli.com/docs/cli/skills (~/.gemini/skills), geminicli.com/docs/hooks (~/.gemini/settings.json).
    skill_dir: ".gemini/skills",
    hook: { path: ".gemini/settings.json", format: "json" },
  },
  pi: {
    id: "pi",
    label: "pi",
    commands: ["pi"],
    version_probe: null,
    login_probe: null,
    model_flag: ["--model"],
    prompt: { kind: "argv", flag: null },
    // MCP 지원이 없다.
    mcp: null,
    // pi 문서가 지원한다고 적은 전역 위치다(pi.dev/docs/latest/skills). `~/.pi/agent/skills`는 확인 못함.
    skill_dir: ".agents/skills",
    // 확인함: pi.dev/docs/latest/extensions (~/.pi/agent/extensions/*.ts).
    hook: {
      path: ".pi/agent/extensions/lophn-status.ts",
      format: "plugin_file",
    },
  },
  // hermes와 openclaw는 turn 끝 신호가 없는 제품이다. TUI query argv 전달을 조사로 확인하지 못해
  // prompt는 null이고, 전역 skill·hook 위치도 확인하지 못했다.
  hermes: {
    id: "hermes",
    label: "Hermes",
    commands: ["hermes"],
    version_probe: null,
    login_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    skill_dir: null,
    hook: null,
  },
  openclaw: {
    id: "openclaw",
    label: "OpenClaw",
    commands: ["openclaw"],
    version_probe: null,
    login_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    skill_dir: null,
    hook: null,
  },
};

// turn 끝 신호 표다. null이면 turn 끝을 알리지 못해 메시지를 넣지 않는다.
// pi는 `agent_end` 뒤에 retry·compaction·이어하기가 남을 수 있어 끝이 확정되는 `agent_settled`를 쓴다.
const TURN_END_SIGNALS: Readonly<Record<HarnessId, string | null>> = {
  claude: "Stop",
  codex: "Stop",
  gemini: "AfterAgent",
  opencode: "session.status idle",
  pi: "agent_settled",
  hermes: null,
  openclaw: null,
};

export function canDeliverMessages(id: HarnessId): boolean {
  return TURN_END_SIGNALS[id] !== null;
}

export function canLaunch(id: HarnessId): boolean {
  return HARNESS_ADAPTERS[id].prompt !== null;
}
