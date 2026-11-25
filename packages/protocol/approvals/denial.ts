import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { permissionModeSchema } from "../lophn-agent/turn-values.ts";

// 판정 엔진과 거부 계약이 쓰는 범주·사유·복구 동작이다.
export const PERMISSION_CATEGORIES = [
  "shell",
  "file_read",
  "file_write",
  "file_outside",
  "file_sensitive",
  "app_tool",
  "mcp_tool",
  "local_tool",
  "setting",
  "project_command",
  "project_command_definition",
  "web",
  "extension_tool",
  "other",
] as const;
export const permissionCategorySchema = z.enum(PERMISSION_CATEGORIES);
export type PermissionCategory = z.infer<typeof permissionCategorySchema>;

export const DENY_REASON_KINDS = [
  "floor",
  "user_deny",
  "mode",
  "scope",
  "unassigned",
  "removed",
  "untrusted",
  "no_person",
  "locked",
  "policy",
] as const;
export const denyReasonKindSchema = z.enum(DENY_REASON_KINDS);
export type DenyReasonKind = z.infer<typeof denyReasonKindSchema>;

export const RECOVERY_ACTION_KINDS = [
  "none",
  "edit_rule",
  "assign_app",
  "change_mode",
  "trust_local_tool",
  "trust_mcp",
  "add_allow_rule",
  "sign_in_mcp",
] as const;
export const recoveryActionKindSchema = z.enum(RECOVERY_ACTION_KINDS);
export type RecoveryActionKind = z.infer<typeof recoveryActionKindSchema>;

export const recoveryActionSchema = z.strictObject({
  kind: recoveryActionKindSchema,
  label: z.string().min(1).optional(),
  app: idSchema("app").optional(),
  server: z.string().min(1).optional(),
  tool_path: z.string().min(1).optional(),
  sha256: z.string().min(1).optional(),
  suggested_mode: permissionModeSchema.optional(),
  suggested_pattern: z.string().min(1).optional(),
  category: permissionCategorySchema.optional(),
});
export type RecoveryAction = z.infer<typeof recoveryActionSchema>;

// 권한·범위·모드·정책 거부의 구조화 계약이다. model과 사람 화면(PermissionDenied event, /permissions)이 같은 모양을 쓴다.
export const permissionDenialSchema = z.strictObject({
  tool: z.string().min(1),
  category: permissionCategorySchema,
  target_summary: z.string().min(1),
  reason_kind: denyReasonKindSchema,
  rule_pattern: z.string().nullable(),
  message: z.string().min(1),
  recovery_hint: z.string().nullable(),
  recovery_action: recoveryActionSchema.nullable(),
});
export type PermissionDenial = z.infer<typeof permissionDenialSchema>;

// OS sandbox 격리 슬롯. 이번 판은 none만 둔다.
export const ISOLATION_BACKENDS = ["none"] as const;
export const isolationBackendSchema = z.enum(ISOLATION_BACKENDS);
export type IsolationBackend = z.infer<typeof isolationBackendSchema>;
