import { z } from "zod";
import { idSchema, sha256Schema } from "../server/mod.ts";
import { hostOf } from "./blueprint-scope.ts";

// blueprint.permissions에는 이 중 fs·net·secret·document만 들어간다.
// app.call·agent.commands·automation.run은 Grant scope이며 blueprint 요구가 아니다.
export const PERMISSION_KINDS = [
  "fs.read",
  "fs.write",
  "net.fetch",
  "net.listen",
  "secret.use",
  "document.save",
  "app.call",
  "agent.commands",
  "automation.run",
] as const;

export const permissionKindSchema = z.enum(PERMISSION_KINDS);
export type GrantPermissionKind = z.infer<typeof permissionKindSchema>;

const LISTEN_HOSTS = ["localhost", "127.0.0.1", "::1"] as const;

// lexical 절대 경로만 본다. realpath·보호 경로·OS 방향은 runtime이 검사한다.
const lexicalPathSchema = z.string().min(1).refine(
  (value) =>
    !/\p{Cc}/u.test(value) &&
    (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value) ||
      /^\\\\[^\\]+\\[^\\]+/.test(value)) &&
    !value.split(/[\\/]/).some((part) => part === "." || part === ".."),
  { message: "expected absolute lexical path" },
);

const hostnameSchema = z.string().refine(
  (value) => hostOf(value) === undefined,
  { message: "expected exact hostname, IPv4, or IPv6" },
);

const portSchema = z.number().int().min(1).max(65535);
const commandKeySchema = z.string().min(1).refine(
  (value) => !value.includes("*") && value.trim() === value,
  { message: "command key must be exact" },
);
const commandListSchema = z.array(commandKeySchema).min(1).refine(
  (values) => new Set(values).size === values.length,
  { message: "duplicate command" },
);

const fsScopeSchema = z.strictObject({
  path: lexicalPathSchema,
  recursive: z.boolean(),
});
const fetchScopeSchema = z.strictObject({
  host: hostnameSchema,
  port: portSchema,
});
const listenScopeSchema = z.strictObject({
  host: z.enum(LISTEN_HOSTS),
  port: portSchema,
});
const secretScopeSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9_.:-]+$/),
});
const documentScopeSchema = z.strictObject({
  key: z.string().min(1),
});
const appCallScopeSchema = z.strictObject({
  app: idSchema("app"),
  commands: commandListSchema,
});
const agentCommandsScopeSchema = z.strictObject({
  commands: commandListSchema,
});
const automationWhenSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("on_start") }),
  z.strictObject({
    kind: z.literal("interval"),
    interval_ms: z.number().int().min(60000).max(Number.MAX_SAFE_INTEGER),
  }),
]);
const automationRunScopeSchema = z.strictObject({
  automation: z.string().min(1),
  command: commandKeySchema,
  input_hash: sha256Schema,
  when: automationWhenSchema,
});

export const permissionScopeSchema = z.discriminatedUnion("kind", [
  fsScopeSchema.extend({ kind: z.literal("fs.read") }),
  fsScopeSchema.extend({ kind: z.literal("fs.write") }),
  fetchScopeSchema.extend({ kind: z.literal("net.fetch") }),
  listenScopeSchema.extend({ kind: z.literal("net.listen") }),
  secretScopeSchema.extend({ kind: z.literal("secret.use") }),
  documentScopeSchema.extend({ kind: z.literal("document.save") }),
  appCallScopeSchema.extend({ kind: z.literal("app.call") }),
  agentCommandsScopeSchema.extend({ kind: z.literal("agent.commands") }),
  automationRunScopeSchema.extend({ kind: z.literal("automation.run") }),
]);
export type GrantPermissionScope = z.infer<typeof permissionScopeSchema>;

export const permissionRequirementSchema = z.strictObject({
  kind: z.enum([
    "fs.read",
    "fs.write",
    "net.fetch",
    "net.listen",
    "secret.use",
    "document.save",
  ]),
  scope: z.union([
    fsScopeSchema,
    fetchScopeSchema,
    listenScopeSchema,
    secretScopeSchema,
    documentScopeSchema,
  ]),
  reason: z.string().min(1),
}).superRefine((value, context) => {
  const scopeKind = "path" in value.scope
    ? value.kind.startsWith("fs.")
    : "host" in value.scope
    ? value.kind.startsWith("net.")
    : "name" in value.scope
    ? value.kind === "secret.use"
    : value.kind === "document.save";
  if (!scopeKind) {
    context.addIssue({
      code: "custom",
      message: "permission scope does not match kind",
    });
  }
  if (value.kind === "net.listen" && "host" in value.scope) {
    if (
      !LISTEN_HOSTS.includes(value.scope.host as typeof LISTEN_HOSTS[number])
    ) {
      context.addIssue({
        code: "custom",
        message: "listen host is not loopback",
      });
    }
  }
});
export type GrantPermissionRequirement = z.infer<
  typeof permissionRequirementSchema
>;
