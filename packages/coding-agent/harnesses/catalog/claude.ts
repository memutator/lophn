// Claude Code의 배포 catalog다. 위치·format은
// docs/domain-model/coding-agent/harnesses.md의 일곱 adapter 표를 따르고
// 검증 근거는 docs/research/coding-agent-harness-integration.md 9절이다.
import {
  ADAPTER_REVISION,
  CATALOG_REVISION,
  type HarnessDefinition,
} from "../model.ts";

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
  // enterprise > personal > project라 user root가 앞이다(조사 skills-and-guides).
  skill_discovery: [
    { scope_kind: "user", root_resolver: "home", path: ".claude/skills" },
    { scope_kind: "app", root_resolver: "project", path: ".claude/skills" },
  ],
  skill_trust_note:
    "project skill은 Claude Code가 그 folder를 신뢰한 뒤 읽는다. lophn은 신뢰를 대신 정하지 않는다",
  instructions: [
    {
      marker: "lophn-managed-instruction",
      file: "CLAUDE.md",
      mode: "region",
      body: "@AGENTS.md",
    },
  ],
  // `.claude/settings.local.json`의 lophn SessionStart만 summary용이다
  // (domain-model 표). event 별 최소 version은 조사 1.5의 예시다.
  // 모르는 event 하나가 settings 전체를 버리게 하므로(조사 R11) event별 최소
  // version을 두고 version을 알 때만 설치한다. status용 event는 `lophn session observe --hook claude`가
  // 정규화한다. payload schema와 `LOPHN_TERMINAL_OBSERVE` env가 hook까지 살아남는지 검증한 version이 없어
  // 모두 unverified이고 설치하지 않으며 관측은 unknown이다.
  hooks: [
    {
      event: "SessionStart",
      target: {
        scope_kind: "app",
        root_resolver: "project",
        path: ".claude/settings.local.json",
      },
      purpose: "summary",
      // 시작·재개·초기화만 받는다. compact 같은 다른 source는 summary를 다시 넣지 않는다.
      matcher: "startup|resume|clear",
      method: "config_fragment",
      owned_identity: "SessionStart.lophn",
      minimum_version: "1.0.62",
      capability: "supported",
    },
    {
      event: "PermissionRequest",
      target: {
        scope_kind: "app",
        root_resolver: "project",
        path: ".claude/settings.local.json",
      },
      purpose: "status",
      method: "config_fragment",
      owned_identity: "PermissionRequest.lophn",
      minimum_version: "2.0.45",
      capability: "unverified",
    },
    {
      event: "PostCompact",
      target: {
        scope_kind: "app",
        root_resolver: "project",
        path: ".claude/settings.local.json",
      },
      purpose: "status",
      method: "config_fragment",
      owned_identity: "PostCompact.lophn",
      minimum_version: "2.1.76",
      capability: "unverified",
    },
    {
      event: "UserPromptSubmit",
      target: {
        scope_kind: "app",
        root_resolver: "project",
        path: ".claude/settings.local.json",
      },
      purpose: "status",
      method: "config_fragment",
      owned_identity: "UserPromptSubmit.lophn",
      minimum_version: null,
      capability: "unverified",
    },
    {
      event: "PostToolUse",
      target: {
        scope_kind: "app",
        root_resolver: "project",
        path: ".claude/settings.local.json",
      },
      purpose: "status",
      method: "config_fragment",
      owned_identity: "PostToolUse.lophn",
      minimum_version: null,
      capability: "unverified",
    },
    {
      event: "Stop",
      target: {
        scope_kind: "app",
        root_resolver: "project",
        path: ".claude/settings.local.json",
      },
      purpose: "status",
      method: "config_fragment",
      owned_identity: "Stop.lophn",
      minimum_version: null,
      capability: "unverified",
    },
    {
      event: "SessionEnd",
      target: {
        scope_kind: "app",
        root_resolver: "project",
        path: ".claude/settings.local.json",
      },
      purpose: "status",
      method: "config_fragment",
      owned_identity: "SessionEnd.lophn",
      minimum_version: null,
      capability: "unverified",
    },
    {
      event: "SessionStart",
      target: {
        scope_kind: "app",
        root_resolver: "project",
        path: ".claude/settings.local.json",
      },
      purpose: "status",
      method: "config_fragment",
      owned_identity: "SessionStart.lophn-status",
      minimum_version: null,
      capability: "unverified",
    },
  ],
  // 네 loading 관측의 근거다. project skill은 폴더 신뢰 뒤에 읽고
  // 앱 `.mcp.json`은 사람의 승인 뒤에 쓰인다. CLAUDE.md는 `@AGENTS.md`
  // import로만 AGENTS.md를 읽는다(조사 skills-and-guides).
  loading: {
    trust_gates: { mcp: true, skills: true, guide: false },
    guide_hiders: [],
    guide_workspace: "app_root",
    broken_config_effect: null,
    trust_source: null,
  },
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

export { claude };
