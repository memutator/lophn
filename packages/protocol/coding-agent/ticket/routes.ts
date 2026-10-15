// ticket을 만들고 고치고 읽고 확인하고 취소하는 route. claim과 완료 보고는 claims.ts.
// event(`TicketVerified` 등)는 protocol/events가 정의하고 이 file은 정의하지 않는다.
import { z } from "zod";
import { withReadCommon } from "../../base/envelope.ts";
import { idSchema } from "../../base/ids.ts";
import { defineCommand, defineRead } from "../../base/route.ts";
import { seqSchema } from "../../base/values.ts";
import {
  acceptanceCheckSchema,
  TICKET_LIST_LIMIT,
  ticketCancelReasonSchema,
  ticketCheckResultSchema,
  ticketClaimSchema,
  ticketCompletionSchema,
  ticketEvidenceListSchema,
  ticketEvidenceReadSchema,
  ticketGoalSchema,
  ticketIdSchema,
  ticketStateSchema,
  ticketVerdictSchema,
  VERIFY_NOTE_MAX_CODE_POINTS,
  verifyResultSchema,
} from "./values.ts";

const readActors = ["user", "coding_agent", "agent", "machine"] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

// 칸 이름은 agent tool 입력(`ticket.*`)과 같다.
export const ticketCreateInputSchema = z.strictObject({
  app: idSchema("app"),
  goal: ticketGoalSchema,
  check: acceptanceCheckSchema,
  evidence: ticketEvidenceListSchema.optional(),
});
export const ticketCreate = defineCommand({
  resource: "tickets",
  method: "create",
  name: "CreateTicket",
  input: ticketCreateInputSchema,
  output: z.object({
    ticket: ticketIdSchema,
    state: z.literal("open"),
    revision: seqSchema,
  }),
  actors: ["agent"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});

// 닫히기 전에 목표와 조건을 고친다. 하나는 있어야 한다.
export const ticketUpdateInputSchema = z.strictObject({
  ticket: ticketIdSchema,
  goal: ticketGoalSchema.optional(),
  check: acceptanceCheckSchema.optional(),
}).refine(
  (value) => value.goal !== undefined || value.check !== undefined,
  { message: "update needs goal or check" },
);
export const ticketUpdate = defineCommand({
  resource: "tickets",
  method: "update",
  name: "UpdateTicket",
  input: ticketUpdateInputSchema,
  output: z.object({ ticket: ticketIdSchema, revision: seqSchema }),
  actors: ["agent"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});

export const ticketListInputSchema = z.strictObject({
  app: idSchema("app").optional(),
  state: ticketStateSchema.optional(),
  limit: z.number().int().min(1).max(TICKET_LIST_LIMIT).optional(),
  cursor: z.string().min(1).optional(),
});
// title은 goal의 첫 줄이다(`ticketTitleOf`).
export const ticketSummarySchema = z.object({
  id: ticketIdSchema,
  app: idSchema("app"),
  title: z.string().min(1),
  state: ticketStateSchema,
});
export const ticketList = defineRead({
  resource: "tickets",
  method: "list",
  name: "ListTickets",
  input: ticketListInputSchema,
  output: withReadCommon(z.object({ tickets: z.array(ticketSummarySchema) })),
  actors: readActors,
  errors: readErrors,
});

export const ticketViewSchema = z.object({
  id: ticketIdSchema,
  app: idSchema("app"),
  state: ticketStateSchema,
  goal: ticketGoalSchema,
  check: acceptanceCheckSchema,
  evidence: z.array(ticketEvidenceReadSchema).max(20),
  claim: ticketClaimSchema.nullable(),
  completion: ticketCompletionSchema.nullable(),
  check_result: ticketCheckResultSchema.nullable(),
  verdict: ticketVerdictSchema.nullable(),
  revision: seqSchema,
}).refine(
  (value) => (value.state === "claimed") === (value.claim !== null),
  { message: "claim follows state" },
);
export type TicketView = z.infer<typeof ticketViewSchema>;

export const ticketShowInputSchema = z.strictObject({ ticket: ticketIdSchema });
// 근거 annotation은 메모, component, source 위치, release, screenshot 파일 경로까지 풀려 있다.
export const ticketShow = defineRead({
  resource: "tickets",
  method: "show",
  name: "ShowTicket",
  input: ticketShowInputSchema,
  output: withReadCommon(z.object({ ticket: ticketViewSchema })),
  actors: readActors,
  errors: readErrors,
});

// 보고된 ticket을 확인됨이나 확인 실패로 둔다. 확인됨이면 같은 tx에 `TicketVerified`가 남는다.
export const ticketVerifyInputSchema = z.strictObject({
  ticket: ticketIdSchema,
  base_revision: seqSchema,
  completion_seq: seqSchema,
  result: verifyResultSchema,
  note: z.string().refine(
    (value) => [...value].length <= VERIFY_NOTE_MAX_CODE_POINTS,
    { message: "note length" },
  ).optional(),
});
export const ticketVerify = defineCommand({
  resource: "tickets",
  method: "verify",
  name: "VerifyTicket",
  input: ticketVerifyInputSchema,
  output: z.object({
    ticket: ticketIdSchema,
    state: verifyResultSchema,
    revision: seqSchema,
  }),
  compare: z.strictObject({ base_revision: seqSchema }),
  actors: ["agent"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});

export const ticketCancelInputSchema = z.strictObject({
  ticket: ticketIdSchema,
  reason: ticketCancelReasonSchema,
});
export const ticketCancel = defineCommand({
  resource: "tickets",
  method: "cancel",
  name: "CancelTicket",
  input: ticketCancelInputSchema,
  output: z.object({ ticket: ticketIdSchema, state: z.literal("cancelled") }),
  actors: ["user", "agent"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});

export const TICKET_ROUTE_LIST = [
  ticketCreate,
  ticketUpdate,
  ticketList,
  ticketShow,
  ticketVerify,
  ticketCancel,
] as const;
