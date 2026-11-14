import { z } from "zod";
import { defineMemory } from "../../base/route.ts";
import { appIdSchema } from "../../projects/values.ts";
import { secretNameSchema } from "../../secrets/secrets.ts";
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

// 호출 대상은 operation이거나 command이다. 이름은 둘을 합쳐 하나라 `kind`는 어느 쪽 선언을 볼지 정한다.
// operation은 사람(화면)과 그 앱 workspace의 session(preview)만 부른다. agent(live)·다른 앱·job·flow가 부르면
// core가 handler에 보내기 전에 denied로 막는다.
// 규칙(core가 판정한다).
// - caller.kind는 route의 actor와 맞아야 한다(user는 person, agent는 agent, app은 app).
//   맞지 않으면 forbidden이다. program과 flow는 route의 actor가 아니고 core 안 run 연산만 만든다(route로 오면 forbidden).
// - app은 live이고 release가 null이다. agent는 live(release null)이거나, 그 앱 workspace의 session이면 그 앱의 preview다.
export const callKindSchema = z.enum(["operation", "command"]);
export type CallKind = z.infer<typeof callKindSchema>;

const toolCallInputSchema = z.strictObject({
  target: appToolTargetSchema,
  kind: callKindSchema,
  name: toolNameSchema,
  input: jsonValueSchema.optional(),
  caller: appToolCallerSchema,
});
export type ToolCallInput = z.infer<typeof toolCallInputSchema>;

// handler까지 가지 못한 이유. Gate 막음(operation을 부를 수 없는 caller 포함), 호출 루프·깊이, 앱 멈춤.
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
    // 이 호출이 값이나 sign-in이 없는 secret을 쓰려다 실패했으면 그 자리다. 앱이 쓴 글이 아니라 core가 `apps.secret_value`에서 본 것이다.
    missing: z
      .array(z.strictObject({ app: appIdSchema, secret: secretNameSchema }))
      .optional(),
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
  changes: [{ name: "app_activity", id: (input) => input.target.app }],
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
