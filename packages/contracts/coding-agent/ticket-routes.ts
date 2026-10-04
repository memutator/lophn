import { z } from "zod";
import { withReadCommon } from "../platform/envelope.ts";
import { defineEvent } from "../platform/events.ts";
import { idSchema } from "../platform/ids.ts";
import { defineCommand, defineRead } from "../platform/route.ts";
import { seqSchema } from "../platform/values.ts";
import {
  acceptanceCheckInputSchema,
  checkResultSchema,
  sourceRelativePathSchema,
  TICKET_LIST_LIMIT,
  TICKET_NEEDS_LIMIT,
  ticketClaimSchema,
  ticketConditionSchema,
  ticketIdSchema,
  ticketKindSchema,
  ticketReadinessSchema,
  ticketReferenceListSchema,
  ticketReferenceSchema,
  ticketStateSchema,
} from "./ticket-values.ts";

const codePoints = (min: number, max: number) =>
  z.string().refine((value) => {
    const count = [...value].length;
    return count >= min && count <= max && /\S/.test(value);
  }, { message: "text length" });
const oneLine = (max: number) =>
  codePoints(1, max).refine((value) => !/[\r\n]/.test(value), {
    message: "one line",
  });
const body = codePoints(1, 2000);

const unique = <T>(values: readonly T[]) =>
  new Set(values).size === values.length;

const createShape = {
  app: idSchema("app"),
  kind: ticketKindSchema,
  title: oneLine(120),
  what: body,
  why: body,
  references: ticketReferenceListSchema,
  adoption_questions: z.array(idSchema("qst")).max(20),
  conditions: z.array(acceptanceCheckInputSchema).max(12),
  inspect: z.array(sourceRelativePathSchema).max(20),
  preserve: z.array(sourceRelativePathSchema).max(20),
  problems: z.array(idSchema("prb")).max(12),
  readiness: ticketReadinessSchema,
  needs: z.array(codePoints(1, 200)).max(TICKET_NEEDS_LIMIT),
};

// needs_confirmation은 근거·채택 답·조건이 비거나 일부여도 된다.
// ready는 그 셋을 모두 채운다. repair는 어느 readiness든 문제 1~12개가 필수다.
function validCreate(value: {
  readiness: "needs_confirmation" | "ready";
  needs: readonly string[];
  problems: readonly string[];
  adoption_questions: readonly string[];
  references: readonly unknown[];
  conditions: readonly unknown[];
  kind: "implementation" | "repair";
}): boolean {
  const confirming = value.readiness === "needs_confirmation";
  if (confirming !== (value.needs.length >= 1)) return false;
  if (!confirming && value.needs.length !== 0) return false;
  if (!unique(value.problems) || !unique(value.adoption_questions)) {
    return false;
  }
  if (value.kind === "repair" && value.problems.length < 1) return false;
  if (value.kind === "implementation" && value.problems.length !== 0) {
    return false;
  }
  if (confirming) return true;
  return value.references.length >= 1 &&
    value.adoption_questions.length >= 1 &&
    value.conditions.length >= 1;
}

export const ticketCreateInputSchema = z.strictObject(createShape).refine(
  validCreate,
  { message: "ticket create shape" },
);
export type TicketCreateInput = z.infer<typeof ticketCreateInputSchema>;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;
const readActors = ["user", "coding_agent", "agent", "machine"] as const;

export const ticketListInputSchema = z.strictObject({
  app: idSchema("app").optional(),
  state: ticketStateSchema.optional(),
  limit: z.number().int().min(1).max(TICKET_LIST_LIMIT).optional(),
  cursor: z.string().min(1).optional(),
});
export const ticketSummarySchema = z.object({
  id: ticketIdSchema,
  app: idSchema("app"),
  kind: ticketKindSchema,
  title: oneLine(120),
  state: ticketStateSchema,
  readiness: ticketReadinessSchema,
  problem_count: z.number().int().min(0).max(12),
});
export const ticketListOutputSchema = withReadCommon(z.object({
  tickets: z.array(ticketSummarySchema),
}));
export const ticketList = defineRead({
  resource: "tickets",
  method: "list",
  name: "ListTickets",
  input: ticketListInputSchema,
  output: ticketListOutputSchema,
  actors: readActors,
  errors: readErrors,
});

