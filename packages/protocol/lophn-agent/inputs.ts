import { z } from "zod";
import { defineCommand, defineMemory } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { seqSchema } from "../base/values.ts";
import { userMessageContentInputSchema } from "./message-content.ts";
import {
  callFromOutputSchema,
  callRefOutputSchema,
  callRefSchema,
} from "./calls.ts";

// 사람의 보내기만 steer를 고른다. call, reply, reaction, notice는 항상 next_turn이라 값이 없다.
export const INPUT_DELIVERIES = ["next_turn", "steer"] as const;
export const inputDeliverySchema = z.enum(INPUT_DELIVERIES);
export type InputDelivery = z.infer<typeof inputDeliverySchema>;

// 사람이 composer에 붙인 것이다. 이름과 한 줄만 싣는다.
export const attachedChipSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("context"),
    context: idSchema("ctx"),
    name: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal("file"), path: z.string().min(1) }),
  z.strictObject({
    kind: z.literal("violation"),
    context: idSchema("ctx"),
    path: z.string().min(1),
    rule: z.string().min(1),
  }),
]);
export type AttachedChip = z.infer<typeof attachedChipSchema>;

// annotation 묶음도 같은 입력이다. 묶음이 만든 본문은 content에 담고 refs로 가리킨다.
// delivery가 steer인데 session이 돌고 있지 않으면 next_turn과 같다(core handler).
export const sendMessageInputSchema = z.strictObject({
  id: idSchema("msg"),
  session: idSchema("ses"),
  content: userMessageContentInputSchema,
  delivery: inputDeliverySchema,
  attached: z.array(attachedChipSchema),
  refs: z.array(callRefSchema),
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
export const receivedEnvelopeSchema = z.object({
  from: callFromOutputSchema,
  call: idSchema("cal").nullable(),
  reply_to: idSchema("cal").nullable(),
  refs: z.array(callRefOutputSchema),
});
export type ReceivedEnvelope = z.infer<typeof receivedEnvelopeSchema>;

// 받는 쪽이 본문의 tag를 고르는 기준이다. coding_agent 메시지는 call 종류로 들어온다.
export const routedInputKindSchema = z.enum([
  "message",
  "call",
  "reply",
  "reaction",
  "notice",
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

export const QUEUED_INPUT_ROUTES = [steerQueuedNow, removeQueued] as const;
