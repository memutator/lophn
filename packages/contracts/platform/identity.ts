import { z } from "zod";
import { actorSchema } from "./actor.ts";
import { idSchema } from "./ids.ts";
import { atSchema } from "./values.ts";

// 대상 범위의 내용은 소유 concern이 검사한다. platform은 JSON 경계만 정한다.
export const credentialScopeSchema = z.strictObject({
  operations: z.array(z.string().min(1)).refine(
    (values) => new Set(values).size === values.length,
    { message: "duplicate operation" },
  ),
  targets: z.record(z.string(), z.json()),
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
