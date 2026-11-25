import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";
import { mcpTrustSchema } from "../lophn-agent/mcp-settings.ts";
import { permissionModeSchema } from "../lophn-agent/turn-values.ts";
import { permissionRuleSchema } from "./permission-rules.ts";
import { recentDenialSchema, sessionGrantSchema } from "./session-grants.ts";

const permissionsErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

export const sessionPermissionsMcpServerSchema = z.strictObject({
  name: z.string().min(1),
  trust: mcpTrustSchema,
  enabled: z.boolean(),
});
export type SessionPermissionsMcpServer = z.infer<
  typeof sessionPermissionsMcpServerSchema
>;

export const sessionPermissionsLocalToolSchema = z.strictObject({
  name: z.string().min(1),
  path: z.string().min(1),
  sha256: z.string().min(1),
  trusted: z.boolean(),
});
export type SessionPermissionsLocalTool = z.infer<
  typeof sessionPermissionsLocalToolSchema
>;

export const sessionPermissionsOutputSchema = z.strictObject({
  session: idSchema("ses"),
  mode: permissionModeSchema,
  workspace_folders: z.array(z.string()),
  opened_folders: z.array(z.string()),
  floor_count: z.number().int().nonnegative(),
  global_rules: z.array(permissionRuleSchema),
  project_rules: z.array(permissionRuleSchema),
  session_grants: z.array(sessionGrantSchema),
  mcp_servers: z.array(sessionPermissionsMcpServerSchema),
  local_tools: z.array(sessionPermissionsLocalToolSchema),
  recent_denials: z.array(recentDenialSchema),
});
export type SessionPermissionsOutput = z.infer<
  typeof sessionPermissionsOutputSchema
>;

// `/permissions` 화면이 session의 현재 권한 상태를 한 번에 읽는다.
export const sessionPermissionsRead = defineMemory({
  resource: "permissions",
  method: "read",
  name: "ReadSessionPermissions",
  input: z.strictObject({ session: idSchema("ses") }),
  output: sessionPermissionsOutputSchema,
  reads: [
    { name: "sessions", id: (input) => input.session },
    "settings",
    "extension_settings",
  ],
  actors: ["user"],
  errors: [...permissionsErrors],
});

// `/permissions`에서 "이 대화 동안" 허락을 개별 해제한다.
export const sessionGrantRevoke = defineMemory({
  resource: "permissions",
  method: "revoke-grant",
  name: "RevokeSessionGrant",
  changes: [{ name: "sessions", id: (input) => input.session }],
  input: z.strictObject({
    session: idSchema("ses"),
    grant: z.string().min(1),
  }),
  output: z.strictObject({ revoked: z.boolean() }),
  actors: ["user"],
  errors: [...permissionsErrors],
});

// 로컬 tool 스크립트의 `(실제 경로, sha256)`을 신뢰 목록에 더한다(desktop 사람 전용).
export const localToolTrust = defineMemory({
  resource: "permissions",
  method: "trust-local-tool",
  name: "TrustLocalTool",
  changes: ["settings"],
  input: z.strictObject({
    path: z.string().min(1),
    sha256: z.string().min(1),
  }),
  output: z.strictObject({ trusted: z.boolean() }),
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

// 로컬 tool 스크립트를 신뢰 목록에서 뺀다(desktop 사람 전용).
export const localToolUntrust = defineMemory({
  resource: "permissions",
  method: "untrust-local-tool",
  name: "UntrustLocalTool",
  changes: ["settings"],
  input: z.strictObject({
    path: z.string().min(1),
  }),
  output: z.strictObject({ removed: z.boolean() }),
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

export const PERMISSIONS_VIEW_ROUTES = [
  sessionPermissionsRead,
  sessionGrantRevoke,
  localToolTrust,
  localToolUntrust,
] as const;
