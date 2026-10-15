// OpenCode의 배포 catalog다.
import {
  ADAPTER_REVISION,
  CATALOG_REVISION,
  type HarnessDefinition,
} from "../model.ts";

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
    // 상태 probe로 쓰지 않는다.
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
  // `.claude/skills`와 `.agents/skills`도 읽고 같은 이름은 warning 뒤 하나가
  // 덮는다(조사 skills-and-guides). 순서는 앞이 우선인 추정이고 어느 쪽이든
  // 동명은 conflict다.
  skill_discovery: [
    { scope_kind: "app", root_resolver: "project", path: ".opencode/skills" },
    { scope_kind: "app", root_resolver: "project", path: ".agents/skills" },
    { scope_kind: "app", root_resolver: "project", path: ".claude/skills" },
    {
      scope_kind: "user",
      root_resolver: "xdg_config_opencode",
      path: "skills",
    },
    { scope_kind: "user", root_resolver: "home", path: ".agents/skills" },
    { scope_kind: "user", root_resolver: "home", path: ".claude/skills" },
  ],
  mcp_shape: "opencode_local",
  // AGENTS.md가 있으면 CLAUDE.md는 읽지 않으므로 lophn이 고칠 지침 파일은 없다.
  // 기존 rules·config precedence는 건드리지 않는다.
  instructions: [
    {
      marker: "lophn-managed-instruction",
      file: "AGENTS.md",
      mode: "canonical",
    },
  ],
  // OpenCode plugin은 config `plugin` 배열이다(조사 9.5). plugin 하나가 아래 event를 받아
  // `session observe`로 넘긴다. 검증 version이 없어 unverified이고 설치하지 않는다.
  hooks: [
    {
      event: "session.status",
      target: {
        scope_kind: "user",
        root_resolver: "xdg_config_opencode",
        path: "plugin/lophn-status.ts",
      },
      purpose: "status",
      method: "plugin",
      owned_identity: "session.status.lophn",
      minimum_version: null,
      capability: "unverified",
    },
    {
      event: "permission.asked",
      target: {
        scope_kind: "user",
        root_resolver: "xdg_config_opencode",
        path: "plugin/lophn-status.ts",
      },
      purpose: "status",
      method: "plugin",
      owned_identity: "permission.asked.lophn",
      minimum_version: null,
      capability: "unverified",
    },
    {
      event: "permission.replied",
      target: {
        scope_kind: "user",
        root_resolver: "xdg_config_opencode",
        path: "plugin/lophn-status.ts",
      },
      purpose: "status",
      method: "plugin",
      owned_identity: "permission.replied.lophn",
      minimum_version: null,
      capability: "unverified",
    },
    {
      event: "session.idle",
      target: {
        scope_kind: "user",
        root_resolver: "xdg_config_opencode",
        path: "plugin/lophn-status.ts",
      },
      purpose: "status",
      method: "plugin",
      owned_identity: "session.idle.lophn",
      minimum_version: null,
      capability: "unverified",
    },
  ],
  // OpenCode는 프로젝트 신뢰 gate가 없다(조사 skills-and-guides 비교표).
  loading: {
    trust_gates: { mcp: false, skills: false, guide: false },
    guide_hiders: [],
    guide_workspace: "app_root",
    broken_config_effect: null,
    trust_source: null,
  },
  execution: {
    transport: "pty",
    launch_argv: ["opencode"],
    resume_argv: ["opencode", "--session"],
    prompt_delivery: "argv",
    session_evidence: "event",
    capability: "supported",
  },
};

export { opencode };
