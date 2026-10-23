// 공개 SDK. 정본 검증기는 protocol/apps/declaration의 의존성 없는 파일들이다.
export type {
  AppDeclaration,
  AppToolUseDeclaration,
  DeclarationOptions,
  InputSchema,
  InputType,
  JsonObject,
  JsonValue,
  OAuthDeclaration,
  PermissionKind,
  PermissionRequirement,
  PermissionScope,
  ScreenDeclaration,
  ScreenSize,
  SDKDependency,
  ToolDeclaration,
  ToolEffect,
  ValidationError,
  ValidationResult,
} from "../../protocol/apps/declaration/mod.ts";
export {
  canonicalInputHash,
  validateDeclaration,
  validateInput,
} from "../../protocol/apps/declaration/mod.ts";
export { defineApp } from "./define.ts";
