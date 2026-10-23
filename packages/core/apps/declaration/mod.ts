// 앱 안 선언 자리. 정본 검증기를 그대로 다시 내보낸다.
export type {
  AppDeclaration,
  AppToolUseDeclaration,
  DeclarationOptions,
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
  ToolDeclaration,
  ToolEffect,
  ValidationError,
  ValidationResult,
} from "../../../protocol/apps/declaration/mod.ts";
export {
  canonicalInputHash,
  canonicalJson,
  validateDeclaration,
  validateInput,
} from "../../../protocol/apps/declaration/mod.ts";
