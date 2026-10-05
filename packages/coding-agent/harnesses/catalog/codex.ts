// Codex의 배포 catalog다(coding-agent/harnesses#R1, T30). 위치·format은
// docs/domain-model/coding-agent/harnesses.md의 일곱 adapter 표를 따르고
// 검증 근거는 docs/research/coding-agent-harness-integration.md 9절이다.
import {
  ADAPTER_REVISION,
  CATALOG_REVISION,
  type HarnessDefinition,
} from "../model.ts";

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
  // repo는 `.codex/skills`와 `.agents/skills`, user는 `~/.agents/skills`와
  // deprecated `$CODEX_HOME/skills`다. 우선순위는 조사에서 [미확인]이라 repo가
  // user보다 앞인 일반 규칙을 따르고, 같은 이름은 어느 쪽이든 conflict다.
  skill_discovery: [
    { scope_kind: "app", root_resolver: "project", path: ".agents/skills" },
    { scope_kind: "app", root_resolver: "project", path: ".codex/skills" },
    { scope_kind: "user", root_resolver: "home", path: ".agents/skills" },
    { scope_kind: "user", root_resolver: "codex_home", path: "skills" },
  ],
  skill_trust_note:
    "project skill과 hook은 Codex의 project trust를 거친다. lophn은 trust level을 바꾸지 않는다",
  // 정본 AGENTS.md를 Codex가 직접 읽는다. 가까운 AGENTS.override.md는 검사만
  // 한다.
  instructions: [
    {
      marker: "lophn-managed-instruction",
      file: "AGENTS.md",
      mode: "canonical",
      override_file: "AGENTS.override.md",
    },
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

export { codex };
