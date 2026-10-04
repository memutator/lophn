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
export const credentialScopeSchema = z.strictObject({
  operations: z.array(z.string().min(1)).refine(
    (values) => new Set(values).size === values.length,
    { message: "duplicate operation" },
  ),
  targets: credentialTargetsSchema,
});
export type CredentialScope = z.infer<typeof credentialScopeSchema>;

export const credentialConditionsSchema = z.strictObject({
  run: idSchema("run").optional(),
  assignment: idSchema("asg").optional(),
  app: idSchema("app").optional(),
  release: idSchema("rel").optional(),
  process: z.string().min(1).optional(),
  mode: z.string().min(1).optional(),
  task: z.string().min(1).optional(),
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
