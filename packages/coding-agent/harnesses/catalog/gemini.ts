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

export { gemini };
