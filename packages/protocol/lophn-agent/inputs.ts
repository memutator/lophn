import { z } from "zod";
import { defineCommand, defineMemory } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { seqSchema } from "../base/values.ts";
import { userContentBlocksSchema } from "./message-content.ts";
import {
  callFailReasonSchema,
  callFromOutputSchema,
  callRefOutputSchema,
  callRefSchema,
  callReplySchema,
} from "./calls.ts";

// 사람의 보내기만 steer를 고른다. call, reply, reaction, notice, step은 항상 next_turn이라 값이 없다.
const INPUT_DELIVERIES = ["next_turn", "steer"] as const;
export const inputDeliverySchema = z.enum(INPUT_DELIVERIES);
export type InputDelivery = z.infer<typeof inputDeliverySchema>;

// annotation 묶음도 같은 입력이다. 묶음이 만든 본문은 content에 담고 refs로 가리킨다.
// delivery가 steer인데 session이 돌고 있지 않으면 next_turn과 같다(core handler).
const sendMessageInputSchema = z.strictObject({
  id: idSchema("msg"),
  session: idSchema("ses"),
  content: userContentBlocksSchema,
  delivery: inputDeliverySchema,
  refs: z.array(callRefSchema),
  // 사람 화면은 싣지 않고 run만 싣는다. 이 메시지가 연 turn은 unattended다(approval.md "turn mode").
  unattended: z.literal(true).optional(),
});

export const sendMessage = defineCommand({
  resource: "messages",
  method: "send",
  name: "SendMessage",
  input: sendMessageInputSchema,
  output: z.object({ message: idSchema("msg"), state_seq: seqSchema }),
  compare: z.strictObject({}),
  actors: ["user"],
  errors: [
    "invalid_input",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
    "unauthorized",
  ],
});

// 받는 session 기록의 메시지에 붙는 봉투 칸이다. 사람 메시지는 call, reply_to가 null이다.
// annotation 이미지는 message part로 싣지 않는다. refs의 annotation id로 가리키고, prompt를 조립할 때
// 그 id로 screenshot을 읽는다.
// reply, event, fail_reason은 뒤 turn의 history가 받은 turn의 입력과 같은 글을 만들게 배달 때 싣는다.
// 해당 종류가 아니면 null이다: reply는 call의 답 방식, event는 reaction이 알리는 사실 이름, fail_reason은
// program이 보낸 실패한 답의 이유, step은 workflow가 보낸 step 입력의 instance와 step 이름.
export const receivedEnvelopeSchema = z.object({
  from: callFromOutputSchema,
  call: idSchema("cal").nullable(),
  reply_to: idSchema("cal").nullable(),
  refs: z.array(callRefOutputSchema),
  reply: callReplySchema.nullable(),
  event: z.string().nullable(),
  fail_reason: callFailReasonSchema.nullable(),
  // step 입력이 가리키는 workflow instance와 step 이름. step이 아니면 null이다.
  step: z.object({ instance: idSchema("wfi"), step: z.string() }).nullable(),
});

// 받는 쪽이 본문의 tag를 고르는 기준이다.
const routedInputKindSchema = z.enum([
  "message",
  "call",
  "reply",
  "reaction",
  "notice",
  "step",
]);
export type RoutedInputKind = z.infer<typeof routedInputKindSchema>;

// 입력함에서 아직 turn이 가져가지 않은 사람 메시지(next_turn)를 다루는 memory route다.
const queuedInputSchema = z.strictObject({
  session: idSchema("ses"),
  message: idSchema("msg"),
});
const queuedErrors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
  "unauthorized",
] as const;

// 도는 turn에 steer로 지금 넣는다. 도는 turn이 없거나 이미 가져갔으면 conflict다.
export const steerQueuedNow = defineMemory({
  resource: "session_inputs",
  method: "steer_now",
  name: "SteerQueuedNow",
  input: queuedInputSchema,
  output: z.strictObject({ message: idSchema("msg") }),
  actors: ["user"],
  errors: queuedErrors,
});

// 입력함에서 뺀다. 이미 turn이 가져갔으면 conflict다.
export const removeQueued = defineMemory({
  resource: "session_inputs",
  method: "remove",
  name: "RemoveQueued",
  input: queuedInputSchema,
  output: z.strictObject({ message: idSchema("msg") }),
  actors: ["user"],
  errors: queuedErrors,
});

// 아직 turn이 가져가지 않은 사람 메시지의 글을 바꾼다. 저장된 본문과 입력함의 글을 같이 바꾼다.
export const editQueued = defineMemory({
  resource: "session_inputs",
  method: "edit",
  name: "EditQueued",
  input: z.strictObject({
    session: idSchema("ses"),
    message: idSchema("msg"),
    content: userContentBlocksSchema,
  }),
  output: z.strictObject({ message: idSchema("msg") }),
  actors: ["user"],
  errors: queuedErrors,
});

// 아직 turn이 가져가지 않은 사람 메시지를 입력함 안에서 이웃과 맞바꾼다.
export const moveQueued = defineMemory({
  resource: "session_inputs",
  method: "move",
  name: "MoveQueued",
  input: z.strictObject({
    session: idSchema("ses"),
    message: idSchema("msg"),
    direction: z.enum(["up", "down"]),
  }),
  output: z.strictObject({ message: idSchema("msg") }),
  actors: ["user"],
  errors: queuedErrors,
});

export const QUEUED_INPUT_ROUTES = [
  steerQueuedNow,
  removeQueued,
  editQueued,
  moveQueued,
] as const;
