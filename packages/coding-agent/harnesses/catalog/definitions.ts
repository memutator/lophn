// 일곱 제품의 배포 catalog다(coding-agent/harnesses#R1, T28). 위치·format은
// docs/domain-model/coding-agent/harnesses.md의 일곱 adapter 표를 따르고
// 검증 근거는 docs/research/coding-agent-harness-integration.md 9절이다.
// [미확인] capability는 unverified로 남고 성공으로 나오지 않는다.
import {
  ADAPTER_REVISION,
  CATALOG_REVISION,
  type HarnessDefinition,
} from "../model.ts";
import type { HarnessId } from "../../../contracts/coding-agent/mod.ts";

// 감지 command와 alias다. alias는 Orca TUI registry의 배포 이름만 둔다
// (조사 1.1, 9.8). 실제 위치는 detection.ts의 정한 fallback이 읽는다.
const claude: HarnessDefinition = {
  harness_id: "claude",
  label: "Claude Code",
  catalog_revision: CATALOG_REVISION,
  adapter_revision: ADAPTER_REVISION,
  version_policy: {
    policy: "unknown",
    tested_versions: [],
    minimum_version: null,
    // version·auth 상태 명령이 [미확인]이라(조사 9.4) unverified다.
    unverifiable: "unverified",
  },
  environments: [
    { kind: "host", supported: true, reason: null },
    {
      kind: "wsl",
      supported: false,
      reason: "지금은 native host만 감지·설치·시작한다",
    },
    {
      kind: "remote",
      supported: false,
      reason: "지금은 native host만 감지·설치·시작한다",
    },
  ],
  detection: { commands: [{ name: "claude", aliases: [] }] },
  version_probe: {
    present: false,
    capability: "unverified",
    reason: "`claude --version` 출력을 아직 검증하지 않았다",
  },
  auth_probe: {
    present: false,
    capability: "unverified",
    reason: "auth 상태 명령을 아직 검증하지 않았다",
  },
  config_targets: [
    // user 등록(`~/.claude.json` 최상위) 또는 app `.mcp.json`이다
    // (domain-model 일곱 adapter 표, 조사 9.1 문서).
    {
      scope_kind: "user",
      root_resolver: "home",
      path: ".claude.json",
      format: "json",
      owned_key: "mcpServers.lophn",
    },
    {
      scope_kind: "app",
      root_resolver: "project",
      path: ".mcp.json",
      format: "json",
      owned_key: "mcpServers.lophn",
    },
  ],
  skill_targets: [
    { scope_kind: "user", root_resolver: "home", path: ".claude/skills" },
    { scope_kind: "app", root_resolver: "project", path: ".claude/skills" },
  ],
  // CLAUDE.md 관리 구간 `@AGENTS.md`다(domain-model 표).
  instructions: [
    {
      marker: "lophn-managed-instruction",
      file: "CLAUDE.md",
    },
  ],
  // `.claude/settings.local.json`의 lophn SessionStart만 summary용이다
  // (domain-model 표). event 별 최소 version은 조사 1.5의 예시다.
  hooks: [
    {
      purpose: "summary",
      method: "config_fragment",
      owned_identity: "SessionStart.lophn",
      minimum_version: "1.0.62",
      capability: "supported",
    },
  ],
  // session ID·transcript는 hook evidence다(조사 3.2).
  execution: {
    transport: "pty",
    launch_argv: ["claude"],
    resume_argv: ["claude", "--resume"],
    prompt_delivery: "argv",
    session_evidence: "hook",
    capability: "supported",
  },
};

