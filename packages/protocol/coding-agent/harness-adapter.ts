// harness adapter의 순수 값이다. harness 하나의 통합 규칙(실행 파일 이름, probe, skill·hook 위치, hook event → 신호,
// hook stdout, session id 위치, resume 인자)을 `HARNESS_ADAPTERS[id]` 한 곳에 둔다. IO는 없다.
// 감지·설치·실행·신호 해석은 이 표를 읽는 쪽이 한다.

import type { HarnessId } from "./harness-id.ts";
import {
  claudeHeadless,
  codexHeadless,
  type HeadlessSpec,
  opencodeHeadless,
} from "./headless/mod.ts";
import type { HookSignal } from "./hook-signal.ts";

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

// 같은 event 이름 표를 OpenCode 계열 셋이 나눠 쓴다.
const OPENCODE_EVENTS = {
  "session.status": "TurnEnded",
  "session.updated": "SessionNamed",
  "permission.asked": "PermissionRequested",
  "permission.replied": "PermissionResolved",
  "question.asked": "PermissionRequested",
  "question.replied": "PermissionResolved",
  "question.rejected": "PermissionResolved",
} as const;

// Claude 꼴(SessionStart·UserPromptSubmit·Stop·StopFailure·PermissionRequest·PostToolUse(Failure)·SessionEnd·SubagentStart·SubagentStop)이다.
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
  // 확인함: Claude는 Code CLI 2.1.316 bundle의 hook schema, qwen은 qwenlm.github.io/qwen-code-docs/en/users/features/hooks,
  // qoder는 docs.qoder.com/cli/hooks. 셋 다 payload에 agent_id가 있는 SubagentStart·SubagentStop을 둔다.
  SubagentStart: "ChildStarted",
  SubagentStop: "ChildEnded",
} as const;

// Claude 꼴 JSON 설정이다(`path`만 harness마다 다르다).
const CLAUDE_HOOK = { format: "json", shape: "nested", timeout: 10 } as const;

export type HarnessAdapter = {
  id: HarnessId;
  label: string;
  // PATH에서 찾을 실행 파일 이름이다.
  commands: readonly string[];
  process: HarnessProcessRule;
  version_probe: { argv: readonly string[] } | null;
  // lophn agent로 돌릴 때 쓰는 headless 명령, 권한 표, 출력 parser다. 없으면 shell host가 띄우지 않는다.
  headless?: HeadlessSpec;
  // 도는 turn을 끊는 키다. 단독 키 입력을 보고 상태를 unknown으로 내린다. 중단을 hook으로 알리는 harness는 비운다.
  // 이 키는 입력 지우기나 팝업 닫기에도 쓰여, turn이 도는데 상태만 unknown으로 내려가고 다음 turn까지 못 돌아온다.
  interrupt_keys: readonly ("escape" | "ctrl-c")[];
  // 사용자 home 기준 상대 위치(전역)다. lophn이 전에 skill 사본을 놓던 곳. 지운 skill의 옛 사본을 지울 때 쓴다.
  skill_dir: string | null;
  // lophn hook을 놓는 곳과 꼴이다. null이면 hook을 놓지 않는다(foreground icon만).
  hook: HarnessHook | null;
  // harness event 이름 → 신호다. 표에 없는 이름은 신호가 아니다. 이름은 harness가 내는 그대로다(대소문자 포함).
  // json·toml·script·hermes 형식은 설치가 이 표의 key를 그대로 hook event로 놓는다. 그래서 여기에는 매핑하는 event만 둔다.
  // plugin·extension 형식은 plugin 본문이 이 이름으로 hook을 부른다.
  // PostToolUse·permission.replied는 tool이 실행됐거나 답이 왔다는 뜻이라 PermissionResolved다(대기 중이 아니면 core가 무시한다).
  // 같은 이름이 payload로 갈리는 것은 hookSignalOf가 가른다(opencode `session.status`, droid `Notification`, grok `Stop`).
  // hook이 없는 harness는 비어 있다.
  events: Readonly<Record<string, HookSignal["type"]>>;
  // hook이 stdout에 써야 하는 것이다. key는 event 이름이고 `*`는 나머지 전부다. 비어 있으면 아무것도 쓰지 않는다.
  // Antigravity는 JSON 객체가 없으면, Cursor는 `beforeSubmitPrompt`에 `continue`가 없으면 막는다.
  // 그 밖의 harness는 stdout이 model context로 들어갈 수 있어 쓰지 않는다.
  stdout: Readonly<Record<string, string>>;
  session: {
    // session id가 있는 hook payload 경로다. 중첩은 `.`로 잇는다(`properties.sessionID`). 어느 event에서든 읽는다.
    // 비어 있으면 hook이 id를 주지 않는다.
    id: readonly string[];
    // harness가 정한 session 이름이 있는 hook payload 경로다(`id`와 같은 방식). 비어 있으면 payload에 이름이 없다.
    name: readonly string[];
    // 저장한 session을 다시 여는 인자다. command(`commands[0]`) 뒤에 붙이고 `{id}`를 session id로 바꾼다. 모르면 null이다.
    resume: readonly string[] | null;
    // TUI를 첫 prompt와 함께 띄우는 인자다. command 뒤에 붙이고 `{prompt}`를 prompt로 바꾼다(handoff). 없으면 handoff 대상이 아니다.
    prompt?: readonly string[];
  };
};

