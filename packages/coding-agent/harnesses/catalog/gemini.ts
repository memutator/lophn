// Gemini CLI의 배포 catalog다(coding-agent/harnesses#R1, T30). 위치·format은
// docs/domain-model/coding-agent/harnesses.md의 일곱 adapter 표를 따르고
// 검증 근거는 docs/research/coding-agent-harness-integration.md 9절이다.
import {
  ADAPTER_REVISION,
  CATALOG_REVISION,
  type HarnessDefinition,
} from "../model.ts";

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
  // workspace가 user보다, `.agents/skills`가 `.gemini/skills`보다 앞이다
  // (skillManager 우선순위, 조사 skills-and-guides). workspace skill은 folder를
  // 신뢰해야 읽힌다.
  skill_discovery: [
    { scope_kind: "app", root_resolver: "project", path: ".agents/skills" },
    { scope_kind: "app", root_resolver: "project", path: ".gemini/skills" },
    { scope_kind: "user", root_resolver: "home", path: ".agents/skills" },
    { scope_kind: "user", root_resolver: "home", path: ".gemini/skills" },
  ],
  skill_trust_note:
    "workspace skill은 Gemini CLI가 folder를 신뢰해야 읽힌다. lophn은 trust와 skill consent를 자동으로 넓히지 않는다",
  // 기존 `context.fileName` 목록은 그대로 두고 AGENTS.md 원소 하나만 더한다.
  instructions: [
    {
      marker: "lophn-managed-instruction",
      file: "AGENTS.md",
      mode: "json_member",
      json_key: "context.fileName",
      member: "AGENTS.md",
    },
  ],
  // event 이름은 Claude와 다르다. 실행기 코드와 hook env sanitizer가 `LOPHN_TERMINAL_OBSERVE`를
  // 살리는지 version별로 검증하지 못해(조사 [미확인]) 모두 unverified이고 설치하지 않는다.
  // `Notification`의 `notification_type=ToolPermission`만 waiting_input evidence다.
  hooks: [
    {
      event: "SessionStart",
      target: {
        scope_kind: "user",
        root_resolver: "home",
        path: ".gemini/settings.json",
      },
      purpose: "summary",
      method: "config_fragment",
      owned_identity: "SessionStart.lophn",
      minimum_version: null,
      timeout_unit: "ms",
      capability: "unverified",
    },
    {
      event: "BeforeTool",
      target: {
        scope_kind: "user",
        root_resolver: "home",
        path: ".gemini/settings.json",
      },
      purpose: "status",
      method: "config_fragment",
      owned_identity: "BeforeTool.lophn",
      minimum_version: null,
      timeout_unit: "ms",
      capability: "unverified",
    },
    {
      event: "BeforeAgent",
      target: {
        scope_kind: "user",
        root_resolver: "home",
        path: ".gemini/settings.json",
      },
      purpose: "status",
      method: "config_fragment",
      owned_identity: "BeforeAgent.lophn",
      minimum_version: null,
      timeout_unit: "ms",
      capability: "unverified",
    },
    {
      event: "AfterAgent",
      target: {
        scope_kind: "user",
        root_resolver: "home",
        path: ".gemini/settings.json",
      },
      purpose: "status",
      method: "config_fragment",
      owned_identity: "AfterAgent.lophn",
      minimum_version: null,
      timeout_unit: "ms",
      capability: "unverified",
    },
    {
      event: "Notification",
      target: {
        scope_kind: "user",
        root_resolver: "home",
        path: ".gemini/settings.json",
      },
      purpose: "status",
      method: "config_fragment",
      owned_identity: "Notification.lophn",
      minimum_version: null,
      timeout_unit: "ms",
      capability: "unverified",
    },
    {
      event: "SessionEnd",
      target: {
        scope_kind: "user",
        root_resolver: "home",
        path: ".gemini/settings.json",
      },
      purpose: "status",
      method: "config_fragment",
      owned_identity: "SessionEnd.lophn",
      minimum_version: null,
      timeout_unit: "ms",
      capability: "unverified",
    },
  ],
  // untrusted면 workspace skill 전체를 건너뛴다(조사 skills-and-guides).
  // `context.fileName` 목록에 AGENTS.md가 있어야 읽는다.
  loading: {
    trust_gates: { mcp: false, skills: true, guide: false },
    guide_hiders: [],
    guide_workspace: "app_root",
    broken_config_effect: null,
    trust_source: null,
  },
  execution: {
    transport: "pty",
    launch_argv: ["gemini"],
    resume_argv: ["gemini", "--resume"],
    prompt_delivery: "argv",
    session_evidence: "hook",
    capability: "supported",
  },
};

export { gemini };
