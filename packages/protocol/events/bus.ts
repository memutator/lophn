import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { agentEventSchema } from "./agent.ts";
import { domainEventSchema } from "./domain.ts";
import { eventTypeSchema } from "../base/event.ts";
import { transientEventSchema } from "./transient.ts";

// Bus에 실리는 것은 domain event(commit 뒤), agent event, 남지 않는 event 셋 모두다.
// type 이름은 셋 사이에서 겹치지 않는다.
export const busEventSchema = z.union([
  domainEventSchema,
  agentEventSchema,
  transientEventSchema,
]);
export type BusEvent = z.infer<typeof busEventSchema>;

// 구독 조건. 생략한 칸은 제한하지 않는다.
// event가 조건에 맞는다 = (session이 없거나 event의 session과 같다) 그리고
// (types가 없거나 event의 type이 들어 있다).
// 조건 여럿은 OR이고 같은 event는 연결 하나에 한 번만 간다.
// session을 건 조건은 session이 없는 event(domain, 남지 않는 event)와 맞지 않는다.
export const eventConditionSchema = z.strictObject({
  session: idSchema("ses").optional(),
  types: z.array(eventTypeSchema).optional(),
});
export type EventCondition = z.infer<typeof eventConditionSchema>;
