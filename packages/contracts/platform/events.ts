import { z } from "zod";
import { defineCommand, defineRead } from "./route.ts";
import { ID_PREFIXES, type IdPrefix, idSchema } from "./ids.ts";
import { atSchema, seqSchema } from "./values.ts";
import { actorSchema } from "./actor.ts";
import { EVENT_BATCH_MAX_BYTES, EVENT_BATCH_MAX_COUNT } from "./limits.ts";
import { withReadCommon } from "./envelope.ts";

// 소유 concern이 등록하는 `<Entity><과거형 동사>` 이름(domain-model platform/ledger).
const EVENT_TYPE = /^[A-Z][A-Za-z0-9]*$/;

export const eventTypeSchema = z.string().regex(EVENT_TYPE);

export type EventType = z.infer<typeof eventTypeSchema>;

// entity는 ID, 이름 record는 `<종류>:<키>`, lophn 전체 단일 공통 설정만 null.
const SUBJECT_KEY = /^[a-z][a-z0-9_]*:[A-Za-z0-9_.:-]+$/;

function isIdPrefix(prefix: string): prefix is IdPrefix {
  return Object.hasOwn(ID_PREFIXES, prefix);
}

const anyIdSchema = z.string().refine(
  (value) => {
    const prefix = value.slice(0, value.indexOf("_"));
    return isIdPrefix(prefix) && idSchema(prefix).safeParse(value).success;
  },
  { message: "invalid subject" },
);

export const subjectSchema = z.union([
  anyIdSchema,
  z.string().regex(SUBJECT_KEY),
  z.null(),
]);

export type Subject = z.infer<typeof subjectSchema>;

export type EventDefinition<
  T extends string = string,
  S extends z.ZodType = z.ZodType,
  P extends z.ZodType = z.ZodType,
> = {
  type: T;
  subject: S;
  payload: P;
};

// 다른 owner가 자기 event를 적는다. 결과 값은 {type, payload} 모양을 만족한다.
export function defineEvent<
  T extends string,
  S extends z.ZodType,
  P extends z.ZodType,
>(
  type: T,
  definition: { subject: S; payload: P },
): EventDefinition<T, S, P> {
  if (!EVENT_TYPE.test(type)) {
    throw new Error("event type must be <Entity><과거형 동사> PascalCase");
  }
  return { type, subject: definition.subject, payload: definition.payload };
}

const envelopeFields = {
  seq: seqSchema,
  type: eventTypeSchema,
  subject: subjectSchema,
  actor: actorSchema,
  run: idSchema("run").nullable(),
  payload: z.object({}).catchall(z.unknown()),
  at: atSchema,
};

export const eventEnvelopeBaseSchema = z.object(envelopeFields);

export type EventEnvelope = z.infer<typeof eventEnvelopeBaseSchema>;

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

export const eventBatchLimitSchema = z.number().refine(
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
export const eventsListInputSchema = z.strictObject({
  after_seq: seqSchema,
  ...filterSchema,
});

export const eventsListOutputSchema = withReadCommon(z.object({
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
export const advanceSubscriberCursorInputSchema = z.strictObject({
  subscriber: z.string().min(1),
  scanned_through_seq: seqSchema,
});

export const advanceSubscriberCursorCompareSchema = z.strictObject({
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

export const EVENT_BATCH_LIMITS = {
  count: EVENT_BATCH_MAX_COUNT,
  bytes: EVENT_BATCH_MAX_BYTES,
} as const;
