import { z } from "zod";
import { actorSchema } from "../base/actor.ts";
import { idSchema } from "../base/ids.ts";
import { atSchema, seqSchema } from "../base/values.ts";
import { ACTIVATION_FAILURE_CODES } from "../apps/activation/activation.ts";
import type { ReactionEventType } from "../approvals/mod.ts";
import { defineEvent, type EventDefinition } from "../base/event.ts";
import { verificationRecorded } from "../problems/tests.ts";

// domain event는 Ledger에 남고 Reactor가 반응한다. 이 목록 밖의 변경은 domain event를 만들지 않는다.
// 같은 tx 규칙: 아래 event는 그 도메인 상태를 바꾸는 command가 같은 transaction에서 쓴다.
// commit 뒤 같은 event를 Bus에도 낸다(구현은 core/events).
// payload는 받는 handler가 쓰는 칸만 둔다. actor는 envelope에 있다.

export const releaseActivationFailed = defineEvent("ReleaseActivationFailed", {
  subject: idSchema("rel"),
  payload: z.strictObject({
    app: idSchema("app"),
    ticket: idSchema("tkt"),
    failure: z.strictObject({
      code: z.enum(ACTIVATION_FAILURE_CODES),
      summary: z.string().min(1),
    }),
  }),
});

// session은 완료를 보고한 coding session이다. lophn이 다시 켜진 뒤 Reactor가 call을 찾는 데 쓴다.
export const ticketCompletionReported = defineEvent(
  "TicketCompletionReported",
  {
    subject: idSchema("tkt"),
    payload: z.strictObject({
      app: idSchema("app"),
      release: idSchema("rel"),
      session: idSchema("ses"),
    }),
  },
);

export const ticketClaimExpired = defineEvent("TicketClaimExpired", {
  subject: idSchema("tkt"),
  payload: z.strictObject({ app: idSchema("app"), session: idSchema("ses") }),
});

export const codingSessionEndedUnreported = defineEvent(
  "CodingSessionEndedUnreported",
  {
    subject: idSchema("ses"),
    payload: z.strictObject({ app: idSchema("app"), ticket: idSchema("tkt") }),
  },
);

export const ticketVerified = defineEvent("TicketVerified", {
  subject: idSchema("tkt"),
  payload: z.strictObject({ app: idSchema("app") }),
});

export const DOMAIN_EVENTS = [
  releaseActivationFailed,
  ticketCompletionReported,
  ticketClaimExpired,
  codingSessionEndedUnreported,
  ticketVerified,
  verificationRecorded,
] as const;

export type DomainEventType = (typeof DOMAIN_EVENTS)[number]["type"];

// seq는 전역이다. agent event와 달리 turn 칸이 없다.
function domainEventEnvelopeSchema<
  T extends string,
  S extends z.ZodType,
  P extends z.ZodType,
>(definition: EventDefinition<T, S, P>) {
  return z.object({
    seq: seqSchema,
    type: z.literal(definition.type),
    subject: definition.subject,
    actor: actorSchema,
    at: atSchema,
    payload: definition.payload,
  });
}

export const domainEventSchema = z.discriminatedUnion("type", [
  domainEventEnvelopeSchema(releaseActivationFailed),
  domainEventEnvelopeSchema(ticketCompletionReported),
  domainEventEnvelopeSchema(ticketClaimExpired),
  domainEventEnvelopeSchema(codingSessionEndedUnreported),
  domainEventEnvelopeSchema(ticketVerified),
  domainEventEnvelopeSchema(verificationRecorded),
]);
export type DomainEvent = z.infer<typeof domainEventSchema>;

// 새 일은 reaction 설정으로 끌 수 있고, call 닫음은 끌 수 없고, program 일은 agent를 부르지 않는다.
type DomainEventKind = "new_work" | "call_closing" | "program";

const DOMAIN_EVENT_KINDS = {
  ReleaseActivationFailed: "new_work",
  TicketCompletionReported: "call_closing",
  TicketClaimExpired: "call_closing",
  CodingSessionEndedUnreported: "call_closing",
  TicketVerified: "program",
  VerificationRecorded: "program",
} as const satisfies Record<DomainEventType, DomainEventKind>;

// 새 일은 approvals의 REACTION_EVENT_TYPES와 같다. 어긋나면 type 오류다.
type NewWorkTypes = {
  [T in DomainEventType]: (typeof DOMAIN_EVENT_KINDS)[T] extends "new_work" ? T
    : never;
}[DomainEventType];
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _newWorkMatchesReactions: Same<
  NewWorkTypes,
  ReactionEventType
> = true;
void _newWorkMatchesReactions;
