import { z } from "zod";
import { defineRead } from "../base/route.ts";
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
  turn: idSchema("trn").nullable(),
  payload: z.object({}).catchall(z.unknown()),
  at: atSchema,
};

const eventEnvelopeBaseSchema = z.object(envelopeFields);

type EventEnvelope = z.infer<typeof eventEnvelopeBaseSchema>;

// envelope의 seq·actor·turn·at은 그대로 두고 등록 event의 type·subject·payload만 좁힌 값.
// 노출 판단 hook이 받는 값은 이 모양이다(EventVisibilityDefinition).
export type EventEnvelopeFor<D extends EventDefinition> = Omit<
  EventEnvelope,
  "type" | "subject" | "payload"
> & {
  type: D["type"];
  subject: z.output<D["subject"]>;
  payload: z.output<D["payload"]>;
};

// 특정 event의 payload를 좁힌 envelope.

const eventBatchLimitSchema = z
  .number()
  .refine(
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

const eventsListOutputSchema = withReadCommon(
  z.object({
    events: z.array(eventEnvelopeBaseSchema).max(EVENT_BATCH_MAX_COUNT),
    scanned_through_seq: seqSchema,
    head_seq: seqSchema,
  }),
);

export const eventsList = defineRead({
  resource: "events",
  method: "list",
  name: "ListEvents",
  input: eventsListInputSchema,
  output: eventsListOutputSchema,
  actors: ["user", "agent", "app", "machine"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});
