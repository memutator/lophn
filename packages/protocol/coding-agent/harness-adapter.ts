// harness adapter의 순수 값이다. 제품별 실행 파일 이름, probe, 첫 prompt 전달 방법,
// skill·hook 위치, turn 끝 신호를 표로 둔다. IO는 없다. 감지·설치·실행은 이 표를 읽는 쪽이 한다.
import type { HarnessId } from "./harnesses.ts";
import { HOOK_EVENT_TABLE } from "./hook-signal.ts";

// foreground process argv에서 harness를 알아보는 규칙이다(`harnessOfProcess`). `commands`도 정확한 이름으로 같이 본다.
export type HarnessProcessRule = {
  // commands 밖에서 foreground로 보이는 이름이다.
  names?: readonly string[];
  // `<접두어><숫자>…` 꼴로 versioned native binary를 띄우는 launcher의 이름이다(`qodercli-1.2.3`).
  versioned?: readonly string[];
  // node·bun이 도는 script 경로에 들어 있는 package 경로 조각이다. pnpm·yarn shim은 script 이름이 `main.mjs`처럼 바뀐다.
  packages?: readonly string[];
  // python `-c <code>`의 code에 들어 있는 표지다. launcher가 code를 직접 넘기는 제품용이다.
  code?: string;
};

export type HarnessAdapter = {
  id: HarnessId;
  label: string;
  // PATH에서 찾을 실행 파일 이름이다.
  commands: readonly string[];
  process: HarnessProcessRule;
  version_probe: { argv: readonly string[] } | null;
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
  // 사람이 치면 도는 turn을 끊는 키다. 단독 키 입력을 보고 상태를 unknown으로 내린다.
  interrupt_keys: readonly ("escape" | "ctrl-c")[];
  // 사용자 home 기준 상대 위치(전역)다. lophn이 전에 skill 사본을 놓던 곳. 지운 skill의 옛 사본을 지울 때 쓴다.
  skill_dir: string | null;
};

