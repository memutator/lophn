import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { toolKeySchema } from "./channel-values.ts";
import { hostOf, oauthScope } from "./declaration/scope.ts";

// declaration.permissions에는 이 중 fs·net·secret·document만 들어간다.
// app.call·agent.commands는 Grant scope이며 선언 요구가 아니다.

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
const uniqueList = <T extends z.ZodType<string>>(item: T) =>
  z.array(item).min(1).refine(
    (values) => new Set(values).size === values.length,
    { message: "duplicate key" },
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
// 규칙은 declaration/scope.ts의 oauthScope 하나다. 저장된 값은 이미 정규화돼 있어 여기서 고치지 않는다.
const oauthSchema = z.strictObject({
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  scopes: z.array(z.string()),
  params: z.record(z.string(), z.string()).optional(),
}).superRefine((value, context) => {
  const checked = oauthScope(value);
  if (!checked.ok) {
    context.addIssue({ code: "custom", message: checked.error.message });
  }
});
const secretScopeSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9_.:-]+$/),
  oauth: oauthSchema.optional(),
});
const documentScopeSchema = z.strictObject({
  key: z.string().min(1),
});
const appCallScopeSchema = z.strictObject({
  app: idSchema("app"),
  app_tools: uniqueList(toolKeySchema),
});

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

// 앱 grant의 kind. activation 한 번에 만든다. 옛 PERMISSION_KINDS는 옛 Grant가 쓴다.

export const appGrantScopeSchema = z.discriminatedUnion("kind", [
  fsScopeSchema.extend({ kind: z.literal("fs.read") }),
  fsScopeSchema.extend({ kind: z.literal("fs.write") }),
  fetchScopeSchema.extend({ kind: z.literal("net.fetch") }),
  listenScopeSchema.extend({ kind: z.literal("net.listen") }),
  secretScopeSchema.extend({ kind: z.literal("secret.use") }),
  appCallScopeSchema.extend({ kind: z.literal("app.call") }),
]);
export type AppGrantScope = z.infer<typeof appGrantScopeSchema>;