const codex: HarnessDefinition = {
  harness_id: "codex",
  label: "Codex",
  catalog_revision: CATALOG_REVISION,
  adapter_revision: ADAPTER_REVISION,
  version_policy: {
    policy: "unknown",
    tested_versions: [],
    minimum_version: null,
    unverifiable: "unverified",
  },
  environments: [
    { kind: "host", supported: true, reason: null },
    {
      kind: "wsl",
      supported: false,
      reason: "지금은 native host만 감지·설치·시작한다",
    },
    {
      kind: "remote",
      supported: false,
      reason: "지금은 native host만 감지·설치·시작한다",
    },
  ],
  detection: { commands: [{ name: "codex", aliases: [] }] },
  version_probe: {
    // `codex --version`은 workspace package version을 찍고 끝난다(조사 9.4).
    present: true,
    spec: {
      adapter_method: "exec.external",
      argv: ["codex", "--version"],
      timeout_ms: 5_000,
      output_limit_bytes: 65_536,
      classifier: "first_semver",
      side_effects: "none",
      capability: "supported",
      tested_versions: [],
    },
  },
  auth_probe: {
    // `codex login status`는 config·auth storage를 읽고 stderr만 쓰며
    // 세션·브라우저를 열지 않는다(조사 9.4).
    present: true,
    spec: {
      adapter_method: "exec.external",
      argv: ["codex", "login", "status"],
      timeout_ms: 5_000,
      output_limit_bytes: 65_536,
      classifier: "login_status",
      side_effects: "reads_auth_storage",
      capability: "supported",
      tested_versions: [],
    },
  },
  config_targets: [
    // 사용자 config.toml의 `[mcp_servers.lophn]`만이고 앱 TOML은 만들지
    // 않는다(domain-model 표, harnesses#R8).
    {
      scope_kind: "user",
      root_resolver: "codex_home",
      path: "config.toml",
      format: "toml",
      owned_key: "mcp_servers.lophn",
    },
  ],
  skill_targets: [
    { scope_kind: "user", root_resolver: "home", path: ".agents/skills" },
    { scope_kind: "app", root_resolver: "project", path: ".agents/skills" },
  ],
  // `AGENTS.md`와 가까운 `AGENTS.override.md` 검사다(domain-model 표).
  instructions: [
    { marker: "lophn-managed-instruction", file: "AGENTS.md" },
  ],
  // Codex hook event는 CODEX_HOME hooks다(조사 9.5). lophn은 상태 hook을
  // 이번 범위에서 검증하지 않았다(조사 3.1).
  hooks: [],
  execution: {
    transport: "pty",
    launch_argv: ["codex"],
    resume_argv: ["codex", "resume"],
    prompt_delivery: "argv",
    session_evidence: "hook",
    capability: "supported",
  },
};

const opencode: HarnessDefinition = {
  harness_id: "opencode",
  label: "OpenCode",
  catalog_revision: CATALOG_REVISION,
  adapter_revision: ADAPTER_REVISION,
  version_policy: {
    // V1 client 구현만 보고 전체 실행 계약을 확정하지 않는다(조사 2 절).
    policy: "minimum",
    tested_versions: [],
    minimum_version: "2.0.10",
    unverifiable: "unverified",
  },
  environments: [
    { kind: "host", supported: true, reason: null },
    {
      kind: "wsl",
      supported: false,
      reason: "지금은 native host만 감지·설치·시작한다",
    },
    {
      kind: "remote",
      supported: false,
      reason: "지금은 native host만 감지·설치·시작한다",
    },
  ],
  detection: { commands: [{ name: "opencode", aliases: ["opencode2"] }] },
  version_probe: {
    // `opencode --version`은 yargs 상수를 찍는다(조사 9.4).
    present: true,
    spec: {
      adapter_method: "exec.external",
      argv: ["opencode", "--version"],
      timeout_ms: 5_000,
      output_limit_bytes: 65_536,
      classifier: "first_semver",
      side_effects: "none",
      capability: "supported",
      tested_versions: ["2.0.10"],
    },
  },
  auth_probe: {
    // `opencode providers list`의 출력·exit는 [미확인]이라(조사 9.4)
    // 상태 probe로 쓰지 않는다(R3 확인).
    present: false,
    capability: "unverified",
    reason: "`opencode providers list` 출력을 아직 검증하지 않았다",
  },
  config_targets: [
    // XDG user `opencode.json` 또는 app `opencode.json`이다(domain-model 표).
    {
      scope_kind: "user",
      root_resolver: "xdg_config_opencode",
      path: "opencode.json",
      format: "json",
      owned_key: "mcp.lophn",
    },
    {
      scope_kind: "app",
      root_resolver: "project",
      path: "opencode.json",
      format: "json",
      owned_key: "mcp.lophn",
    },
  ],
  skill_targets: [
    {
      scope_kind: "user",
      root_resolver: "xdg_config_opencode",
      path: "skills",
    },
    { scope_kind: "app", root_resolver: "project", path: ".opencode/skills" },
  ],
  // `AGENTS.md`, 기존 rules와 config precedence 보존이다(domain-model 표).
  instructions: [
    { marker: "lophn-managed-instruction", file: "AGENTS.md" },
  ],
  // OpenCode plugin은 config `plugin` 배열이다(조사 9.5). lophn 상태 hook의
  // 검증 version이 없다.
  hooks: [],
  execution: {
    transport: "pty",
    launch_argv: ["opencode"],
    resume_argv: ["opencode", "--session"],
    prompt_delivery: "argv",
    session_evidence: "event",
    capability: "supported",
  },
};