export const HARNESS_ADAPTERS: Readonly<Record<HarnessId, HarnessAdapter>> = {
  claude: {
    id: "claude",
    label: "Claude Code",
    commands: ["claude"],
    process: {},
    version_probe: null,
    model_flag: ["--model"],
    prompt: { kind: "argv", flag: null },
    // 확인함(2.1.303): `--mcp-config <JSON>`은 variadic이라 prompt 뒤 맨 끝에 둔다. 인라인 JSON header의 `${LOPHN_CODING_TOKEN}`이 env로 풀린다.
    mcp: "argv_after_prompt",
    // 확인함: code.claude.com/docs/en/skills (~/.claude/skills), /docs/en/hooks (~/.claude/settings.json).
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: ".claude/skills",
  },
  codex: {
    id: "codex",
    label: "Codex",
    commands: ["codex"],
    process: {},
    version_probe: { argv: ["codex", "--version"] },
    model_flag: ["--model"],
    prompt: { kind: "argv", flag: null },
    // 확인함(0.161.0): 앞에 둔 `-c mcp_servers.lophn.*` override가 `codex mcp get`에 먹는다.
    mcp: "argv_before_prompt",
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: ".agents/skills",
    // 확인함: ~/.codex/hooks.json, feature flag 불필요(hook 기본 켜짐). 다만 codex는 새·바뀐 hook을
    // 사람이 /hooks에서 trust하기 전까지 건너뛴다(learn.chatgpt.com/docs/hooks). 설치가 같은 폴더의 config.toml에 trust 기록을 쓴다.
  },
  opencode: {
    id: "opencode",
    label: "OpenCode",
    commands: ["opencode", "opencode2"],
    process: {},
    version_probe: { argv: ["opencode", "--version"] },
    model_flag: ["--model"],
    prompt: { kind: "argv", flag: "--prompt" },
    // 확인함(1.18.35): `OPENCODE_CONFIG_CONTENT`의 mcp.lophn을 읽고 `{env:...}`를 header에 푼다.
    mcp: "env",
    // 확인함: opencode.ai/docs/skills (~/.config/opencode/skills).
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: ".config/opencode/skills",
    // 확인함: opencode.ai/docs/plugins (`~/.config/opencode/plugins/` 전역 plugin, 시작 때 읽힘). 파일 이름 규칙은
    // 문서에 없다(이 컴퓨터의 전역 plugins 폴더에서 다른 도구의 `*.js`가 같은 위치로 쓰이는 것을 봤다).
    // event payload는 @opencode-ai/sdk 1.18.29 types로 확인했다. plugin 실행기가 Bun인지는 확인 못함이고,
    // node:child_process만 쓴다. 2.x(2.1.4로 확인)는 default export `{id, setup}`만 읽고 event 모양이 달라 plugin이 바꿔 넘긴다.
  },
  pi: {
    id: "pi",
    label: "pi",
    commands: ["pi"],
    process: {},
    version_probe: null,
    model_flag: ["--model"],
    prompt: { kind: "argv", flag: null },
    // MCP 지원이 없다.
    mcp: null,
    // pi 문서가 지원한다고 적은 전역 위치다(pi.dev/docs/latest/skills). `~/.pi/agent/skills`는 확인 못함.
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: ".agents/skills",
    // 확인함: pi.dev/docs/latest/extensions (~/.pi/agent/extensions/*.ts).
  },
  // hermes는 turn 끝 신호가 없는 제품이다. TUI query argv 전달을 조사로 확인하지 못해
  // prompt는 null이고, 전역 skill·hook 위치도 확인하지 못했다.
  hermes: {
    id: "hermes",
    label: "Hermes",
    commands: ["hermes"],
    process: { code: "hermes_cli.main" },
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
  "omp": {
    id: "omp",
    label: "Oh My Pi",
    commands: ["omp"],
    process: {},
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
  "cursor": {
    id: "cursor",
    label: "Cursor",
    commands: ["cursor-agent"],
    process: { packages: ["cursor-agent/versions/"] },
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
  "copilot": {
    id: "copilot",
    label: "GitHub Copilot CLI",
    commands: ["copilot"],
    process: {},
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
  "kimi": {
    id: "kimi",
    label: "Kimi Code",
    commands: ["kimi", "kimi-code"],
    process: { packages: ["@moonshot-ai/kimi-code"] },
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
  "kiro": {
    id: "kiro",
    label: "Kiro CLI",
    commands: ["kiro-cli"],
    process: { names: ["kiro-cli-chat"] },
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
  "antigravity": {
    id: "antigravity",
    label: "Antigravity",
    commands: ["agy"],
    process: {},
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
  "grok": {
    id: "grok",
    label: "Grok",
    commands: ["grok"],
    process: {},
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    // Esc는 grok의 turn을 끊지 않는다. Ctrl-C가 끊는다.
    interrupt_keys: ["ctrl-c"],
    skill_dir: null,
  },
  "droid": {
    id: "droid",
    label: "Droid",
    commands: ["droid"],
    process: {},
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
  "amp": {
    id: "amp",
    label: "Amp",
    commands: ["amp"],
    process: {},
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
  "devin": {
    id: "devin",
    label: "Devin",
    commands: ["devin"],
    process: {},
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
  "qwen": {
    id: "qwen",
    label: "Qwen Code",
    commands: ["qwen"],
    process: { packages: ["@qwen-code/qwen-code"] },
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
  "qoder": {
    id: "qoder",
    label: "Qoder CLI",
    commands: ["qodercli"],
    process: { versioned: ["qodercli-"] },
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
  "muse": {
    id: "muse",
    label: "Muse",
    commands: ["muse"],
    process: { versioned: ["muse-bin-"] },
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
  "codebuddy": {
    id: "codebuddy",
    label: "CodeBuddy Code",
    commands: ["codebuddy", "cbc"],
    process: { packages: ["@tencent-ai/codebuddy-code"] },
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
  "command-code": {
    id: "command-code",
    label: "Command Code",
    commands: ["command-code", "commandcode"],
    process: {},
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
  "prime-agent": {
    id: "prime-agent",
    label: "Prime Agent",
    commands: ["prime-agent"],
    process: {},
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
  "mimocode": {
    id: "mimocode",
    label: "MiMo Code",
    commands: ["mimo"],
    process: {},
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
  "cline": {
    id: "cline",
    label: "Cline",
    commands: ["cline"],
    process: {},
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
  "letta": {
    id: "letta",
    label: "Letta Code",
    commands: ["letta"],
    process: { packages: ["@letta-ai/letta-code"] },
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
  "kilo": {
    id: "kilo",
    label: "Kilo Code CLI",
    commands: ["kilo", "kilocode"],
    process: {},
    version_probe: null,
    model_flag: null,
    prompt: null,
    mcp: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
  },
};

// turn 끝을 알리는 hook event가 있어야 메시지를 넣는다. pi는 `agent_end` 뒤에 retry·compaction·이어하기가
// 남을 수 있어 끝이 확정되는 `agent_settled`를 쓴다.
export function canDeliverMessages(id: HarnessId): boolean {
  return Object.values(HOOK_EVENT_TABLE[id]).includes("TurnEnded");
}

export function canLaunch(id: HarnessId): boolean {
  return HARNESS_ADAPTERS[id].prompt !== null;
}
