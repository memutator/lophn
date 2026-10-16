import { z } from "zod";
import { defineCommand, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { atSchema, seqSchema } from "../base/values.ts";
import { actorSchema } from "../base/actor.ts";
import { EVENT_BATCH_MAX_COUNT } from "../base/limits.ts";
import { withReadCommon } from "../base/envelope.ts";

import {
  type EventDefinition,
  eventTypeSchema,
  subjectSchema,
} from "../base/event.ts";

const envelopeFields = {
  seq: seqSchema,
  type: eventTypeSchema,
  subject: subjectSchema,
  actor: actorSchema,
  run: idSchema("run").nullable(),
  payload: z.object({}).catchall(z.unknown()),
  at: atSchema,
};

const eventEnvelopeBaseSchema = z.object(envelopeFields);

export type EventEnvelope = z.infer<typeof eventEnvelopeBaseSchema>;

// envelope의 seq·actor·run·at은 그대로 두고 등록 event의 type·subject·payload만 좁힌 값.
// 노출 판단 hook이 받는 값은 이 모양이다(EventVisibilityDefinition).
export type EventEnvelopeFor<D extends EventDefinition> =
  & Omit<
    EventEnvelope,
    "type" | "subject" | "payload"
  >
  & {
    type: D["type"];
    subject: z.output<D["subject"]>;
    payload: z.output<D["payload"]>;
  };

// 특정 event의 payload를 좁힌 envelope.
export function eventEnvelopeSchema<D extends EventDefinition>(
  definition: D,
) {
  return z.object({
    ...envelopeFields,
    type: z.literal(definition.type),
    subject: definition.subject,
    payload: definition.payload,
  });
}

const eventBatchLimitSchema = z.number().refine(
  (n): n is number =>
    Number.isSafeInteger(n) && n >= 1 && n <= EVENT_BATCH_MAX_COUNT,
  { message: "invalid event batch limit" },
);

const filterSchema = {
  types: z.array(eventTypeSchema).optional(),
  subjects: z.array(subjectSchema).optional(),
  limit: eventBatchLimitSchema.optional(),
};

// seq > after_seq. WebSocket의 from_seq(포함)와 같은 위치 다음부터로 맞춘다.
const eventsListInputSchema = z.strictObject({
  after_seq: seqSchema,
  ...filterSchema,
});

const eventsListOutputSchema = withReadCommon(z.object({
  events: z.array(eventEnvelopeBaseSchema).max(EVENT_BATCH_MAX_COUNT),
  scanned_through_seq: seqSchema,
  head_seq: seqSchema,
}));

export const eventsList = defineRead({
  resource: "events",
  method: "list",
  name: "ListEvents",
  input: eventsListInputSchema,
  output: eventsListOutputSchema,
  actors: ["user", "coding_agent", "agent", "app", "machine"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

// 반응 없는 구간만 이 command다. 비교 기준은 자기 cursor의 이전 seq이고 감소할 수 없다.
const advanceSubscriberCursorInputSchema = z.strictObject({
  subscriber: z.string().min(1),
  scanned_through_seq: seqSchema,
});

const advanceSubscriberCursorCompareSchema = z.strictObject({
  processed_through_seq: seqSchema,
});

// 반응 command의 idempotency 기준(domain-model platform/ledger).
export const reactionKeySchema = z.strictObject({
  subscriber: z.string().min(1),
  cause_seq: seqSchema,
  reaction: z.string().min(1),
});

export type ReactionKey = z.infer<typeof reactionKeySchema>;

export const advanceSubscriberCursor = defineCommand({
  resource: "events",
  method: "advance-cursor",
  name: "AdvanceSubscriberCursor",
  input: advanceSubscriberCursorInputSchema,
  output: z.object({ processed_through_seq: seqSchema }),
  compare: advanceSubscriberCursorCompareSchema,
  actors: ["machine"],
  errors: [
    "unauthorized",
    "forbidden",
    "invalid_input",
    "conflict",
    "unavailable",
  ],
});