const showFields = {
  id: ticketIdSchema,
  state: ticketStateSchema,
  readiness: ticketReadinessSchema,
  needs: z.array(codePoints(1, 200)).max(TICKET_NEEDS_LIMIT),
  app: idSchema("app"),
  kind: ticketKindSchema,
  title: oneLine(120),
  what: body,
  why: body,
  problems: z.array(idSchema("prb")).max(12),
  claim: ticketClaimSchema.nullable(),
  completion_seq: seqSchema.nullable(),
  conditions: z.array(ticketConditionSchema).max(12),
  references: z.array(ticketReferenceSchema).max(20),
  adoption_questions: z.array(idSchema("qst")).max(20),
  inspect: z.array(sourceRelativePathSchema).max(20),
  preserve: z.array(sourceRelativePathSchema).max(20),
  revision: seqSchema,
};
export const ticketShowSchema = z.object(showFields).refine(
  (value) => (value.state === "claimed") === (value.claim !== null),
  { message: "claim follows state" },
).refine(
  (value) =>
    (value.readiness === "needs_confirmation") === (value.needs.length >= 1),
  { message: "needs follow readiness" },
);
export const ticketShowInputSchema = z.strictObject({ ticket: ticketIdSchema });
export const ticketShowOutputSchema = withReadCommon(z.object({
  ticket: ticketShowSchema,
}));
export const ticketShow = defineRead({
  resource: "tickets",
  method: "show",
  name: "ShowTicket",
  input: ticketShowInputSchema,
  output: ticketShowOutputSchema,
  actors: readActors,
  errors: readErrors,
});

// getTicket은 show와 같은 출력이다. 소비자가 이름으로 고른다.
export const getTicket = ticketShow;

export const ticketCheckResultSchema = z.object({
  condition: z.number().int().min(0).max(11),
  result: checkResultSchema,
  reason: z.string(),
  verification: idSchema("vrf").nullable(),
});
export const ticketChecksInputSchema = z.strictObject({
  ticket: ticketIdSchema,
});
export const ticketChecksOutputSchema = withReadCommon(z.object({
  ticket: ticketIdSchema,
  completion_seq: seqSchema.nullable(),
  checks: z.array(ticketCheckResultSchema).max(12),
}));
export const ticketChecks = defineRead({
  resource: "tickets",
  method: "checks",
  name: "TicketChecks",
  input: ticketChecksInputSchema,
  output: ticketChecksOutputSchema,
  actors: readActors,
  errors: readErrors,
});

const createActors = ["user", "agent"] as const;
export const ticketCreateOutputSchema = z.object({
  ticket: ticketIdSchema,
  state: z.literal("open"),
  readiness: ticketReadinessSchema,
  revision: seqSchema,
});
export const ticketCreate = defineCommand({
  resource: "tickets",
  method: "create",
  name: "CreateTicket",
  input: ticketCreateInputSchema,
  output: ticketCreateOutputSchema,
  actors: createActors,
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});

// make_ready는 근거·채택 답·조건·볼 곳·지킬 것을 한 번에 채운다.
export const ticketMakeReadyInputSchema = z.strictObject({
  ticket: ticketIdSchema,
  base_revision: seqSchema,
  references: ticketReferenceListSchema.refine((values) => values.length >= 1),
  adoption_questions: z.array(idSchema("qst")).min(1).max(20).refine(
    (values) => new Set(values).size === values.length,
  ),
  conditions: z.array(acceptanceCheckInputSchema).min(1).max(12),
  inspect: z.array(sourceRelativePathSchema).max(20),
  preserve: z.array(sourceRelativePathSchema).max(20),
});
export const ticketMakeReadyOutputSchema = z.object({
  ticket: ticketIdSchema,
  readiness: z.literal("ready"),
  revision: seqSchema,
});
export const ticketMakeReady = defineCommand({
  resource: "tickets",
  method: "make_ready",
  name: "MakeTicketReady",
  input: ticketMakeReadyInputSchema,
  output: ticketMakeReadyOutputSchema,
  compare: z.strictObject({ base_revision: seqSchema }),
  actors: createActors,
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});

export const ticketCreatedPayloadSchema = z.object({
  app: idSchema("app"),
  kind: ticketKindSchema,
  problems: z.array(idSchema("prb")).max(12),
  readiness: ticketReadinessSchema,
});
export const ticketCreated = defineEvent("TicketCreated", {
  subject: ticketIdSchema,
  payload: ticketCreatedPayloadSchema,
});

export const ticketMadeReadyPayloadSchema = z.object({
  app: idSchema("app"),
  kind: ticketKindSchema,
  problems: z.array(idSchema("prb")).max(12),
});
export const ticketMadeReady = defineEvent("TicketMadeReady", {
  subject: ticketIdSchema,
  payload: ticketMadeReadyPayloadSchema,
});

export const TICKET_OPEN_ROUTES = [
  ticketList,
  ticketShow,
  ticketChecks,
  ticketCreate,
  ticketMakeReady,
] as const;

export const TICKET_OPEN_EVENTS = [ticketCreated, ticketMadeReady] as const;
