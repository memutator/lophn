import { z } from "zod";
import { defineSetting, sha256Schema } from "../platform/mod.ts";

const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonempty = z.string().regex(/\S/);
const nameSchema = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
const effectSchema = z.enum(["read", "write", "external"]);

const secretRef = z.string().regex(/^sec:[A-Za-z0-9_.:-]{1,200}$/);
const plainOrSecret = z.union([
  z.strictObject({ kind: z.literal("value"), value: z.string() }),
  z.strictObject({ kind: z.literal("secret_ref"), secret_ref: secretRef }),
]);

const headerName = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);

export const mcpAuthSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({ kind: z.literal("bearer"), secret_ref: secretRef }),
  z.strictObject({
    kind: z.literal("api_key"),
    secret_ref: secretRef,
    header_name: headerName,
  }),
  z.strictObject({
    kind: z.literal("oauth2"),
    issuer: z.string().regex(/^https:\/\/\S+$/),
    client_id: nonempty.max(200),
    client_secret_ref: secretRef.nullable(),
    scopes: z.array(nonempty.max(128)).max(32),
    token_ref: secretRef.nullable(),
  }),
]);

const stdioSchema = z.strictObject({
  executable: z.string().regex(/^(\/|[A-Za-z]:\\).+/),
  args: z.array(z.string()).max(64),
  cwd: z.string().regex(/^(\/|[A-Za-z]:\\).+/).nullable(),
  env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), plainOrSecret),
});

const httpSchema = z.strictObject({
  url: z.string().regex(
    /^(https:\/\/\S+|http:\/\/(127\.0\.0\.1|\[::1\])(:\d+)?(\/\S*)?)$/,
  ),
  headers: z.record(headerName, plainOrSecret),
  auth: mcpAuthSchema,
});

export const mcpToolClassificationSchema = z.strictObject({
  effect: effectSchema,
  schema_hash: sha256Schema,
  reversible: z.boolean(),
});

const serverFields = {
  name: nameSchema,
  revision,
  enabled: z.boolean(),
  call_timeout_ms: z.number().int().min(1000).max(600_000),
  classifications: z.record(nonempty, mcpToolClassificationSchema),
};

export const mcpServerConfigSchema = z.discriminatedUnion("transport", [
  z.strictObject({
    ...serverFields,
    transport: z.literal("stdio"),
    stdio: stdioSchema,
  }),
  z.strictObject({
    ...serverFields,
    transport: z.literal("http"),
    http: httpSchema,
  }),
]);
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

export const extensionSettingsSchema = z.strictObject({
  revision,
  registered_folders: z.array(z.string().regex(/^(\/|[A-Za-z]:\\).+/)).max(64),
  mcp_servers: z.array(mcpServerConfigSchema).max(32),
}).refine(
  (value) =>
    new Set(value.mcp_servers.map((server) => server.name)).size ===
      value.mcp_servers.length,
  { message: "mcp server names must be unique" },
);

export const mcpServersSetting = defineSetting({
  key: "lophn-agent.extensions.mcp_servers",
  owner: "lophn-agent/extensions",
  display_name_key: "settings.lophn-agent.mcp_servers.name",
  description: "Registered external MCP servers.",
  value_meaning_key: "settings.lophn-agent.mcp_servers.value",
  default_meaning_key: "settings.lophn-agent.mcp_servers.default",
  affected_features: ["lophn-agent/extensions"],
  risk_key: "settings.lophn-agent.mcp_servers.risk",
  revert_key: "settings.lophn-agent.mcp_servers.revert",
  constraints: {
    transports: ["stdio", "http"],
    auth: ["none", "bearer", "api_key", "oauth2"],
    call_timeout_ms: { min: 1000, max: 600_000, default: 60_000 },
    tool_effects: ["read", "write", "external"],
  },
  required: false,
  layers: ["common"],
  apply_at: "next_run",
  apply_at_key: "settings.lophn-agent.mcp_servers.apply_at",
  machine_local: true,
  default_present: true,
  default: [],
  value_type: z.array(mcpServerConfigSchema).max(32),
});
