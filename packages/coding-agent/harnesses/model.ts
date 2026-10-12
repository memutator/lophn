// harnesses의 순수 값과 판정이다(coding-agent/harnesses). IO는 없고
// 시각·파일·외부 command는 인자로 받는다(architecture). 일곱 제품
// HarnessDefinition의 spec 양과 version·auth 판정을 정의한다.
import type {
  HarnessAuth,
  HarnessId,
  HarnessProbeResult,
  HarnessVersion,
} from "../../protocol/coding-agent/mod.ts";

// 배포 catalog와 adapter code의 release 참조다. 관측·설치·실행 해석이 이
// revision을 기준으로 묶인다(domain-model harnesses).
export const CATALOG_REVISION = "harness-catalog-1";
export const ADAPTER_REVISION = "harness-adapter-1";

// capability의 판정이다. 검증하지 못한 capability는 unverified로 남고
// 성공으로 나오지 않는다.
export type CapabilityState = "supported" | "unsupported" | "unverified";

// 실행 환경 지원이다. 지금 native host만 지원이고 WSL·remote는 미지원
// 안내로 끝난다.
export type EnvironmentSupport = {
  kind: "host" | "wsl" | "remote";
  supported: boolean;
  // host는 null이고 미지원은 안내 이유다.
  reason: string | null;
};

// 감지 command다. alias는 제품이 배포하는 다른 이름이고 명확한 근거가 있는
// 것만 둔다.
export type DetectionCommand = {
  name: string;
  aliases: readonly string[];
};

// filesystem 감지 spec이다. home 순회·shell RC 평가가 없다.
export type DetectionSpec = {
  commands: readonly DetectionCommand[];
};

// probe spec이다. version·auth 모두 5,000ms·65,536 bytes 상한이다
// (domain-model target·probe 계약). filesystem 감지에서 자동 실행하지 않고
// 사람이 고른 별도 검사 level에서 실행한다.
export type ProbeSpec = {
  // 구현 참조 식별자다. serialized 함수 본문은 없다(domain-model).
  adapter_method: string;
  argv: readonly string[];
  timeout_ms: number;
  output_limit_bytes: number;
  // output 판정 방법이다. first_semver는 첫 줄의 semver를 읽고, login_status는
  // codex 문구별 stderr exit로 판정한다.
  classifier: "first_semver" | "login_status";
  // 제품 command가 읽는 것의 표시다. lophn은 원문을 보관하지 않는다.
  side_effects: "none" | "reads_config" | "reads_auth_storage";
  capability: CapabilityState;
  tested_versions: readonly string[];
};

// probe 자리다. 없는 probe는 unverified·not_required 이유를 명시한다
// (domain-model HarnessDefinition).
export type ProbeSeat =
  | { present: true; spec: ProbeSpec }
  | { present: false; capability: CapabilityState; reason: string };

// config·skill·지침·hook 설치 target이다. 위치·연산 본문은 이 값의
// 참조 adapter가 수행한다. mount 범위는 settings 코멘트가 아닌 사람의 선택이다.
export type ConfigTargetSpec = {
  scope_kind: "user" | "app";
  // pro resolvable root이다. effective profile root에서 resolve한다.
  // lophn이 실제 탐지 파일 위치와 강제한다.
  root_resolver: string;
  path: string;
  format: "json" | "toml" | "yaml";
  owned_key: string;
};

export type SkillTargetSpec = {
  scope_kind: "user" | "app";
  root_resolver: string;
  path: string;
};

export type InstructionSpec = {
  // 관리 marker다. marker 없는 기존 파일은 무변경이다(domain-model).
  marker: string;
  file: string;
  // 정본 AGENTS.md를 읽게 하는 방식이다. canonical은 제품이 AGENTS.md를 직접
  // 읽어 lophn이 고칠 파일이 없는 것이고, region은 지침 파일의 관리 구간이며,
  // json_member는 설정 JSON의 기존 목록에 원소 하나를 더하는 것이다.
  // 없으면 canonical이다.
  mode?: "canonical" | "region" | "json_member";
  // region이 쓰는 관리 구간 본문이다(Claude `@AGENTS.md`).
  body?: string;
  // json_member의 목록 key와 원소다(Gemini `context.fileName`, `AGENTS.md`).
  json_key?: string;
  member?: string;
  // 정본보다 가까이서 이기는 override 파일이다(Codex `AGENTS.override.md`).
  override_file?: string;
};

export type HookSpec = {
  // 제품별 event 이름이다(Claude `SessionStart`, Gemini `BeforeTool` 등). 한
  // 목록을 여러 제품에 재사용하지 않고 제품 catalog가 version별로 둔다.
  event: string;
  // hook을 쓰는 설정 파일이다. config_targets(MCP)와 따로 둔다.
  target: {
    scope_kind: "user" | "app";
    root_resolver: string;
    path: string;
  };
  purpose: "summary" | "status";
  // 이 event를 받는 source다. Claude SessionStart의 시작·재개·초기화다. 없으면 matcher를
  // 쓰지 않는다.
  matcher?: string;
  // config fragment·plugin·extension 방식이다(domain-model).
  method: "config_fragment" | "plugin" | "extension";
  owned_identity: string;
  // event 최소 version이다. 미확인 version은 conservative subset만 쓴다.
  minimum_version: string | null;
  // hook timeout 단위다. Claude는 초, Gemini는 ms다. 없으면 초다.
  timeout_unit?: "s" | "ms";
  capability: CapabilityState;
};

