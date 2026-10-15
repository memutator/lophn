import { err, nextFromSeq, ok, type Result } from "../../base/mod.ts";
import { z } from "zod";
import { eventBatchLimitSchema, eventEnvelopeBaseSchema } from "./events.ts";
import { eventTypeSchema, subjectSchema } from "../base/event.ts";
import { seqSchema } from "../base/values.ts";

export const EVENT_SUBSCRIBE_PATH = "/v1/events/subscribe";
export const EVENT_SUBSCRIBE_SUBPROTOCOL = "lophn.events.1";

// 느린 구독은 끊고 재연결한다. 자격 회수·종료는 이후 전달하지 않는다.
export const EVENT_CLOSE_SLOW_CONSUMER = 1013;
export const EVENT_CLOSE_CREDENTIAL_REVOKED = 1008;

const filterFields = {
  types: z.array(eventTypeSchema),
  subjects: z.array(subjectSchema),
};

// from_seq는 포함한다. 빈 배열은 제한하지 않는다.
// 이름 있는 구독은 명시 from이 없으면 저장 ack 다음부터 시작한다.
// schema는 그 시작 seq를 정하지 않는다. "저장 ack + 1"과 "저장 없으면 0"의 해석은
// platform runtime의 몫이고, 여기서는 '0'을 주입하지 않는다. 현재 principal·이름으로
// 저장된 위치와 그 재연결을 잇는 일도 runtime이 한다.
export const subscribeFrameSchema = z.strictObject({
  type: z.literal("subscribe"),
  from_seq: seqSchema.optional(),
  ...filterFields,
  subscriber: z.string().min(1).optional(),
  limit: eventBatchLimitSchema.optional(),
}).refine(
  (frame) => frame.from_seq !== undefined || frame.subscriber !== undefined,
  { message: "subscribe needs from_seq or a named subscriber" },
);

export type SubscribeFrame = z.infer<typeof subscribeFrameSchema>;

export const eventsFrameSchema = z.object({
  type: z.literal("events"),
  events: z.array(eventEnvelopeBaseSchema),
  scanned_through_seq: seqSchema,
  head_seq: seqSchema,
});

export type EventsFrame = z.infer<typeof eventsFrameSchema>;

// 이름 있는 구독의 derived 전송 위치. ledger 반응 cursor와 다르다.
export const ackFrameSchema = z.strictObject({
  type: z.literal("ack"),
  subscriber: z.string().min(1),
  through_seq: seqSchema,
});

export type AckFrame = z.infer<typeof ackFrameSchema>;

// 원문·stack·token 없는 안전한 거절.
export const unavailableFrameSchema = z.object({
  type: z.literal("unavailable"),
  message: z.string(),
});

export type UnavailableFrame = z.infer<typeof unavailableFrameSchema>;

export const clientEventFrameSchema = z.discriminatedUnion("type", [
  subscribeFrameSchema,
  ackFrameSchema,
]);

export type ClientEventFrame = z.infer<typeof clientEventFrameSchema>;

export const serverEventFrameSchema = z.discriminatedUnion("type", [
  eventsFrameSchema,
  unavailableFrameSchema,
]);

export type ServerEventFrame = z.infer<typeof serverEventFrameSchema>;

export const eventFrameSchema = z.discriminatedUnion("type", [
  subscribeFrameSchema,
  eventsFrameSchema,
  ackFrameSchema,
  unavailableFrameSchema,
]);

export type EventFrame = z.infer<typeof eventFrameSchema>;

// 문자열 frame을 frame 값으로 읽는다. JSON이 아니거나 schema 밖이면 invalid_input.
export function parseEventFrame(text: string): Result<EventFrame> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return err({ code: "invalid_input", message: "invalid event frame" });
  }
  const parsed = eventFrameSchema.safeParse(value);
  if (!parsed.success) {
    return err({ code: "invalid_input", message: "invalid event frame" });
  }
  return ok(parsed.data);
}

export function parseClientEventFrame(text: string): Result<ClientEventFrame> {
  const parsed = parseEventFrame(text);
  if (!parsed.ok) return parsed;
  const client = clientEventFrameSchema.safeParse(parsed.value);
  if (!client.success) {
    return err({ code: "invalid_input", message: "invalid event frame" });
  }
  return ok(client.data);
}

// 처리 위치 P 다음 재생 시작. from_seq는 그 위치를 포함한다.
export { nextFromSeq };
