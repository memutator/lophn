import { z } from "zod";
import { ERROR_CODES } from "../../base/mod.ts";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineMemory, defineRead } from "../base/route.ts";
import { atSchema, seqSchema, sha256Schema } from "../base/values.ts";
import { type IntentKind, intentSchema } from "./intent.ts";

// app-api, MCP tool의 선택지.
const TURN_CHOICES = ["once", "session", "always", "reject"] as const;
// activation, 설정 고치기, reaction의 선택지.
const ALLOW_REJECT_CHOICES = ["allow", "reject"] as const;
const requestChoiceSchema = z.enum([
  ...TURN_CHOICES,
  "allow",
]);
export type RequestChoice = z.infer<typeof requestChoiceSchema>;

// app_api 호출 주체가 앱이거나 app_resource, agent_call은 물음이 나오지 않으므로 allow·reject로 둔다.
export function choicesFor(
  kind: IntentKind,
): readonly RequestChoice[] {
  return kind === "app_api" || kind === "mcp_tool"
    ? TURN_CHOICES
    : ALLOW_REJECT_CHOICES;
}

// 거절 이유는 요청한 agent에게 그대로 간다. 한 줄이다.
const rejectReasonSchema = z.string().trim().min(1).max(500).refine(
  (value) => !/[\r\n]/.test(value),
  { message: "reject reason is one line" },
);

// allow는 접수다. 만료는 없다.
const REQUEST_STATUSES = [
  "pending",
  "allow",
  "reject",
  "cancelled",
] as const;
const requestStatusSchema = z.enum(REQUEST_STATUSES);
export type RequestStatus = z.infer<typeof requestStatusSchema>;

// 보류 request의 적용 결과. 허락의 접수(allow)와 적용의 성공을 따로 보인다. 적용 전에는 null이다.
export const applyResultSchema = z.discriminatedUnion("state", [
  z.strictObject({ state: z.literal("applied") }),
  z.strictObject({
    state: z.literal("failed"),
    code: z.enum(ERROR_CODES),
    message: z.string(),
  }),
]);
export type ApplyResult = z.infer<typeof applyResultSchema>;

// turn 안 request. 메모리에 있고 session snapshot에 든다.
// fingerprint는 intent의 canonical hash이고, 허락이 쓰이기 전에 같은 intent인지 다시 볼 때 쓴다.
export const turnPermissionRequestSchema = z.strictObject({
  id: idSchema("apr"),
  session: idSchema("ses"),
  turn: idSchema("trn"),
  tool_call: idSchema("tcl"),
  intent: intentSchema,
  choices: z.array(requestChoiceSchema).min(1),
  fingerprint: sha256Schema,
  created_at: atSchema,
});
export type TurnPermissionRequest = z.infer<typeof turnPermissionRequestSchema>;

// 보류 request. `approval_requests` 표 한 행이다. 설명 글, blob, 기한, 요청자, 결정자는 없다.
export const pendingApprovalSchema = z.strictObject({
  id: idSchema("apr"),
  intent: intentSchema,
  choices: z.array(requestChoiceSchema).min(1),
  status: requestStatusSchema,
  reject_reason: z.string().nullable(),
  applied: applyResultSchema.nullable(),
  created_seq: seqSchema,
  decided_seq: seqSchema.nullable(),
  created_at: atSchema,
  decided_at: atSchema.nullable(),
});
export type PendingApproval = z.infer<typeof pendingApprovalSchema>;

// turn이 이어 가는 값. cancelled는 거절과 구별해 요청자에게 간다.
const turnDecisionSchema = z.discriminatedUnion("outcome", [
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
export type TurnDecision = z.infer<typeof turnDecisionSchema>;

const rejectChoiceSchema = z.strictObject({
  kind: z.literal("reject"),
  reason: rejectReasonSchema.optional(),
});

const pendingChoiceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("allow") }),
  rejectChoiceSchema,
]);

// choice.kind가 그 request의 choices에 없으면 handler가 invalid_input으로 거절한다.
const turnChoiceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.enum(["once", "session", "always", "allow"]) }),
  rejectChoiceSchema,
]);
export type TurnChoice = z.infer<typeof turnChoiceSchema>;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

// 결정은 사람 자격으로만 한다. 확인 창도 확인 handle도 없다.
// 사람 token을 가진 shell main이 부르는 것이 곧 사람의 결정이다.

// pending만. renderer가 처음과 다시 붙을 때 읽는 snapshot이다.
export const approvalsPending = defineRead({
  resource: "approvals",
  method: "pending",
  name: "ListPendingApprovals",
  input: z.strictObject({}),
  output: withReadCommon(
    z.object({ requests: z.array(pendingApprovalSchema) }),
  ),
  actors: ["user"],
  errors: [...readErrors],
});

// 이미 결정됐거나 cancelled면 conflict다. 한 tx로 결정과 domain event ApprovalDecided를 쓴다.
// output은 접수 시점의 모양이다.
export const approvalsDecide = defineCommand({
  resource: "approvals",
  method: "decide",
  name: "DecideApproval",
  input: z.strictObject({
    request: idSchema("apr"),
    choice: pendingChoiceSchema,
  }),
  output: z.object({ request: pendingApprovalSchema }),
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

export const approvalsDecideTurn = defineMemory({
  resource: "approvals",
  method: "decide_turn",
  name: "DecideTurnPermission",
  input: z.strictObject({
    session: idSchema("ses"),
    request: idSchema("apr"),
    choice: turnChoiceSchema,
  }),
  output: z.object({ outcome: turnDecisionSchema }),
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

// 옛 APPROVAL_ROUTES와 합치는 것은 lead 등록이다.
export const APPROVAL_DECISION_ROUTES = [
  approvalsPending,
  approvalsDecide,
  approvalsDecideTurn,
] as const;
