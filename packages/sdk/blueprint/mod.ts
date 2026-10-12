// 공개 SDK. 정본 검증기는 contracts의 의존성 없는 blueprint.ts 하나다.
export type {
  AgentContextDeclaration,
  AnnotationTargetDeclaration,
  AppCommandUseDeclaration,
  AutomationDeclaration,
  AutomationWhen,
  Blueprint,
  BlueprintOptions,
  CommandDeclaration,
  CommandEffect,
  CommandRevertDeclaration,
  DocumentDeclaration,
  FormatRef,
  InputSchema,
  InputType,
  JsonObject,
  JsonValue,
  PermissionKind,
  PermissionRequirement,
  PermissionScope,
  ProblemCodeDeclaration,
  ScreenDeclaration,
  ScreenSize,
  SDKDependency,
  ValidationError,
  ValidationResult,
} from "../../protocol/apps/blueprint.ts";
export {
  canonicalInputHash,
  validateBlueprint,
  validateInput,
} from "../../protocol/apps/blueprint.ts";
export { defineAgentContext, defineBlueprint } from "./define.ts";