const gemini: HarnessDefinition = {
  harness_id: "gemini",
  label: "Gemini CLI",
  catalog_revision: CATALOG_REVISION,
  adapter_revision: ADAPTER_REVISION,
  version_policy: {
    policy: "unknown",
    tested_versions: [],
    minimum_version: null,
    // auth 상태 명령이 없다(조사 9.4). capability의 판정은 config 값이다.
    unverifiable: "unverified",
  },
  environments: [
    { kind: "host", supported: true, reason: null },
    {
      kind: "wsl",
      supported: false,
      reason: "지금은 native host만 감지·설치·시작한다",
    },
    {
      kind: "remote",
      supported: false,
      reason: "지금은 native host만 감지·설치·시작한다",
    },
  ],
  detection: { commands: [{ name: "gemini", aliases: [] }] },
  version_probe: {
    present: false,
    capability: "unverified",
    reason: "Gemini CLI 버전 출력 코드를 아직 검증하지 않았다",
  },
  auth_probe: {
    // auth 상태 명령이 없어(조사 9.4) 상태 probe가 없다. 사람이 고른
    // 별도 검사 level은 config `security.auth.selectedType`을 읽는
    // 어댑터로 대신한다(별도 작업).
    present: false,
    capability: "unsupported",
    reason: "auth 상태 명령이 없다",
  },
  config_targets: [
    // `~/.gemini/settings.json` 또는 app `.gemini/settings.json`이다
    // (domain-model 표). scope는 사람이 고른다(gemini 자체 기본 project를
    // 따르지 않는다, T30).
    {
      scope_kind: "user",
      root_resolver: "home",
      path: ".gemini/settings.json",
      format: "json",
      owned_key: "mcpServers.lophn",
    },
    {
      scope_kind: "app",
      root_resolver: "project",
      path: ".gemini/settings.json",
      format: "json",
      owned_key: "mcpServers.lophn",
    },
  ],
  skill_targets: [
    { scope_kind: "user", root_resolver: "home", path: ".gemini/skills" },
    { scope_kind: "app", root_resolver: "project", path: ".gemini/skills" },
  ],
  // 기존 `context.fileName` 목록에 AGENTS.md 참조만 추가다(domain-model 표).
  instructions: [
    { marker: "lophn-managed-instruction", file: "AGENTS.md" },
  ],
  // trust·skill consent를 자동 확대하지 않는다(domain-model 표). hook은
  // settings.json의 hooks 객체다(조사 9.5).
  hooks: [],
  execution: {
    transport: "pty",
    launch_argv: ["gemini"],
    resume_argv: ["gemini", "--resume"],
    prompt_delivery: "argv",
    session_evidence: "hook",
    capability: "supported",
  },
};

const hermes: HarnessDefinition = {
  harness_id: "hermes",
  label: "Hermes",
  catalog_revision: CATALOG_REVISION,
  adapter_revision: ADAPTER_REVISION,
  version_policy: {
    policy: "unknown",
    tested_versions: [],
    minimum_version: null,
    unverifiable: "unverified",
  },
  environments: [
    { kind: "host", supported: true, reason: null },
    {
      kind: "wsl",
      supported: false,
      reason: "지금은 native host만 감지·설치·시작한다",
    },
    {
      kind: "remote",
      supported: false,
      reason: "지금은 native host만 감지·설치·시작한다",
    },
  ],
  detection: { commands: [{ name: "hermes", aliases: [] }] },
  version_probe: {
    present: false,
    capability: "unverified",
    reason: "`hermes --version` 처리 위치를 아직 검증하지 않았다",
  },
  auth_probe: {
    // `hermes auth status <provider>` 출력·exit는 [미확인]이다(조사 9.4).
    present: false,
    capability: "unverified",
    reason: "`hermes auth status` 출력을 아직 검증하지 않았다",
  },
  config_targets: [
    // `$HERMES_HOME/config.yaml`(기본 `~/.hermes/config.yaml`)이다
    // (domain-model 표).
    {
      scope_kind: "user",
      root_resolver: "hermes_home",
      path: "config.yaml",
      format: "yaml",
      owned_key: "mcp_servers.lophn",
    },
  ],
  skill_targets: [
    { scope_kind: "user", root_resolver: "hermes_home", path: "skills" },
    { scope_kind: "app", root_resolver: "project", path: ".hermes/skills" },
  ],
  // `AGENTS.md`, profile home·workspace 확인이다(domain-model 표).
  instructions: [
    { marker: "lophn-managed-instruction", file: "AGENTS.md" },
  ],
  // Hermes plugin hook은 YAML-enabled Python plugin이다(조사 9.5). lophn이
  // 쓰는 검증 version이 없어 이번 범위에서 두지 않는다.
  hooks: [],
  execution: {
    transport: "pty",
    launch_argv: ["hermes", "--tui"],
    resume_argv: null,
    prompt_delivery: "argv",
    session_evidence: "event",
    capability: "supported",
  },
};

