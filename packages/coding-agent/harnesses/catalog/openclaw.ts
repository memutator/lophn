// OpenClaw의 배포 catalog다. 위치·format은
// docs/domain-model/coding-agent/harnesses.md의 일곱 adapter 표를 따르고 검증
// 근거는 docs/research/coding-agent-harness-integration.md 9.1이다. [미확인]
// capability는 unverified로 남고 성공으로 나오지 않는다.
import {
  ADAPTER_REVISION,
  CATALOG_REVISION,
  type HarnessDefinition,
} from "../model.ts";

export const openclaw: HarnessDefinition = {
  harness_id: "openclaw",
  label: "OpenClaw",
  catalog_revision: CATALOG_REVISION,
  adapter_revision: ADAPTER_REVISION,
  version_policy: {
    policy: "unknown",
    tested_versions: [],
    minimum_version: null,
    // `openclaw --version` 출력이 [미확인]이다(조사 9.4).
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
    // openclaw auth 상태 명령은 [미확인]이다(조사 9.4).
    present: false,
    capability: "unverified",
    reason: "auth 상태 명령을 아직 검증하지 않았다",
  },
  // config의 `mcp.servers`는 strict schema라 invalid면 harness가 throw하므로
  // (조사 9.1) lophn이 자동 merge하지 않는다. `mcp.servers.lophn` stdio
  // 조각 안내만 남는다. 구체 구성 위치는 `resolveConfigDir`의 state dir env
  // override·`OPENCLAW_CONFIG_PATH` 다음 기본 `~/.openclaw`이다[확인](조사
  // 9.1). env 치환 문법·hook·skill root 계산은 조사에서 미확인이다.
  config_targets: [],
  skill_targets: [
    // `CONFIG_DIR/skills`(managed, 기본 `~/.openclaw/skills`)다[확인](조사
    // skills-and-guides OpenClaw 절). tier 순서는 extra < bundled < workshop <
    // managed < personal `.agents/skills` < workspace다(같은 절).
    { scope_kind: "user", root_resolver: "home", path: ".openclaw/skills" },
  ],
  // workspace `AGENTS.md`는 agent workspace마다 다를 수 있고 app root와 다르다
  // (domain-model 표). workspace 변경·본문 복제는 없다.
  instructions: [
    { marker: "lophn-managed-instruction", file: "AGENTS.md" },
  ],
  // managed hook·resume·plugin 위치와 event 목록이 [미확인]이다(조사 9.5).
  // unknown을 unsupported로 바꾸지 않는다.
  hooks: [],
  // workspace는 agent마다 달라 앱 root의 AGENTS.md가 읽히는지 알 수 없다.
  // mcp.servers는 strict schema라 invalid config에서 harness가 throw한다(조사
  // 9.1·skills-and-guides). 프로젝트 신뢰는 [미확인]이라 gate를 두지 않는다.
  loading: {
    trust_gates: { mcp: false, skills: false, guide: false },
    guide_hiders: [],
    guide_workspace: "agent_workspace",
    broken_config_effect:
      "OpenClaw는 mcp.servers가 strict schema라 잘못된 config에서 throw한다",
    trust_source: null,
  },
  execution: {
    transport: "pty",
    launch_argv: ["openclaw"],
    resume_argv: null,
    prompt_delivery: "stdin_after_ready",
    session_evidence: "listing",
    // session 소유 stdio 미확인은 unverified이고 CLI fallback이다(조사 3.1).
    capability: "unverified",
  },
};
