// protocol의 AgentEvent·DomainEvent·TransientEvent는 envelope 함수가 반환형을 적지 않아 type이 string, payload가
// unknown으로 넓어져 있다(바꾸기 요청). 그래서 정의 표에서 좁은 type을 다시 만들고, 읽은 event를 여기로 좁힌다.
import type { z } from "zod";
import type {
  AGENT_EVENTS,
  AgentEventDefinition,
  BusEvent,
  DOMAIN_EVENTS,
  TRANSIENT_EVENTS,
  TransientEventDefinition,
} from "../../../../../protocol/events/mod.ts";

type At = string;

type AgentTyped<D> = D extends AgentEventDefinition ? {
    readonly session: string;
    readonly type: D["type"];
    readonly at: At;
    readonly payload: z.infer<D["payload"]>;
  }
  : never;

type DomainTyped<D> = D extends
  { type: string; subject: z.ZodType; payload: z.ZodType } ? {
    readonly seq: string;
    readonly type: D["type"];
    readonly subject: z.infer<D["subject"]>;
    readonly actor: string;
    readonly at: At;
    readonly payload: z.infer<D["payload"]>;
  }
  : never;

type TransientTyped<D> = D extends TransientEventDefinition ? {
    readonly type: D["type"];
    readonly subject: z.infer<D["subject"]>;
    readonly at: At;
    readonly payload: z.infer<D["payload"]>;
  }
  : never;

export type TypedEvent =
  | AgentTyped<(typeof AGENT_EVENTS)[number]>
  | DomainTyped<(typeof DOMAIN_EVENTS)[number]>
  | TransientTyped<(typeof TRANSIENT_EVENTS)[number]>;

/** busEventSchema가 읽은 값이므로 모양은 이미 맞다. type만 좁힌다. */
export function typedEvent(event: BusEvent): TypedEvent {
  return event as TypedEvent;
}
