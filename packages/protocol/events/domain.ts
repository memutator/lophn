import { z } from "zod";
import { actorSchema } from "../base/actor.ts";
import { idSchema } from "../base/ids.ts";
import { atSchema, seqSchema } from "../base/values.ts";
import { defineEvent, type EventDefinition } from "../base/event.ts";

// domain event는 Ledger에 남고 Reactor가 반응한다. 이 목록 밖의 변경은 domain event를 만들지 않는다.
// 같은 tx 규칙: 아래 event는 그 도메인 상태를 바꾸는 command가 같은 transaction에서 쓴다.
// commit 뒤 같은 event를 Bus에도 낸다(구현은 core/events).
// payload는 받는 handler가 쓰는 칸만 둔다. actor는 envelope에 있다.

// 쓰는 곳이 없다. 목록이 비면 Reactor와 commit publisher의 type이 서지 않아, Reactor를 지울 때 같이 지운다.
export const codingSessionEnded = defineEvent("CodingSessionEnded", {
  subject: idSchema("ses"),
  payload: z.strictObject({ app: idSchema("app") }),
});

export const DOMAIN_EVENTS = [codingSessionEnded] as const;

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
  domainEventEnvelopeSchema(codingSessionEnded),
]);
export type DomainEvent = z.infer<typeof domainEventSchema>;
