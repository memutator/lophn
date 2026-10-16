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
  // 앱 source 폴더 기준 상대 위치다. skill을 놓는 곳이고 확인한 제품만 적는다.
  skill_dir: string | null;
  // 앱 source 폴더 안 project 설정만이다(사용자 전역 금지). 확인한 제품만 적는다.
  hook: {
    path: string;
    format: "json" | "toml" | "plugin_file";
  } | null;
};

export const CODING_SKILL_NAMES = ["lophn-build-app", "lophn-repair"] as const;

export const HARNESS_ADAPTERS: Readonly<Record<HarnessId, HarnessAdapter>> = {
  claude: {
    id: "claude",
    label: "Claude Code",
    commands: ["claude"],
    version_probe: null,
    login_probe: null,
    model_flag: ["--model"],
    prompt: { kind: "argv", flag: null },
    skill_dir: ".claude/skills",
    hook: { path: ".claude/settings.local.json", format: "json" },
  },
  codex: {
    id: "codex",
    label: "Codex",
    commands: ["codex"],
    version_probe: { argv: ["codex", "--version"] },
    login_probe: { argv: ["codex", "login", "status"] },
    model_flag: ["--model"],
    prompt: { kind: "argv", flag: null },
    skill_dir: ".agents/skills",
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
    skill_dir: ".opencode/skills",
    // project plugin 위치를 조사로 확인하지 못했다.
    hook: null,
  },
  gemini: {
    id: "gemini",
    label: "Gemini CLI",
    commands: ["gemini"],
    version_probe: null,
    login_probe: null,
    model_flag: ["--model"],
    prompt: { kind: "argv", flag: "--prompt-interactive" },
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
    skill_dir: ".pi/skills",
    // project `.pi/`의 extensions는 project trust 뒤에 읽힌다.
    hook: { path: ".pi/extensions/lophn-status.ts", format: "plugin_file" },
  },
  // hermes와 openclaw는 turn 끝 신호가 없는 제품이다. TUI query argv 전달을 조사로 확인하지 못해
  // prompt는 null이고, project skill·hook 위치도 확인하지 못했다.
  hermes: {
    id: "hermes",
    label: "Hermes",
    commands: ["hermes"],
    version_probe: null,
    login_probe: null,
    model_flag: null,
    prompt: null,
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