// 실행 계약이다. 지금 PTY TUI만 실행 허용이다(domain-model harnesses,
// → coding-agent/sessions).
export type ExecutionSpec = {
  transport: "pty" | "sdk" | "rpc" | "http" | "acp";
  launch_argv: readonly string[];
  resume_argv: readonly string[] | null;
  // readiness·prompt 전달이다(→ coding-agent/sessions).
  prompt_delivery: "argv" | "stdin_after_ready";
  // session ID·status evidence 취득 통로다. hook/protocol/event/file이다.
  session_evidence: "hook" | "protocol" | "event" | "file" | "listing";
  capability: CapabilityState;
};

// 일곱 제품의 배포 catalog 값이다(domain-model HarnessDefinition). 값이며
// entity가 아니라 stable 제품 key가 ID 역할을 한다.
// 제품이 skill을 읽는 발견 root다. 앞일수록 같은 이름에서 이긴다
// (조사 skills-and-guides의 우선순위). 설치 root와 다른 root의 동명 skill은
// 가림·가려짐 conflict의 근거다.
export type SkillDiscoverySpec = {
  scope_kind: "user" | "app";
  root_resolver: string;
  path: string;
};

// MCP 항목 모양이다. 제품마다 command·args·env 표기가 다르다(domain-model 표).
export type McpShape = "command_args_env" | "opencode_local";

// 네 loading 관측의 제품별 근거다. 조사 문서가 확인한
// 사실만 두고 확인하지 못한 제품은 gate를 두지 않아 성공도 부재도 단정하지
// 않는다. 설정·workspace를 읽는 규칙이 아니라 읽기 결과 해석의 근거다.
export type LoadingSpec = {
  // 앱 폴더를 신뢰하지 않으면 제품이 읽지 않는 것이다. 신뢰 상태를 읽지
  // 못하면 그 단계는 성공이 아니라 unknown이다.
  trust_gates: { mcp: boolean; skills: boolean; guide: boolean };
  // 앱 root에 있으면 AGENTS.md를 가리거나 건너뛰게 하는 파일이다.
  guide_hiders: readonly string[];
  // 앱 안내를 읽는 위치다. agent_workspace는 앱 root와 다른 workspace를 쓸
  // 수 있어 그 위치를 모르면 안내 loading은 unknown이다.
  guide_workspace: "app_root" | "agent_workspace";
  // 깨진 설정이 제품에서 일으키는 일이다. 모르면 null이다.
  broken_config_effect: string | null;
  // 제품이 사람 설정 안에서 읽는 신뢰 목록이다. 읽을 수 있으면 사람이 알려 준
  // 신뢰 값보다 우선한다. 목록이 없으면 null이다.
  trust_source: {
    root_resolver: string;
    path: string;
    format: "yaml";
    list_key: string;
  } | null;
};

export type HarnessDefinition = {
  harness_id: HarnessId;
  label: string;
  catalog_revision: string;
  adapter_revision: string;
  version_policy: {
    // capability가 이 근거로 판정된다.
    policy: "tested_ranges" | "minimum" | "unknown";
    tested_versions: readonly string[];
    minimum_version: string | null;
    // version을 모를 때의 capability다(R1 확인).
    unverifiable: CapabilityState;
  };
  environments: readonly EnvironmentSupport[];
  detection: DetectionSpec;
  version_probe: ProbeSeat;
  auth_probe: ProbeSeat;
  config_targets: readonly ConfigTargetSpec[];
  skill_targets: readonly SkillTargetSpec[];
  // 제품이 실제로 읽는 skill root, 우선순위가 높은 것이 앞이다. 없으면
  // skill_targets만 읽는 제품이다.
  skill_discovery?: readonly SkillDiscoverySpec[];
  // 제품의 skill trust·consent 안내다. lophn이 자동으로 넓히지 않는다.
  skill_trust_note?: string;
  // 없으면 command_args_env다.
  mcp_shape?: McpShape;
  instructions: readonly InstructionSpec[];
  hooks: readonly HookSpec[];
  execution: ExecutionSpec;
  // loading 관측의 근거다. 없으면 gate·hider 없는 제품이다.
  loading?: LoadingSpec;
};

// probe 결과의 판정이다. timeout·실패·미지원 probe는 absent나 성공으로
// 바꾸지 않는다.
export const PROBE_OUTCOMES = [
  "ok",
  "timeout",
  "failed",
  "unavailable",
  "unverified_capability",
] as const;

export type ProbeOutcome = (typeof PROBE_OUTCOMES)[number];

// probe 결과를 안전 HarnessProbeResult로 낸다. raw stdout는 없다.
export function probeResultOf(
  probe: string,
  outcome: ProbeOutcome,
  detail: string | null,
): HarnessProbeResult {
  return { probe, outcome, detail };
}

// version 판정이다. classifier 성공 + sortie에서 semver만 verified고
// timeout·실패·빈 결과는 unknown·error로 남는다.
export function versionOf(
  result: HarnessVersion["result"],
  value: string | null,
  reason: string | null,
): HarnessVersion {
  return { result, value, reason };
}

// auth 판정이다. 파일 존재만으로 verified 금지다. verified는 probe가
// 상태 명령을 확인했을 때뿐이다.
export function authOf(
  result: HarnessAuth["result"],
  evidence: string | null,
  reason: string | null,
): HarnessAuth {
  return { result, evidence, reason };
}