// agent runtime(`claude-code`·`codex`·`opencode`) → `HARNESS_ADAPTERS`의 id. harness agent를 그 CLI로 직접 열 때(TUI) 쓴다.
export const HARNESS_ADAPTER_OF_RUNTIME = {
  "claude-code": "claude",
  codex: "codex",
  opencode: "opencode",
} as const satisfies Readonly<Record<string, HarnessId>>;

export const HARNESS_ADAPTERS: Readonly<Record<HarnessId, HarnessAdapter>> = {
  claude: {
    id: "claude",
    headless: claudeHeadless,
    label: "Claude Code",
    commands: ["claude"],
    process: {},
    version_probe: null,
    // 확인함: code.claude.com/docs/en/skills (~/.claude/skills), /docs/en/hooks (~/.claude/settings.json).
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: ".claude/skills",
    hook: {
      format: "json",
      shape: "nested",
      path: ".claude/settings.json",
      matchers: { PreToolUse: "AskUserQuestion" },
    },
    events: {
      ...CLAUDE_SHAPED,
      // 수동 /compact는 UserPromptSubmit만 내고 Stop을 내지 않는다.
      PostCompact: "TurnEnded",
      // AskUserQuestion은 PreToolUse에서 막힌다. 설치는 이 matcher만 건다.
      PreToolUse: "PermissionRequested",
    },
    stdout: {},
    session: {
      id: ["session_id"],
      // SessionStart·UserPromptSubmit payload의 custom title. 생성된 제목은 오지 않는다.
      name: ["session_title"],
      // 확인함: claude --help
      resume: ["--resume", "{id}"],
      // 확인함: claude --help (`claude [options] [prompt]`)
      prompt: ["{prompt}"],
    },
  },
  codex: {
    id: "codex",
    headless: codexHeadless,
    label: "Codex",
    commands: ["codex"],
    process: {},
    version_probe: { argv: ["codex", "--version"] },
    interrupt_keys: [],
    skill_dir: ".agents/skills",
    // 확인함: ~/.codex/hooks.json, feature flag 불필요(hook 기본 켜짐). 다만 codex는 새·바뀐 hook을
    // 사람이 /hooks에서 trust하기 전까지 건너뛴다(learn.chatgpt.com/docs/hooks). 설치가 같은 폴더의 config.toml에 trust 기록을 쓴다.
    hook: {
      format: "json",
      shape: "nested",
      path: ".codex/hooks.json",
      matchers: { PreToolUse: "request_user_input" },
    },
    events: {
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
    stdout: {},
    session: {
      id: ["session_id"],
      name: [],
      // 확인함: codex --help
      resume: ["resume", "{id}"],
      // 확인함: codex --help (`codex [OPTIONS] [PROMPT]`)
      prompt: ["{prompt}"],
    },
  },
  opencode: {
    id: "opencode",
    headless: opencodeHeadless,
    label: "OpenCode",
    commands: ["opencode", "opencode2"],
    process: {},
    version_probe: { argv: ["opencode", "--version"] },
    // 확인함: opencode.ai/docs/skills (~/.config/opencode/skills).
    interrupt_keys: [],
    skill_dir: ".config/opencode/skills",
    // 확인함: opencode.ai/docs/plugins (`~/.config/opencode/plugins/` 전역 plugin, 시작 때 읽힘). 파일 이름 규칙은
    // 문서에 없다(이 컴퓨터의 전역 plugins 폴더에서 다른 도구의 `*.js`가 같은 위치로 쓰이는 것을 봤다).
    // event payload는 @opencode-ai/sdk 1.18.29 types로 확인했다. plugin 실행기가 Bun인지는 확인 못함이고,
    // node:child_process만 쓴다. 2.x(2.1.4로 확인)는 default export `{id, setup}`만 읽고 event 모양이 달라 plugin이 바꿔 넘긴다.
    hook: {
      format: "plugin_file",
      path: ".config/opencode/plugins/lophn-status.ts",
    },
    events: OPENCODE_EVENTS,
    stdout: {},
    session: {
      id: ["properties.sessionID"],
      name: ["properties.info.title", "properties.title"],
      // 확인함: opencode --help
      resume: ["--session", "{id}"],
      // 확인함: opencode --help (2.1.4의 `--prompt`)
      prompt: ["--prompt", "{prompt}"],
    },
  },
  pi: {
    id: "pi",
    label: "pi",
    commands: ["pi"],
    process: {},
    version_probe: null,
    // pi 문서가 지원한다고 적은 전역 위치다(pi.dev/docs/latest/skills). `~/.pi/agent/skills`는 확인 못함.
    interrupt_keys: [],
    skill_dir: ".agents/skills",
    // 확인함: pi.dev/docs/latest/extensions (~/.pi/agent/extensions/*.ts).
    hook: {
      format: "plugin_file",
      path: ".pi/agent/extensions/lophn-status.ts",
    },
    events: {
      session_start: "SessionStarted",
      agent_start: "TurnStarted",
      agent_settled: "TurnEnded",
      session_shutdown: "SessionEnded",
    },
    stdout: {},
    session: {
      id: ["session_id"],
      name: ["session_name"],
      resume: null,
    },
  },
  // hermes는 turn 끝 신호가 없는 제품이다. 전역 skill·hook 위치도 확인하지 못했다.
  hermes: {
    id: "hermes",
    label: "Hermes",
    commands: ["hermes"],
    process: { code: "hermes_cli.main" },
    version_probe: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
    hook: {
      format: "yaml_hooks",
      path: ".hermes/config.yaml",
      allowlist: ".hermes/shell-hooks-allowlist.json",
      timeout: 10,
    },
    events: {
      on_session_start: "SessionStarted",
      pre_llm_call: "TurnStarted",
      // 이름과 달리 turn이 끝날 때마다 온다.
      on_session_end: "TurnEnded",
      on_human_input_request: "PermissionRequested",
      on_human_input_resolved: "PermissionResolved",
      on_session_finalize: "SessionEnded",
    },
    stdout: {},
    session: {
      id: ["session_id"],
      name: [],
      // 확인함: hermes --help
      resume: ["--resume", "{id}"],
    },
  },
  omp: {
    id: "omp",
    label: "Oh My Pi",
    commands: ["omp"],
    process: {},
    version_probe: null,
    interrupt_keys: [],
    skill_dir: null,
    hook: {
      format: "plugin_file",
      path: ".omp/agent/extensions/lophn-status.ts",
    },
    events: {
      session_start: "SessionStarted",
      session_switch: "SessionStarted",
      session_branch: "SessionStarted",
      agent_start: "TurnStarted",
      agent_end: "TurnEnded",
      tool_approval_requested: "PermissionRequested",
      tool_approval_resolved: "PermissionResolved",
    },
    stdout: {},
    session: {
      id: ["session_id"],
      name: ["session_name"],
      // 확인함: omp --help
      resume: ["--resume={id}"],
      // 확인함: omp --help (`omp [MESSAGES]`, "Interactive mode with initial prompt")
      prompt: ["{prompt}"],
    },
  },
  cursor: {
    id: "cursor",
    label: "Cursor",
    commands: ["cursor-agent"],
    process: { packages: ["cursor-agent/versions/"] },
    version_probe: null,
    interrupt_keys: [],
    skill_dir: null,
    hook: {
      format: "json",
      shape: "flat",
      path: ".cursor/hooks.json",
      timeout: 10,
    },
    events: {
      sessionStart: "SessionStarted",
      beforeSubmitPrompt: "TurnStarted",
      stop: "TurnEnded",
      sessionEnd: "SessionEnded",
    },
    stdout: { beforeSubmitPrompt: '{"continue":true}', "*": "{}" },
    session: {
      id: ["conversation_id"],
      name: [],
      // herdr agent_resume.rs 표. 여기서 실행해 보지 못함
      resume: ["--resume", "{id}"],
    },
  },
  copilot: {
    id: "copilot",
    label: "GitHub Copilot CLI",
    commands: ["copilot"],
    process: {},
    version_probe: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
    hook: {
      format: "json",
      shape: "copilot",
      path: ".copilot/hooks/lophn.json",
      timeout: 10,
    },
    events: {
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
    stdout: {},
    session: {
      id: ["session_id"],
      name: [],
      // herdr agent_resume.rs 표. 여기서 실행해 보지 못함
      resume: ["--resume={id}"],
    },
  },
  kimi: {
    id: "kimi",
    label: "Kimi Code",
    commands: ["kimi", "kimi-code"],
    process: { packages: ["@moonshot-ai/kimi-code"] },
    version_probe: null,
    interrupt_keys: [],
    skill_dir: null,
    hook: {
      format: "toml_block",
      path: ".kimi-code/config.toml",
      timeout: 10,
      matchers: { PreToolUse: "^AskUserQuestion$" },
    },
    events: {
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
    stdout: {},
    session: {
      id: ["session_id"],
      name: [],
      // herdr agent_resume.rs 표. 여기서 실행해 보지 못함
      resume: ["--session", "{id}"],
    },
  },
  kiro: {
    id: "kiro",
    label: "Kiro CLI",
    commands: ["kiro-cli"],
    process: { names: ["kiro-cli-chat"] },
    version_probe: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
    hook: {
      format: "json",
      shape: "kiro",
      path: ".kiro/hooks/lophn.json",
      timeout: 10,
    },
    events: {
      SessionStart: "SessionStarted",
      UserPromptSubmit: "TurnStarted",
      Stop: "TurnEnded",
      SessionEnd: "SessionEnded",
    },
    stdout: {},
    session: {
      id: ["session_id"],
      name: [],
      // 확인함: kiro-cli --help
      resume: ["chat", "--resume-id", "{id}"],
    },
  },
  antigravity: {
    id: "antigravity",
    label: "Antigravity",
    commands: ["agy"],
    process: {},
    version_probe: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
    hook: {
      format: "json",
      shape: "named",
      path: ".gemini/config/hooks.json",
      timeout: 10,
    },
    events: {
      PreInvocation: "TurnStarted",
      Stop: "TurnEnded",
    },
    stdout: { Stop: '{"decision":"stop"}', "*": "{}" },
    session: {
      id: ["conversationId"],
      name: [],
      // 확인함: agy --help
      resume: ["--conversation", "{id}"],
    },
  },
  grok: {
    id: "grok",
    label: "Grok",
    commands: ["grok"],
    process: {},
    version_probe: null,
    interrupt_keys: [],
    skill_dir: null,
    hook: { ...CLAUDE_HOOK, path: ".grok/hooks/lophn.json" },
    events: {
      SessionStart: "SessionStarted",
      UserPromptSubmit: "TurnStarted",
      Stop: "TurnEnded",
      StopFailure: "TurnEnded",
      StopCancelled: "TurnEnded",
      SessionEnd: "SessionEnded",
    },
    stdout: {},
    session: {
      id: ["session_id"],
      name: ["session_title"],
      // 확인함: grok --help
      resume: ["--resume", "{id}"],
    },
  },
  droid: {
    id: "droid",
    label: "Droid",
    commands: ["droid"],
    process: {},
    version_probe: null,
    interrupt_keys: [],
    skill_dir: null,
    hook: {
      format: "json",
      shape: "nested",
      path: ".factory/settings.json",
    },
    events: {
      SessionStart: "SessionStarted",
      UserPromptSubmit: "TurnStarted",
      Stop: "TurnEnded",
      SessionEnd: "SessionEnded",
      // permission_prompt는 권한 물음이고, 사람이 끊으면 Stop 대신 idle_prompt가 온다.
      Notification: "PermissionRequested",
      PostToolUse: "PermissionResolved",
    },
    stdout: {},
    session: {
      id: ["session_id"],
      name: ["session_title"],
      // herdr agent_resume.rs 표. 여기서 실행해 보지 못함
      resume: ["--resume", "{id}"],
    },
  },
  amp: {
    id: "amp",
    label: "Amp",
    commands: ["amp"],
    process: {},
    version_probe: null,
    interrupt_keys: [],
    skill_dir: null,
    hook: {
      format: "plugin_file",
      path: ".config/amp/plugins/lophn-status.ts",
    },
    events: {
      "session.start": "SessionStarted",
      "agent.start": "TurnStarted",
      "agent.end": "TurnEnded",
    },
    stdout: {},
    session: {
      id: ["session_id"],
      name: [],
      resume: null,
    },
  },
  devin: {
    id: "devin",
    label: "Devin",
    commands: ["devin"],
    process: {},
    version_probe: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
    hook: { format: "jsonc", path: ".config/devin/config.json" },
    events: {
      SessionStart: "SessionStarted",
      UserPromptSubmit: "TurnStarted",
      Stop: "TurnEnded",
      PermissionRequest: "PermissionRequested",
      PostToolUse: "PermissionResolved",
      SessionEnd: "SessionEnded",
    },
    stdout: {},
    session: {
      id: ["session_id"],
      name: ["session_title"],
      // 확인함: devin --help
      resume: ["--resume", "{id}"],
    },
  },
  qwen: {
    id: "qwen",
    label: "Qwen Code",
    commands: ["qwen"],
    process: { packages: ["@qwen-code/qwen-code"] },
    version_probe: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
    hook: { ...CLAUDE_HOOK, path: ".qwen/settings.json" },
    events: CLAUDE_SHAPED,
    stdout: {},
    session: {
      id: ["session_id"],
      name: ["session_title"],
      // herdr agent_resume.rs 표. 여기서 실행해 보지 못함
      resume: ["--resume", "{id}"],
    },
  },
  qoder: {
    id: "qoder",
    label: "Qoder CLI",
    commands: ["qodercli"],
    process: { versioned: ["qodercli-"] },
    version_probe: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
    hook: { ...CLAUDE_HOOK, path: ".qoder/settings.json" },
    events: CLAUDE_SHAPED,
    stdout: {},
    session: {
      id: ["session_id"],
      name: ["session_title"],
      // herdr agent_resume.rs 표. 여기서 실행해 보지 못함
      resume: ["--resume", "{id}"],
    },
  },
  muse: {
    id: "muse",
    label: "Muse",
    commands: ["muse"],
    process: { versioned: ["muse-bin-"] },
    version_probe: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
    hook: {
      format: "managed_json",
      path: ".config/muse/lophn-hooks.json",
      settings: ".config/muse/settings.json",
      timeout: 10,
    },
    events: {
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
    stdout: {},
    session: {
      id: ["session_id"],
      name: [],
      resume: null,
    },
  },
  codebuddy: {
    id: "codebuddy",
    label: "CodeBuddy Code",
    commands: ["codebuddy", "cbc"],
    process: { packages: ["@tencent-ai/codebuddy-code"] },
    version_probe: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
    hook: { ...CLAUDE_HOOK, path: ".codebuddy/settings.json" },
    events: {
      UserPromptSubmit: "TurnStarted",
      Stop: "TurnEnded",
      StopFailure: "TurnEnded",
      // AskUserQuestion도 이 길로 온다. PermissionRequest는 같이 보지 않는다(두 번 센다).
      Notification: "PermissionRequested",
      PostToolUse: "PermissionResolved",
      PostToolUseFailure: "PermissionResolved",
      SessionEnd: "SessionEnded",
    },
    stdout: {},
    session: {
      id: ["session_id"],
      name: ["session_title"],
      resume: null,
    },
  },
  "command-code": {
    id: "command-code",
    label: "Command Code",
    commands: ["command-code", "commandcode"],
    process: {},
    version_probe: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
    hook: {
      ...CLAUDE_HOOK,
      path: ".commandcode/settings.json",
      matchers: { PreToolUse: "shell|read|write|edit" },
    },
    events: {
      SessionStart: "SessionStarted",
      // UserPromptSubmit이 없어 첫 tool 호출을 turn 시작으로 본다. 도구 없는 turn은 running이 되지 않는다.
      PreToolUse: "TurnStarted",
      Stop: "TurnEnded",
    },
    stdout: {},
    session: {
      id: [],
      name: ["session_title"],
      resume: null,
    },
  },
  "prime-agent": {
    id: "prime-agent",
    label: "Prime Agent",
    commands: ["prime-agent"],
    process: {},
    version_probe: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
    hook: null,
    events: {},
    stdout: {},
    session: {
      id: [],
      name: [],
      resume: null,
    },
  },
  mimocode: {
    id: "mimocode",
    label: "MiMo Code",
    commands: ["mimo"],
    process: {},
    version_probe: null,
    interrupt_keys: [],
    skill_dir: null,
    hook: {
      format: "plugin_file",
      path: ".config/mimocode/plugins/lophn-status.ts",
    },
    events: OPENCODE_EVENTS,
    stdout: {},
    session: {
      id: ["properties.sessionID"],
      name: ["properties.info.title", "properties.title"],
      resume: null,
    },
  },
  cline: {
    id: "cline",
    label: "Cline",
    commands: ["cline"],
    process: {},
    version_probe: null,
    interrupt_keys: [],
    skill_dir: null,
    hook: { format: "script_dir", path: ".cline/hooks" },
    events: {
      UserPromptSubmit: "TurnStarted",
      TaskComplete: "TurnEnded",
      TaskCancel: "TurnEnded",
      TaskError: "TurnEnded",
      SessionShutdown: "SessionEnded",
    },
    stdout: {},
    // taskId는 실제 Cline payload로 확인하지 못했다.
    session: {
      id: ["taskId"],
      name: [],
      // 확인함: cline --help
      resume: ["--id", "{id}"],
    },
  },
  letta: {
    id: "letta",
    label: "Letta Code",
    commands: ["letta"],
    process: { packages: ["@letta-ai/letta-code"] },
    version_probe: null,
    interrupt_keys: ["escape", "ctrl-c"],
    skill_dir: null,
    hook: {
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
    events: {
      SessionStart: "SessionStarted",
      UserPromptSubmit: "TurnStarted",
      Stop: "TurnEnded",
      PermissionRequest: "PermissionRequested",
      PostToolUse: "PermissionResolved",
      PostToolUseFailure: "PermissionResolved",
      SessionEnd: "SessionEnded",
    },
    stdout: {},
    session: {
      id: ["session_id"],
      name: [],
      // herdr agent_resume.rs 표. 여기서 실행해 보지 못함
      resume: ["--conversation", "{id}"],
    },
  },
  kilo: {
    id: "kilo",
    label: "Kilo Code CLI",
    commands: ["kilo", "kilocode"],
    process: {},
    version_probe: null,
    interrupt_keys: [],
    skill_dir: null,
    hook: {
      format: "plugin_file",
      path: ".config/kilo/plugin/lophn-status.ts",
    },
    events: OPENCODE_EVENTS,
    stdout: {},
    session: {
      id: ["properties.sessionID"],
      name: ["properties.info.title", "properties.title"],
      // herdr agent_resume.rs 표. 여기서 실행해 보지 못함
      resume: ["--session", "{id}"],
    },
  },
};

// turn 끝을 알리는 hook event가 있어야 메시지를 넣는다. pi는 `agent_end` 뒤에 retry·compaction·이어하기가
// 남을 수 있어 끝이 확정되는 `agent_settled`를 쓴다.
export function canDeliverMessages(id: HarnessId): boolean {
  return Object.values(HARNESS_ADAPTERS[id].events).includes("TurnEnded");
}

// hook이 stdout에 써야 하는 것이다. 없는 harness·event는 아무것도 쓰지 않는다.
export function hookStdout(harness: string, event: string): string | null {
  if (!(harness in HARNESS_ADAPTERS)) return null;
  const stdout = HARNESS_ADAPTERS[harness as HarnessId].stdout;
  return stdout[event] ?? stdout["*"] ?? null;
}

// launcher가 env 없이 일찍 끝날 때도 같은 stdout을 내도록 `hookStdout`이 읽는 표를 행으로 푼 것이다.
export function hookStdoutRows(): {
  harness: string;
  event: string;
  stdout: string;
}[] {
  return Object.values(HARNESS_ADAPTERS).flatMap((adapter) =>
    Object.entries(adapter.stdout).map(([event, stdout]) => ({
      harness: adapter.id,
      event,
      stdout,
    })),
  );
}
