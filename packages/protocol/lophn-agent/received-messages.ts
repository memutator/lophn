import { z } from "zod";
import { defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { readCursorSchema, seqSchema, sha256Schema } from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import { inputDeliverySchema, receivedEnvelopeSchema } from "./inputs.ts";

// session이 받은 메시지의 읽기 모양이다. 사람 메시지, call, call의 답, reaction이 모두 이 꼴이다.
// 보낸 쪽, call, 근거는 받은 봉투(receivedEnvelopeSchema)가 싣는다.
// annotation 이미지는 message part로 싣지 않는다. refs의 annotation id로 가리키고, prompt를 조립할 때
// 그 id로 screenshot을 읽는다. 본문 글은 hash이고 값은 ReadMessageBody가 준다.
export const receivedMessageSchema = receivedEnvelopeSchema.extend({
  id: idSchema("msg"),
  session: idSchema("ses"),
  // 이 메시지를 가져가 시작하거나 이어 간 turn. 아직 가져가지 않았으면 null이다.
  turn: idSchema("trn").nullable(),
  delivery: inputDeliverySchema,
  body: sha256Schema,
  created_seq: seqSchema,
});
export type ReceivedMessage = z.infer<typeof receivedMessageSchema>;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

const readActors = ["user", "agent", "machine"] as const;

// 옛 messages/list와 경로가 겹치지 않게 자원 이름을 따로 둔다.
export const receivedMessageList = defineRead({
  resource: "session_messages",
  method: "list",
  name: "ListReceivedMessages",
  input: z.strictObject({
    session: idSchema("ses"),
    turn: idSchema("trn").optional(),
    cursor: readCursorSchema.optional(),
  }),
  output: withReadCommon(z.object({
    messages: z.array(receivedMessageSchema),
  })),
  actors: readActors,
  errors: [...readErrors],
});

export const receivedMessageRead = defineRead({
  resource: "session_messages",
  method: "read",
  name: "ReadReceivedMessage",
  input: z.strictObject({ message: idSchema("msg") }),
  output: withReadCommon(z.object({ message: receivedMessageSchema })),
  actors: readActors,
  errors: [...readErrors],
});

// registry에는 lead가 올린다.
export const RECEIVED_MESSAGE_ROUTES = [
  receivedMessageList,
  receivedMessageRead,
] as const;
