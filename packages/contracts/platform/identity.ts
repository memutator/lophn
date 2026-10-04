import { z } from "zod";
import { canonicalize } from "../../base/mod.ts";
import { actorSchema } from "./actor.ts";
import { idSchema } from "./ids.ts";
import { type JsonObject, jsonObjectSchema } from "./json-values.ts";
import { atSchema } from "./values.ts";

// 발급 때 고정한 target이 caller mutation으로 바뀌지 않게 own key를 보존하며 복사한다.
const credentialTargetsSchema = jsonObjectSchema.transform((value, ctx) => {
  try {
    return JSON.parse(canonicalize(value)) as JsonObject;
  } catch {
    ctx.addIssue({ code: "custom", message: "expected canonical JSON object" });
    return z.NEVER;
  }
});

// 대상 범위의 내용은 소유 concern이 검사한다. platform은 JSON 경계만 정한다.
const credentialScopeFields = {
  operations: z.array(z.string().min(1)).refine(
    (values) => new Set(values).size === values.length,
    { message: "duplicate operation" },
  ),
  targets: credentialTargetsSchema,
};

export const credentialScopeSchema = z.strictObject(credentialScopeFields);
export type CredentialScope = z.infer<typeof credentialScopeSchema>;

// agent credential만 싣는다. 내용은 lophn-agent의 AgentAppScope이며 platform은 해석하지
// 않고 발급 뒤 상한을 넓히지 못하게만 한다(domain-model platform/identity CredentialScope).
// scope.ts를 여기서 import하면 contracts 순환이 되므로 모양만 받고 검증은 발급 경계가 한다.
export const agentCredentialScopeSchema = z.strictObject({
  ...credentialScopeFields,
  agent: z.object({
    role: z.string(),
    assignment: idSchema("asg"),
    apps: z.array(z.object({}).catchall(z.unknown())),
  }).optional(),
});

// OS의 realpath 판정은 host에 남기고 정규 절대 경로 모양만 검사한다.
const cwdConditionSchema = z.string().min(1).refine(
  (value) =>
    !/\p{Cc}/u.test(value) &&
    (/^\//.test(value) || /^[A-Za-z]:[\\/]/.test(value) ||
      /^\\\\[^\\]+\\[^\\]+/.test(value)) &&
    !value.split(/[\\/]/).some((part) => part === "." || part === ".."),
  { message: "expected normalized absolute path" },
);

export const credentialConditionsSchema = z.strictObject({
  run: idSchema("run").optional(),
  assignment: idSchema("asg").optional(),
  app: idSchema("app").optional(),
  release: idSchema("rel").optional(),
  process: z.string().min(1).optional(),
  mode: z.string().min(1).optional(),
  task: z.string().min(1).optional(),
  // coding agent의 현재 위치 근거. 인증 경계가 연결·session 기록에서 정하며 요청 body·header 값이 아니다.
  cwd: cwdConditionSchema.optional(),
});
export type CredentialConditions = z.infer<typeof credentialConditionsSchema>;

// credential_ref는 인증 경계가 만든 불투명 참조이며 Bearer 값이 아니다.
export const authenticatedContextSchema = z.strictObject({
  principal: z.string().min(1),
  actor: actorSchema,
  scope: credentialScopeSchema,
  conditions: credentialConditionsSchema,
  credential_ref: z.string().min(1),
  expires_at: atSchema.optional(),
});
export type AuthenticatedContext = z.infer<typeof authenticatedContextSchema>;