const pi: HarnessDefinition = {
  harness_id: "pi",
  label: "pi",
  catalog_revision: CATALOG_REVISION,
  adapter_revision: ADAPTER_REVISION,
  version_policy: {
    policy: "unknown",
    tested_versions: [],
    minimum_version: null,
    unverifiable: "unverified",
  },
  environments: [
    { kind: "host", supported: true, reason: null },
    {
      kind: "wsl",
      supported: false,
      reason: "지금은 native host만 감지·설치·시작한다",
    },
    {
      kind: "remote",
      supported: false,
      reason: "지금은 native host만 감지·설치·시작한다",
    },
  ],
  detection: { commands: [{ name: "pi", aliases: [] }] },
  version_probe: {
    present: false,
    capability: "unverified",
    reason: "`pi --version` 출력을 아직 검증하지 않았다",
  },
  auth_probe: {
    present: false,
    capability: "unverified",
    reason: "auth 상태 명령을 아직 검증하지 않았다",
  },
  config_targets: [
    // `~/.pi/agent/mcp-adapter.json`이다(domain-model 표. T31이 검증
    // version에 맞게 고칠 자리다).
    {
      scope_kind: "user",
      root_resolver: "home",
      path: ".pi/agent/mcp-adapter.json",
      format: "json",
      owned_key: "mcpServers.lophn",
    },
  ],
  skill_targets: [
    { scope_kind: "user", root_resolver: "home", path: ".pi/agent/skills" },
    { scope_kind: "app", root_resolver: "project", path: ".pi/skills" },
  ],
  instructions: [
    { marker: "lophn-managed-instruction", file: "AGENTS.md" },
  ],
  // native MCP와 adapter 이중 시작 금지다(domain-model 표). lophn은 script·
  // proxy 필수 adapter를 쓰지 않는다.
  hooks: [],
  execution: {
    transport: "pty",
    launch_argv: ["pi"],
    resume_argv: ["pi", "--session"],
    prompt_delivery: "argv",
    session_evidence: "file",
    capability: "supported",
  },
};

const openclaw: HarnessDefinition = {
  harness_id: "openclaw",
  label: "OpenClaw",
  catalog_revision: CATALOG_REVISION,
  adapter_revision: ADAPTER_REVISION,
  version_policy: {
    policy: "unknown",
    tested_versions: [],
    minimum_version: null,
    unverifiable: "unverified",
  },
  environments: [
    { kind: "host", supported: true, reason: null },
    {
      kind: "wsl",
      supported: false,
      reason: "지금은 native host만 감지·설치·시작한다",
    },
    {
      kind: "remote",
      supported: false,
      reason: "지금은 native host만 감지·설치·시작한다",
    },
  ],
  detection: { commands: [{ name: "openclaw", aliases: [] }] },
  version_probe: {
    present: false,
    capability: "unverified",
    reason: "`openclaw --version` 출력을 아직 검증하지 않았다",
  },
  // session 소유 stdio 미확인은 unknown이고 CLI fallback이다(조사 3.1).
  auth_probe: {
    present: false,
    capability: "unverified",
    reason: "auth 상태 명령을 아직 검증하지 않았다",
  },
  config_targets: [],
  skill_targets: [
    { scope_kind: "user", root_resolver: "home", path: ".openclaw/skills" },
  ],
  // workspace AGENTS.md와 app root 차이 검사다(domain-model 표).
  instructions: [
    { marker: "lophn-managed-instruction", file: "AGENTS.md" },
  ],
  // managed hook/resume는 [미확인]이다(조사 3.1). unknown을 unsupported로
  // 바꾸지 않는다.
  hooks: [],
  execution: {
    transport: "pty",
    launch_argv: ["openclaw"],
    resume_argv: null,
    prompt_delivery: "stdin_after_ready",
    session_evidence: "listing",
    capability: "unverified",
  },
};

export const HARNESS_CATALOG: readonly HarnessDefinition[] = [
  claude,
  codex,
  opencode,
  gemini,
  hermes,
  pi,
  openclaw,
];

export function catalogOf(
  harness_id: HarnessId,
): HarnessDefinition | undefined {
  return HARNESS_CATALOG.find((entry) => entry.harness_id === harness_id);
}
