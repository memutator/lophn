// Claude Code의 배포 catalog다(coding-agent/harnesses#R1, T30). 위치·format은
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

export { claude };
