// 공개 SDK. 정본 검증기는 protocol/apps/blueprint의 의존성 없는 파일들이다.
export type {
  AppApiDeclaration,
  AppApiEffect,
  AppApiUseDeclaration,
  Blueprint,
  BlueprintOptions,
  InputSchema,
  InputType,
  JsonObject,
  JsonValue,
  PermissionKind,
  PermissionRequirement,
  PermissionScope,
  ScreenDeclaration,
  ScreenSize,
  SDKDependency,
  ValidationError,
  ValidationResult,
} from "../../protocol/apps/blueprint/mod.ts";
export {
  canonicalInputHash,
  validateBlueprint,
  validateInput,
} from "../../protocol/apps/blueprint/mod.ts";
export { defineBlueprint } from "./define.ts";

// 임시: sdk/ui-action/use-command.ts가 아직 이 type을 import한다. app-calls-shell이 옮기면 지운다.
export type { CommandDeclaration } from "../../protocol/apps/blueprint.ts";
