import { createHash } from "node:crypto";
import { canonicalize } from "../../../../base/mod.ts";

// 플랫폼 필수 검사의 정의. runner의 불변 설치 자료이고 앱 bundle이 고칠 수 없다.
// 검사마다 정의 digest가 있고 test 자식은 관측 frame의
// actual에 그 digest를 실어 보낸다. runner가 설치 자료의 digest와 다르면 검사가
// 바뀐 것으로 본다.
export const CHECK_DEFINITIONS_VERSION = 1;

export const RUNNER_CHECKS = [
  "declarations",
  "fixed_sdk",
  "failure_path_coverage",
] as const;
export const HARNESS_CHECKS = [
  "blueprint_handler_match",
  "code_usage_static",
  "code_usage_dynamic",
  "sdk_receipt",
  "process_exception",
  "redaction",
  "permission_denial",
  "view_exception",
  "feedback",
  // 앱 계약 검사
  "migration_empty",
  "migration_upgrade",
  "read_contract",
  "automation_scope",
  "secret_grant",
  "adapter_isolation",
  "revert_restore",
  "revert_conflict",
  "revert_duplicate",
] as const;
export type RunnerCheckName = (typeof RUNNER_CHECKS)[number];
export type HarnessCheckName = (typeof HARNESS_CHECKS)[number];
export type PlatformCheckName = RunnerCheckName | HarnessCheckName;

export const FAILURE_PATH_PREFIX = "failure_path:";

export function failurePathName(code: string): string {
  return `${FAILURE_PATH_PREFIX}${code}`;
}

export function isFailurePathName(name: string): boolean {
  return name.startsWith(FAILURE_PATH_PREFIX);
}

export type CheckSource = "runner" | "harness";

export type CheckDefinition = {
  name: string;
  source: CheckSource;
  kind: "platform" | "failure_path";
  code: string | null;
};

export function checkDigest(definition: CheckDefinition): string {
  return createHash("sha256").update(
    canonicalize({ version: CHECK_DEFINITIONS_VERSION, ...definition }),
    "utf8",
  ).digest("hex");
}

export function platformDefinition(name: PlatformCheckName): CheckDefinition {
  const source: CheckSource =
    (RUNNER_CHECKS as readonly string[]).includes(name) ? "runner" : "harness";
  return { name, source, kind: "platform", code: null };
}

export function failurePathDefinition(code: string): CheckDefinition {
  return {
    name: failurePathName(code),
    source: "harness",
    kind: "failure_path",
    code,
  };
}

// 앱이 직접 낼 수 없는 고정 canary. redaction 검사가 보고에 심는다.
export const REDACTION_CANARY = "lophn-canary-secret-0123456789";
// 선언하지 않은 code. 동적 검사가 SDK에 직접 보내 거절을 확인한다.
export const UNDECLARED_PROBE_CODE = "undeclared_probe_code";
// 화면 검사 host가 판정하지 못했을 때 view 검사 frame의 evidence.view_host 값.
export const VIEW_HOST_INCONCLUSIVE = "inconclusive";

// 통과가 증명하는 범위. 검사마다 고정 기준과 입력 범위를 runner의
// 설치 자료로 두고, observations는 이것을 인접 불변식과 따로 적는다.
export type CheckCoverage = { criteria: string[]; input_range: string };

