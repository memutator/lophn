// MCP·CLI가 같은 대상 앱 순서를 쓰는 공통 찾기(connection#R11).
// 명시 선택 → 앱 환경 설정 → 현재 작업 폴더의 blueprint.
// 발견한 앱은 connection scope와 다시 비교해 범위 밖이면 거절이다.
import { err, ok, type Result } from "../../../base/mod.ts";
import { validateBlueprint } from "../../../contracts/apps/mod.ts";
import type {
  Blueprint,
  ValidationResult,
} from "../../../contracts/apps/mod.ts";
import type { ConnectionScope } from "../../../contracts/coding-agent/mod.ts";

export const LOPHN_APP = "LOPHN_APP";

export type TargetAppSource = "option" | "env" | "blueprint";

export type TargetApp = {
  app: string;
  source: TargetAppSource;
};

// app scope 연결은 그 앱 하나만 본다. all은 앱 대상을 좁히지 않는다.
export function scopeAllows(scope: ConnectionScope, app: string): boolean {
  if (scope.kind === "all") return true;
  return scope.kind === "app" && scope.app === app;
}

// 발견한 앱을 connection scope와 다시 비교한다. 범위 밖이면 거절(R11).
export function withinScope(
  target: TargetApp,
  scope: ConnectionScope,
): Result<TargetApp> {
  if (!scopeAllows(scope, target.app)) {
    return err({
      code: "forbidden",
      message: "대상 앱이 connection scope 밖이다",
    });
  }
  return ok(target);
}

function acceptApp(value: string | undefined): Result<string> {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === "") {
    return err({ code: "invalid_input", message: "대상 앱이 비어 있다" });
  }
  return ok(trimmed);
}

// 현재 작업 폴더의 blueprint 검사 결과. 정규형은 apps blueprint 검증기가 만든다.
export function blueprintValidation(
  value: unknown,
): ValidationResult<Blueprint> {
  return validateBlueprint(value);
}

export type TargetAppInputs = {
  option?: string;
  env?: string;
  // 현재 작업 폴더 안 blueprint.json의 원문 값.
  blueprintValue?: unknown;
};

function explicitResult(
  value: string | undefined,
  source: TargetAppSource,
): Result<TargetApp> {
  const found = acceptApp(value);
  return found.ok ? ok({ app: found.value, source }) : found;
}

// 순서는 명시 선택 → 앱 환경 설정 → 현재 작업 폴더의 blueprint다.
// blueprint는 등록 App의 source_path와 같은 폴더 기준으로 읽은 값이다.
export function resolveTargetApp(
  inputs: TargetAppInputs,
): Result<TargetApp> {
  if (inputs.option !== undefined) {
    return explicitResult(inputs.option, "option");
  }
  if (inputs.env !== undefined) return explicitResult(inputs.env, "env");
  if (inputs.blueprintValue !== undefined) {
    const parsed = blueprintValidation(inputs.blueprintValue);
    if (!parsed.ok) {
      return err({
        code: "not_found",
        message: "현재 작업 폴더의 blueprint가 올바르지 않다",
      });
    }
    return ok({ app: parsed.value.name, source: "blueprint" });
  }
  return err({ code: "not_found", message: "대상 앱을 찾을 단서가 없다" });
}
