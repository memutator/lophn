import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineRead } from "../base/route.ts";
import { ticketCreateInputSchema } from "./ticket-routes.ts";

// 사람 화면 repair 준비(coding-agent/tickets#R24, R26).
// create 입력은 ticket.create와 같은 schema다. 이 read는 ticket을 만들지 않고
// priority·requested로 claim·approval을 만들지 않는다.
const engineerLinkSchema = z.strictObject({
  assignment: idSchema("asg"),
  role: z.literal("app_engineer"),
});

const noStart = {
  started: z.literal(false),
  approval: z.null(),
};

export const repairPrepareTicketSchema = z.strictObject({
  kind: z.literal("ticket"),
  create: ticketCreateInputSchema,
  // 근거가 부족할 때만 담당 App Engineer. 충분하면 null.
  app_engineer: engineerLinkSchema.nullable(),
  ...noStart,
});

export const repairPrepareConversationSchema = z.strictObject({
  kind: z.literal("conversation"),
  app: idSchema("app"),
  app_engineer: engineerLinkSchema.nullable(),
  reason: z.literal("implementation_request"),
  ...noStart,
});

export const repairPrepareOutcomeSchema = z.discriminatedUnion("kind", [
  repairPrepareTicketSchema,
  repairPrepareConversationSchema,
]);
export type RepairPrepareOutcome = z.infer<typeof repairPrepareOutcomeSchema>;

export const repairPrepareInputSchema = z.strictObject({
  problem: idSchema("prb"),
  request: z.enum(["repair", "implementation"]),
  priority: z.string().min(1).max(40).nullable().optional(),
  requested: z.boolean().optional(),
});

export const repairPrepareOutputSchema = withReadCommon(z.object({
  outcome: repairPrepareOutcomeSchema,
}));

export const repairPrepare = defineRead({
  resource: "tickets",
  method: "screen_repair_prepare",
  name: "PrepareRepairTicket",
  input: repairPrepareInputSchema,
  output: repairPrepareOutputSchema,
  actors: ["user", "coding_agent", "agent", "machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

export const TICKET_REPAIR_PREPARE_ROUTES = [repairPrepare] as const;
