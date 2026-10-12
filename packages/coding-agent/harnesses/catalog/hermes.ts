// Hermes의 배포 catalog다. 위치·format은
// docs/domain-model/coding-agent/harnesses.md의 일곱 adapter 표를 따르고 검증
// 근거는 docs/research/coding-agent-harness-integration.md 9.1·9.2·9.5다.
// [미확인] capability는 unverified로 남고 성공으로 나오지 않는다.
import {
  ADAPTER_REVISION,
  CATALOG_REVISION,
  type HarnessDefinition,
} from "../model.ts";

export const hermes: HarnessDefinition = {
  harness_id: "hermes",
  label: "Hermes",
  catalog_revision: CATALOG_REVISION,
  adapter_revision: ADAPTER_REVISION,
  version_policy: {
    policy: "unknown",
    tested_versions: [],
    minimum_version: null,
    // `hermes --version` 처리 위치가 [미확인]이다(조사 9.4).
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
    // `hermes_constants.py` `get_config_path`가 `get_hermes_home()`(context
    // override → `HERMES_HOME` → process home)의 `config.yaml`이다[확인,
    // 함수 위치](조사 9.1). lophn의 YAML merge는 들여쓰기 map과 scalar뿐이다.
    {
      scope_kind: "user",
      root_resolver: "hermes_home",
      path: "config.yaml",
      format: "yaml",
      owned_key: "mcp_servers.lophn",
    },
  ],
  skill_targets: [
    // `get_skills_dir()` = `$HERMES_HOME/skills`다[확인](조사 9.5).
    { scope_kind: "user", root_resolver: "hermes_home", path: "skills" },
    // 프로젝트 `.hermes/skills`는 `get_skills_dir`에 없다[미확인](조사 9.5).
    { scope_kind: "app", root_resolver: "project", path: ".hermes/skills" },
  ],
  skill_trust_note:
    "project skill은 사람이 `hermes skills trust`로 신뢰 목록에 더해야 읽힌다. lophn은 신뢰를 대신 정하지 않는다",
  // `AGENTS.md` chain이고 `.hermes.md`/`HERMES.md`가 이기면 건너뛴다(조사
  // skills-and-guides Hermes 절). project skill trust는 사람의
  // `hermes skills trust`가 `skills.trusted_project_dirs`를 고친다(
  // domain-model 표, 조사 9.5).
  instructions: [
    { marker: "lophn-managed-instruction", file: "AGENTS.md" },
  ],
  // Hermes plugin hook은 `VALID_HOOKS` 이름의 YAML-enabled Python plugin이다
  // (조사 9.5). plugin 디렉터리 상수가 [미확인]이라 lophn이 쓰는 검증 version이
  // 없어 이번 범위에서 두지 않는다.
  hooks: [],
  // 프로젝트 skill은 `skills.trusted_project_dirs`에 있을 때만 읽고 `.hermes.md`
  // `HERMES.md`는 AGENTS.md 체인을 건너뛰게 한다. 깨진 YAML은 메모리에서 기본값
  // 으로 대체된다(조사 9.1·skills-and-guides).
  loading: {
    trust_gates: { mcp: false, skills: true, guide: false },
    guide_hiders: [".hermes.md", "HERMES.md", "AGENTS.override.md"],
    guide_workspace: "app_root",
    broken_config_effect:
      "Hermes는 깨진 config.yaml을 메모리에서 기본값으로 대체해 lophn 항목과 신뢰 목록을 읽지 않는다",
    trust_source: {
      root_resolver: "hermes_home",
      path: "config.yaml",
      format: "yaml",
      list_key: "skills.trusted_project_dirs",
    },
  },
  execution: {
    transport: "pty",
    launch_argv: ["hermes", "--tui"],
    resume_argv: null,
    prompt_delivery: "argv",
    session_evidence: "event",
    capability: "supported",
  },
};