const COVERAGE: Record<HarnessCheckName, CheckCoverage> = {
  blueprint_handler_match: {
    criteria: ["선언 command 집합과 등록 handler 집합이 같다"],
    input_range: "준비 attestation 한 번",
  },
  code_usage_static: {
    criteria: ["source의 reportProblem literal은 선언한 code뿐이다"],
    input_range: "고정 source 폴더의 앱 source",
  },
  code_usage_dynamic: {
    criteria: ["선언 없는 code와 예약 code의 직접 보고가 거절된다"],
    input_range: "고정 probe code 2개",
  },
  sdk_receipt: {
    criteria: ["SDK completion을 기다려 접수를 확인한다"],
    input_range: "보고 1건",
  },
  process_exception: {
    criteria: ["처리되지 않은 process 예외가 예약 code로 접수된다"],
    input_range: "일으킨 예외 1건",
  },
  redaction: {
    criteria: ["저장 전 본문에 canary가 남지 않는다"],
    input_range: "고정 canary 1개",
  },
  permission_denial: {
    criteria: ["grant 없는 접근이 거절된다"],
    input_range: "grant 없는 접근 1건",
  },
  view_exception: {
    criteria: ["view 예외가 예약 code로 접수된다"],
    input_range: "화면 검사 host의 test view",
  },
  feedback: {
    criteria: ["깨진 view의 feedback이 예약 code로 접수된다"],
    input_range: "화면 검사 host의 깨진 test view",
  },
  migration_empty: {
    criteria: [
      "빈 test DB(schema 0)에 전체 migration이 새 schema까지 적용된다",
      "적용 뒤 무결성 확인이 통과한다",
    ],
    input_range:
      "빈 fixture DB 1개. schema 번호와 무결성만 보고 업무 정확성은 증명하지 않는다",
  },
  migration_upgrade: {
    criteria: [
      "이전 release schema의 DB가 새 schema로 migration된다",
      "적용 뒤 무결성 확인이 통과하고 되돌림 없이 끝난다",
    ],
    input_range:
      "이전 release schema의 fixture DB 1개. 업무 정확성은 증명하지 않는다",
  },
  read_contract: {
    criteria: [
      "blueprint 입력 계약을 어긴 입력이 거절된다",
      "read 호출이 업무 데이터를 바꾸지 않는다",
    ],
    input_range: "read 선언 command마다 잘못된 입력 1개와 정상 입력 1개",
  },
  automation_scope: {
    criteria: [
      "automation은 선언한 command만 고정 입력으로 실행한다",
      "confirm command는 automation으로 실행되지 않는다",
      "external automation은 한 번 승인한 것만 실행된다",
    ],
    input_range: "선언한 automation과 confirm command",
  },
  secret_grant: {
    criteria: [
      "grant된 secret의 가져오기·쓰기·동기화가 대역에서 허용된다",
      "호출마다 approval을 요구하거나 automation이라는 이유로 막지 않는다",
    ],
    input_range: "선언한 secret마다 3가지 작업과 호출 주체 2가지",
  },
  adapter_isolation: {
    criteria: [
      "net·secret·문서 쓰기가 고정 대역에만 닿는다",
      "실제 외부 host 접속이 없다",
    ],
    input_range: "외부에 닿는 command의 fixture 실행",
  },
  revert_restore: {
    criteria: ["변경 → 되돌림 뒤 업무 상태가 원래와 같다"],
    input_range: "되돌리기 지원 write command마다 변경 1회와 되돌림 1회",
  },
  revert_conflict: {
    criteria: ["후속 변경 뒤의 되돌림은 conflict로 거절된다"],
    input_range: "되돌리기 지원 write command마다 변경 2회 뒤 첫 변경 되돌림",
  },
  revert_duplicate: {
    criteria: ["이미 되돌린 변경의 중복 되돌림은 거절된다"],
    input_range: "되돌리기 지원 write command마다 되돌림 2회",
  },
};

const FAILURE_PATH_COVERAGE: CheckCoverage = {
  criteria: ["주입한 실패가 실제 command 호출 안에서 선언 code로 접수된다"],
  input_range: "선언 code마다 fixture 실패 주입 1회",
};

const RUNNER_COVERAGE: Record<RunnerCheckName, CheckCoverage> = {
  declarations: {
    criteria: ["problem code 선언이 올바르고 고정 blueprint와 같다"],
    input_range: "고정 blueprint 하나",
  },
  fixed_sdk: {
    criteria: ["고정 SDK 의존을 그대로 쓴다"],
    input_range: "blueprint의 SDK 의존 목록",
  },
  failure_path_coverage: {
    criteria: ["선언한 code마다 실패 경로 test가 하나 있다"],
    input_range: "고정 test의 실패 경로 목록",
  },
};

export function coverageOf(definition: CheckDefinition): CheckCoverage {
  if (definition.kind === "failure_path") return FAILURE_PATH_COVERAGE;
  const name = definition.name as PlatformCheckName;
  return (RUNNER_COVERAGE as Record<string, CheckCoverage>)[name] ??
    COVERAGE[name as HarnessCheckName];
}
