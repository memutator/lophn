import { z } from "zod";
import { defineMemory } from "../../base/route.ts";
import { appIdSchema, projectIdSchema } from "../../projects/values.ts";
import {
  commandKeySchema,
  invocationIdSchema,
  jsonValueSchema,
  processNonceSchema,
  releaseIdSchema,
} from "../channel-values.ts";
import { appApiCallerSchema } from "./caller.ts";

export const appApiKeySchema = commandKeySchema;

// live의 release가 null이면 지금 활성 release다.
export const appApiTargetSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("live"),
    app: appIdSchema,
    release: releaseIdSchema.nullable(),
  }),
  z.strictObject({
    mode: z.literal("preview"),
    app: appIdSchema,
    process_nonce: processNonceSchema,
  }),
]);
export type AppApiTarget = z.infer<typeof appApiTargetSchema>;

// 규칙(core가 판정한다).
// - caller.kind는 route의 actor와 맞아야 한다(user는 person, agent는 agent, app은 app).
//   맞지 않으면 forbidden이다.
// - agent와 app은 target.mode가 live이고 release가 null이다.
// - app은 project를 싣지 않는다. core가 부른 invocation의 project를 넘긴다.
// - project에 놓인 agent가 project를 싣고 놓인 project와 다르면 conflict다.
export const appApiCallInputSchema = z.strictObject({
  target: appApiTargetSchema,
  api: appApiKeySchema,
  input: jsonValueSchema.optional(),
  project: projectIdSchema.nullable().optional(),
  caller: appApiCallerSchema,
});
export type AppApiCallInput = z.infer<typeof appApiCallInputSchema>;

// handler까지 가지 못한 이유. Gate 막음, 사람 거절, 호출 루프·깊이, project 규칙 위반, 앱 멈춤.
export const APP_API_DENIAL_CODES = [
  "gate_blocked",
  "rejected",
  "cancelled",
  "call_loop",
  "call_too_deep",
  "project_required",
  "project_mismatch",
  "project_not_found",
  "app_archived",
  "app_unavailable",
  "not_declared",
] as const;
export const appApiDenialSchema = z.strictObject({
  code: z.enum(APP_API_DENIAL_CODES),
  message: z.string(),
});
export type AppApiDenial = z.infer<typeof appApiDenialSchema>;

export const APP_API_UNKNOWN_REASONS = [
  "unavailable",
  "connection_lost",
  "core_restarted",
  "timeout",
] as const;

export const appApiOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("succeeded"), result: jsonValueSchema }),
  // 앱 handler가 낸 오류.
  z.strictObject({
    status: z.literal("failed"),
    error: z.strictObject({ code: z.string(), message: z.string() }),
  }),
  // handler까지 가지 못했다.
  z.strictObject({
    status: z.literal("denied"),
    denial: appApiDenialSchema,
  }),
  // 결과를 모른다.
  z.strictObject({
    status: z.literal("unknown"),
    reason: z.enum(APP_API_UNKNOWN_REASONS),
  }),
]);
export type AppApiOutcome = z.infer<typeof appApiOutcomeSchema>;

// invocation은 기록을 남기지 않은 성공한 읽기에서만 null이다.
export const appApiCallOutputSchema = z.strictObject({
  invocation: invocationIdSchema.nullable(),
  outcome: appApiOutcomeSchema,
});
export type AppApiCallOutput = z.infer<typeof appApiCallOutputSchema>;

export const appCallApi = defineMemory({
  resource: "apps",
  method: "call_api",
  name: "app.call_api",
  input: appApiCallInputSchema,
  output: appApiCallOutputSchema,
  actors: ["user", "agent", "app"],
  errors: [
    "invalid_input",
    "forbidden",
    "unauthorized",
    "not_found",
    "unavailable",
  ],
});
