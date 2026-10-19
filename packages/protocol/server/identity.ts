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
  operations: z.array(z.string().min(1)).refine(
    (values) => new Set(values).size === values.length,
    { message: "duplicate operation" },
  ),
  targets: credentialTargetsSchema,
};

export const credentialScopeSchema = z.strictObject(credentialScopeFields);
export type CredentialScope = z.infer<typeof credentialScopeSchema>;

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
  // lophn agent credential이 묶이는 session과 그 안에서 도는 turn.
  session: idSchema("ses").optional(),
  turn: idSchema("trn").optional(),
  app: idSchema("app").optional(),
  // project place의 agent(PM, Operator)가 그 project 하나에 묶인 자격이다.
  project: idSchema("prj").optional(),
  release: idSchema("rel").optional(),
  process: z.string().min(1).optional(),
  mode: z.string().min(1).optional(),
  task: z.string().min(1).optional(),
  // 발급 때 고정한 보고 위치 근거. collector가 보고할 때 credential 대상으로 쓴다.
  bundle_hash: sha256Schema.nullable().optional(),
  diagnostic_scope: z.string().regex(/\S/).nullable().optional(),
  // coding agent의 현재 위치 근거. 인증 경계가 연결·session 기록에서 정하며 요청 body·header 값이 아니다.
  cwd: cwdConditionSchema.optional(),
  // Project Manager run이 이번 handoff에서 읽을 수 있는 고정 근거(문서, 판) 목록이다. 발급 때 core가 run의
  // handoff 출처 참조에서 정하며 child 요청 값이 아니다. 이 목록의 판만 담당 앱 밖에서도 판 주소로 열린다.
  evidence: z.array(z.strictObject({
    document: idSchema("doc"),
    version: idSchema("ver"),
  })).optional(),
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
