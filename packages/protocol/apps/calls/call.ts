import { z } from "zod";
import { defineMemory } from "../../base/route.ts";
import { appIdSchema } from "../../projects/values.ts";
import {
  invocationIdSchema,
  jsonValueSchema,
  processNonceSchema,
  releaseIdSchema,
  toolNameSchema,
} from "../channel-values.ts";
import { appToolCallerSchema } from "./caller.ts";

// live의 release가 null이면 지금 활성 release다.
export const appToolTargetSchema = z.discriminatedUnion("mode", [
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
export type AppToolTarget = z.infer<typeof appToolTargetSchema>;

// 규칙(core가 판정한다).
// - caller.kind는 route의 actor와 맞아야 한다(user는 person, agent는 agent, app은 app).
//   맞지 않으면 forbidden이다. program과 flow는 route의 actor가 아니고 core 안 run 연산만 만든다(route로 오면 forbidden).
// - app은 live이고 release가 null이다. agent는 live(release null)이거나, 그 앱 place의 session이면 그 앱의 preview다.
const toolCallInputSchema = z.strictObject({
  target: appToolTargetSchema,
  tool: toolNameSchema,
  input: jsonValueSchema.optional(),
  caller: appToolCallerSchema,
});
export type ToolCallInput = z.infer<typeof toolCallInputSchema>;

// handler까지 가지 못한 이유. Gate 막음, 호출 루프·깊이, 앱 멈춤.
const TOOL_DENIAL_CODES = [
  "gate_blocked",
  "call_loop",
  "call_too_deep",
  "app_archived",
  "app_unavailable",
  "not_declared",
] as const;
const toolDenialSchema = z.strictObject({
  code: z.enum(TOOL_DENIAL_CODES),
  message: z.string(),
});
export type ToolDenial = z.infer<typeof toolDenialSchema>;

const TOOL_UNKNOWN_REASONS = [
  "unavailable",
  "connection_lost",
  "core_restarted",
  "timeout",
] as const;

const toolOutcomeSchema = z.discriminatedUnion("status", [
  z.strictObject({ status: z.literal("succeeded"), result: jsonValueSchema }),
  // 앱 handler가 낸 오류.
  z.strictObject({
    status: z.literal("failed"),
    error: z.strictObject({ code: z.string(), message: z.string() }),
  }),
  // handler까지 가지 못했다.
  z.strictObject({
    status: z.literal("denied"),
    denial: toolDenialSchema,
  }),
  // 결과를 모른다.
  z.strictObject({
    status: z.literal("unknown"),
    reason: z.enum(TOOL_UNKNOWN_REASONS),
  }),
]);
export type ToolOutcome = z.infer<typeof toolOutcomeSchema>;

// invocation은 기록을 남기지 않은 성공한 읽기에서만 null이다.
export const toolCallOutputSchema = z.strictObject({
  invocation: invocationIdSchema.nullable(),
  outcome: toolOutcomeSchema,
});
export type ToolCallOutput = z.infer<typeof toolCallOutputSchema>;

export const appCallTool = defineMemory({
  resource: "apps",
  method: "call_tool",
  name: "app.call_tool",
  input: toolCallInputSchema,
  output: toolCallOutputSchema,
  actors: ["user", "agent", "app"],
  errors: [
    "invalid_input",
    "forbidden",
    "unauthorized",
    "not_found",
    "unavailable",
  ],
});
