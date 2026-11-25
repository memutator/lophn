import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineMemory } from "../base/route.ts";
import { atSchema } from "../base/values.ts";
import { harnessIdSchema } from "../coding-agent/harness-id.ts";
import {
  askedCallSchema,
  TURN_REQUEST_CHOICES,
  type TurnRequestChoiceKind,
  turnRequestChoiceKindSchema,
} from "./gate-call.ts";
import { shellPatternSchema } from "./shell-rules.ts";

export {
  TURN_REQUEST_CHOICES,
  type TurnRequestChoiceKind,
  turnRequestChoiceKindSchema,
};

// 하나 남는 묻는 길. turn 안에서 Gate가 ask를 냈을 때 메모리에 열리고 session snapshot에 든다.
// agent event(등록은 `packages/protocol/events/agent.ts`):
//   TurnRequestOpened { request: TurnRequest }
//   TurnRequestClosed { request: Id<"apr">, outcome: "allow" | "reject" | "cancelled" }
// session snapshot 칸: `turn_requests: TurnRequest[]`.

// 거절 이유는 요청한 agent에게 그대로 간다. 한 줄이다.
const rejectReasonSchema = z
  .string()
  .trim()
  .min(1)
  .max(500)
  .refine((value) => !/[\r\n]/.test(value), {
    message: "reject reason is one line",
  });

// 요청의 `allowed_choices`에 없는 선택지는 결정 handler가 invalid_input으로 거절한다.
export const turnRequestChoiceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("once") }),
  z.strictObject({ kind: z.literal("session") }),
  z.strictObject({ kind: z.literal("always") }),
  z.strictObject({
    kind: z.literal("reject"),
    reason: rejectReasonSchema.optional(),
  }),
]);
export type TurnRequestChoice = z.infer<typeof turnRequestChoiceSchema>;

// harness는 coding harness 물음을 비추기만 한다. 답은 터미널에서 한다
// (`coding-agent/hook-signal.ts`의 `request`와 같은 값).
const turnRequestSubjectSchema = z.discriminatedUnion("kind", [
  ...askedCallSchema.options,
  z.strictObject({
    kind: z.literal("harness"),
    harness: harnessIdSchema,
    tool: z.string().nullable(),
    summary: z.string().nullable(),
  }),
]);

// always_patterns는 always를 고르면 더해질 allow 규칙의 pattern이다. 카드는 이것을 그대로 보여 사람이
// 무엇을 허락하는지 안다. to_parent는 팀 자식의 request라 사람이 아니라 부모가 푼다는 표시다(once만).
export const turnRequestSchema = z.strictObject({
  id: idSchema("apr"),
  session: idSchema("ses"),
  turn: idSchema("trn"),
  tool_call: idSchema("tcl"),
  subject: turnRequestSubjectSchema,
  always_patterns: z.array(shellPatternSchema),
  allowed_choices: z.array(turnRequestChoiceKindSchema).min(1),
  reason: z.string().nullable(),
  outside_rewind: z.boolean(),
  to_parent: z.boolean(),
  created_at: atSchema,
});
export type TurnRequest = z.infer<typeof turnRequestSchema>;

// turn이 이어 가는 값. cancelled는 거절과 구별해 요청자에게 간다.
export const turnRequestOutcomeSchema = z.discriminatedUnion("outcome", [
  z.strictObject({
    outcome: z.literal("allow"),
    scope: z.enum(["once", "session", "always"]),
  }),
  z.strictObject({
    outcome: z.literal("reject"),
    reason: z.string().nullable(),
  }),
  z.strictObject({
    outcome: z.literal("cancelled"),
    cause: z.enum(["turn_ended", "session_closed", "restart"]),
  }),
]);
export type TurnRequestOutcome = z.infer<typeof turnRequestOutcomeSchema>;

export const turnRequestDecide = defineMemory({
  resource: "turn_requests",
  method: "decide",
  name: "DecideTurnRequest",
  changes: [],
  input: z.strictObject({
    session: idSchema("ses"),
    request: idSchema("apr"),
    choice: turnRequestChoiceSchema,
  }),
  output: z.object({ outcome: turnRequestOutcomeSchema }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});
