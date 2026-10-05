// harnesses의 순수 값과 판정이다(coding-agent/harnesses, T28). IO는 없고
// 시각·파일·외부 command는 인자로 받는다(architecture). 일곱 제품
// HarnessDefinition의 spec 양과 version·auth 판정을 정의한다(harnesses#R1, R3).
import type {
  HarnessAuth,
  HarnessId,
  HarnessProbeResult,
  HarnessVersion,
} from "../../contracts/coding-agent/mod.ts";

// 배포 catalog와 adapter code의 release 참조다. 관측·설치·실행 해석이 이
// revision을 기준으로 묶인다(domain-model harnesses).
export const CATALOG_REVISION = "harness-catalog-1";
export const ADAPTER_REVISION = "harness-adapter-1";

// capability의 판정이다(R1). 검증하지 못한 capability는 unverified로 남고
// 성공으로 나오지 않는다.
export type CapabilityState = "supported" | "unsupported" | "unverified";

// 실행 환경 지원이다(R4). 지금 native host만 지원이고 WSL·remote는 미지원
// 안내로 끝난다.
export type EnvironmentSupport = {
  kind: "host" | "wsl" | "remote";
  supported: boolean;
  // host는 null이고 미지원은 안내 이유다(R4).
  reason: string | null;
};

// 감지 command다. alias는 제품이 배포하는 다른 이름이고 명확한 근거가 있는
// 것만 둔다.
export type DetectionCommand = {
  name: string;
  aliases: readonly string[];
};

// filesystem 감지 spec이다(R2). home 순회·shell RC 평가가 없다.
export type DetectionSpec = {
  commands: readonly DetectionCommand[];
};

// probe spec이다(R1). version·auth 모두 5,000ms·65,536 bytes 상한이다
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
  // 제품 command가 읽는 것의 표시다. lophn은 원문을 보관하지 않는다(R12).
  side_effects: "none" | "reads_config" | "reads_auth_storage";
  capability: CapabilityState;
  tested_versions: readonly string[];
};

// probe 자리다. 없는 probe는 unverified·not_required 이유를 명시한다
// (domain-model HarnessDefinition).
export type ProbeSeat =
  | { present: true; spec: ProbeSpec }
  | { present: false; capability: CapabilityState; reason: string };

// config·skill·지침·hook 설치 target이다(R1). 위치·연산 본문은 이 값의
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
};

export type HookSpec = {
  purpose: "summary" | "status";
  // config fragment·plugin·extension 방식이다(domain-model).
  method: "config_fragment" | "plugin" | "extension";
  owned_identity: string;
  // event 최소 version이다. 미확인 version은 conservative subset만 쓴다
  // (harnesses#R11).
  minimum_version: string | null;
  capability: CapabilityState;
};

// 실행 계약이다(R1). 지금 PTY TUI만 실행 허용이다(domain-model harnesses,
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

// 일곱 제품의 배포 catalog 값이다(domain-model HarnessDefinition, R1). 값이며
// entity가 아니라 stable 제품 key가 ID 역할을 한다.
export type HarnessDefinition = {
  harness_id: HarnessId;
  label: string;
  catalog_revision: string;
  adapter_revision: string;
  version_policy: {
    // capability가 이 근거로 판정된다(R1).
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
  instructions: readonly InstructionSpec[];
  hooks: readonly HookSpec[];
  execution: ExecutionSpec;
};

// probe 결과의 판정이다(R3). timeout·실패·미지원 probe는 absent나 성공으로
// 바꾸지 않는다.
export const PROBE_OUTCOMES = [
  "ok",
  "timeout",
  "failed",
  "unavailable",
  "unverified_capability",
] as const;

export type ProbeOutcome = (typeof PROBE_OUTCOMES)[number];

// probe 결과를 안전 HarnessProbeResult로 낸다(R12). raw stdout는 없다.
export function probeResultOf(
  probe: string,
  outcome: ProbeOutcome,
  detail: string | null,
): HarnessProbeResult {
  return { probe, outcome, detail };
}

// version 판정이다(R1, R3). classifier 성공 + sortie에서 semver만 verified고
// timeout·실패·빈 결과는 unknown·error로 남는다.
export function versionOf(
  result: HarnessVersion["result"],
  value: string | null,
  reason: string | null,
): HarnessVersion {
  return { result, value, reason };
}

// auth 판정이다(R3). 파일 존재만으로 verified 금지다. verified는 probe가
// 상태 명령을 확인했을 때뿐이다.
export function authOf(
  result: HarnessAuth["result"],
  evidence: string | null,
  reason: string | null,
): HarnessAuth {
  return { result, evidence, reason };
}
