// pi의 배포 catalog다. 위치·format은
// docs/domain-model/coding-agent/harnesses.md의 일곱 adapter 표를 따르고 검증
// 근거는 docs/research/coding-agent-harness-integration.md 9.1이다. [미확인]
// capability는 unverified로 남고 성공으로 나오지 않는다.
import {
  ADAPTER_REVISION,
  CATALOG_REVISION,
  type HarnessDefinition,
} from "../model.ts";

export const pi: HarnessDefinition = {
  harness_id: "pi",
  label: "pi",
  catalog_revision: CATALOG_REVISION,
  adapter_revision: ADAPTER_REVISION,
  version_policy: {
    policy: "unknown",
    tested_versions: [],
    minimum_version: null,
    // `pi --version` 출력이 [미확인]이다(조사 9.4).
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
    // pi auth 상태 명령은 [미확인]이다(조사 9.4).
    present: false,
    capability: "unverified",
    reason: "auth 상태 명령을 아직 검증하지 않았다",
  },
  config_targets: [
    // 조사 revision(8369268)의 native MCP 설정이다: `loadMcpConfig`
    // 이 `getAgentDir()`(기본 `~/.pi/agent`)의 `mcp.json`과 trusted 프로젝트의
    // `<cwd>/.pi/mcp.json`을 읽는다[확인](조사 9.1). `stdio`는
    // command·args·env·cwd뿐이고 프로젝트 항목은 같은 이름의 전역 항목을
    // 통째로 교체하므로 lophn은 같은 이름 교체 없이 전역(user)에만 쓴다.
    {
      scope_kind: "user",
      root_resolver: "home",
      path: ".pi/agent/mcp.json",
      format: "json",
      owned_key: "mcpServers.lophn",
    },
    // 단, pi는 깨진 JSON 파일 전체를 건너뛰므로(조사 9.1) broken은 무변경이다.
    // trusted `<cwd>/.pi/mcp.json`(app)은 사람 trust 결정 뒤에만 읽히므로
    // lophn이 자동으로 쓰지 않는다.
    {
      scope_kind: "app",
      root_resolver: "project",
      path: ".pi/mcp.json",
      format: "json",
      owned_key: "mcpServers.lophn",
    },
  ],
  skill_targets: [
    // `loadSkills`가 `getAgentDir()`의 `skills`를 읽는다[확인](조사
    // skills-and-guides pi 절).
    { scope_kind: "user", root_resolver: "home", path: ".pi/agent/skills" },
    // `resolve(cwd, CONFIG_DIR_NAME, "skills")`다[확인](같은 절).
    { scope_kind: "app", root_resolver: "project", path: ".pi/skills" },
  ],
  skill_trust_note:
    "앱 `.pi/skills`와 `.agents/skills`는 pi의 project trust 뒤에 읽힌다. lophn은 신뢰를 대신 정하지 않는다",
  // `AGENTS.md` chain이고 더 가까운 `AGENTS.override.md`가 이긴다(조사
  // skills-and-guides pi 절). native MCP와 adapter 이중 시작 금지다.
  instructions: [
    { marker: "lophn-managed-instruction", file: "AGENTS.md" },
  ],
  // pi extension event는 `session_start` 등의 union이다(조사 9.5). extension 하나가 아래 event를
  // 받아 `session observe`로 넘긴다. loader 디렉터리가 [미확인]이라 검증 version이 없어 unverified이고
  // 설치하지 않는다.
  hooks: [
    {
      event: "session_start",
      target: {
        scope_kind: "user",
        root_resolver: "home",
        path: ".pi/agent/extensions/lophn-status.ts",
      },
      purpose: "status",
      method: "extension",
      owned_identity: "session_start.lophn",
      minimum_version: null,
      capability: "unverified",
    },
    {
      event: "agent_start",
      target: {
        scope_kind: "user",
        root_resolver: "home",
        path: ".pi/agent/extensions/lophn-status.ts",
      },
      purpose: "status",
      method: "extension",
      owned_identity: "agent_start.lophn",
      minimum_version: null,
      capability: "unverified",
    },
    {
      event: "agent_settled",
      target: {
        scope_kind: "user",
        root_resolver: "home",
        path: ".pi/agent/extensions/lophn-status.ts",
      },
      purpose: "status",
      method: "extension",
      owned_identity: "agent_settled.lophn",
      minimum_version: null,
      capability: "unverified",
    },
  ],
  // `<cwd>/.pi/mcp.json`과 `.pi`·`.agents/skills`는 project trust 뒤에 읽고
  // 깨진 mcp.json은 파일 전체를 건너뛴다(조사 9.1·skills-and-guides).
  loading: {
    trust_gates: { mcp: true, skills: true, guide: false },
    guide_hiders: ["AGENTS.override.md"],
    guide_workspace: "app_root",
    broken_config_effect: "pi는 깨진 mcp.json을 파일 전체 건너뛴다",
    trust_source: null,
  },
  execution: {
    transport: "pty",
    launch_argv: ["pi"],
    resume_argv: ["pi", "--session"],
    prompt_delivery: "argv",
    session_evidence: "file",
    capability: "supported",
  },
};
