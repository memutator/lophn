import { createHash } from "node:crypto";
import { canonicalize } from "../../../base/mod.ts";

// 플랫폼 필수 검사의 정의. runner의 불변 설치 자료이고 앱 bundle이 고칠 수 없다
// (problems/tests#R6). 검사마다 정의 digest가 있고 test 자식은 관측 frame의
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
  "migration_empty",
  "migration_upgrade",
  "read_contract",
  "automation_scope",
  "adapter_isolation",
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
