import { z } from "zod";
import { canonicalize } from "../../base/mod.ts";
import { actorSchema } from "../base/actor.ts";
import { idSchema } from "../base/ids.ts";
import { type JsonObject, jsonObjectSchema } from "../base/json-values.ts";
import { atSchema, sha256Schema } from "../base/values.ts";

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
  operations: z
    .array(z.string().min(1))
    .refine((values) => new Set(values).size === values.length, {
      message: "duplicate operation",
    }),
  targets: credentialTargetsSchema,
};

export const credentialScopeSchema = z.strictObject(credentialScopeFields);
export type CredentialScope = z.infer<typeof credentialScopeSchema>;

export const credentialConditionsSchema = z.strictObject({
  // lophn agent credential이 묶이는 session과 그 안에서 도는 turn.
  session: idSchema("ses").optional(),
  turn: idSchema("trn").optional(),
  app: idSchema("app").optional(),
  // project place의 agent가 그 project 하나에 묶인 자격이다.
  project: idSchema("prj").optional(),
  release: idSchema("rel").optional(),
  process: z.string().min(1).optional(),
  mode: z.string().min(1).optional(),
  task: z.string().min(1).optional(),
  // 준비 전 bundle의 preview는 release 없이 bundle hash로 고정한다.
  bundle_hash: sha256Schema.nullable().optional(),
  // 앱 place run이 이번 handoff에서 읽을 수 있는 고정 근거(문서, 판) 목록이다. 발급 때 core가 run의
  // handoff 출처 참조에서 정하며 child 요청 값이 아니다. 이 목록의 판만 담당 앱 밖에서도 판 주소로 열린다.
  evidence: z
    .array(
      z.strictObject({
        document: idSchema("doc"),
        version: idSchema("ver"),
      }),
    )
    .optional(),
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
