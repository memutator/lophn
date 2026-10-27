import { z } from "zod";
import { actorSchema } from "../../base/actor.ts";
import { withReadCommon } from "../../base/envelope.ts";
import { idSchema } from "../../base/ids.ts";
import { defineMemory, defineRead } from "../../base/route.ts";
import { atSchema } from "../../base/values.ts";
import { appIdSchema } from "../../projects/values.ts";
import { invocationIdSchema, releaseIdSchema } from "../channel-values.ts";
import { appToolCallerSchema } from "./caller.ts";
import {
  appInvocationOperationSchema,
  invocationEffectSchema,
} from "./invocation.ts";

// blob store 참조. 저장 방식은 app-calls-invocations가 정한다.

// external은 되돌아가지 않는 바깥 효과가 있다는 표시이고, 그 invocation의 DB 변경은 reverts_db로 되돌아간다.
const rewindPlanItemSchema = z.strictObject({
  invocation: invocationIdSchema,
  started_at: atSchema,
  operation: appInvocationOperationSchema,
  caller: appToolCallerSchema.nullable(),
  effect: invocationEffectSchema,
  reverts_db: z.boolean(),
  external: z.boolean(),
  running: z.boolean(),
});
export type RewindPlanItem = z.infer<typeof rewindPlanItemSchema>;

// blocked는 범위 안에 결과 모르는 write·external·앱 시작이 changeset 없이 닫혀 있는 경우다.
const rewindPlanSchema = z.strictObject({
  app: appIdSchema,
  release: releaseIdSchema,
  from_invocation: invocationIdSchema,
  items: z.array(rewindPlanItemSchema),
  blocked: z
    .strictObject({
      reason: z.literal("unrecoverable_write"),
      invocation: invocationIdSchema,
    })
    .nullable(),
});
export type RewindPlan = z.infer<typeof rewindPlanSchema>;

export const rewindSchema = z.strictObject({
  id: idSchema("rwd"),
  app: appIdSchema,
  release: releaseIdSchema,
  from_invocation: invocationIdSchema,
  requested_by: actorSchema,
  status: z.enum(["applying", "applied", "cancelled"]),
  reason: z
    .strictObject({
      code: z.enum(["conflict", "app_unavailable", "core_restarted"]),
      message: z.string(),
    })
    .nullable(),
  // 되돌린 목록.
  invocations: z.array(invocationIdSchema),
  started_at: atSchema,
  finished_at: atSchema.nullable(),
});
export type Rewind = z.infer<typeof rewindSchema>;

const rewindTargetFields = {
  app: appIdSchema,
  from_invocation: invocationIdSchema,
};

// 고를 수 없는 것(preview, 이전 release, data_change, 이미 되돌림)은 invalid_input이다.
export const appRewindPlan = defineRead({
  resource: "apps",
  method: "rewind_plan",
  name: "app.rewind_plan",
  input: z.strictObject(rewindTargetFields),
  output: withReadCommon(z.object({ plan: rewindPlanSchema })),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

// 앱 rewind는 사람만 한다.
// 유예 대기와 앱 process apply가 async라 memory route다. 기록은 rewind module이 자기 쓰기로 남긴다.
export const appRewind = defineMemory({
  resource: "apps",
  method: "rewind",
  name: "app.rewind",
  input: z.strictObject(rewindTargetFields),
  output: rewindSchema,
  actors: ["user"],
  errors: [
    "forbidden",
    "invalid_input",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

const appRewindsInputSchema = z.strictObject({
  app: appIdSchema,
  invocation: invocationIdSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
export const appRewinds = defineRead({
  resource: "apps",
  method: "rewinds",
  name: "app.rewinds",
  input: appRewindsInputSchema,
  output: withReadCommon(z.object({ rewinds: z.array(rewindSchema) })),
  actors: ["user", "coding_agent", "agent", "machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});
