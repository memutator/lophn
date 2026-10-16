import { z } from "zod";
import { actorSchema } from "../base/actor.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { seqSchema, sha256Schema } from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import {
  agentMessageContentInputSchema,
  messageContentSchema,
  userMessageContentInputSchema,
} from "./message-content.ts";

const messageModeSchema = z.enum(["request", "correction"]);
function links(strict: boolean) {
  function object<S extends z.ZodRawShape>(shape: S) {
    return strict ? z.strictObject(shape) : z.object(shape);
  }
  return z.discriminatedUnion("kind", [
    object({ kind: z.literal("document"), document: idSchema("doc") }),
    object({
      kind: z.literal("version"),
      document: idSchema("doc"),
      version: idSchema("ver"),
    }),
    object({ kind: z.literal("question"), question: idSchema("qst") }),
    object({
      kind: z.literal("approval_request"),
      approval_request: idSchema("apr"),
    }),
    object({ kind: z.literal("context"), context: idSchema("ctx") }),
    object({ kind: z.literal("model_call"), call: idSchema("mcl") }),
    object({ kind: z.literal("tool_call"), call: idSchema("tcl") }),
  ]);
}
const messageLinkSchema = links(false);
const messageSchema = z.object({
  id: idSchema("msg"),
  session: idSchema("ses"),
  actor: actorSchema,
  body: sha256Schema,
  turn: idSchema("trn").nullable(),
  mode: messageModeSchema.nullable(),
  applied_at_call: idSchema("mcl").nullable(),
  links: z.array(messageLinkSchema),
  // Fork로 복사한 메시지에만 있는 원래 메시지. 지난 발언이라 turn·mode·반영 연결이 없다.
  copied_from: idSchema("msg").nullable(),
}).refine(
  (value) =>
    value.copied_from !== null
      ? value.mode === null && value.turn === null &&
        value.applied_at_call === null
      : value.actor === "user"
      ? value.mode !== null
      : (value.actor === "machine" || value.actor.startsWith("agent:")) &&
        value.mode === null,
  { message: "message actor and mode mismatch" },
).refine(
  (value) => value.applied_at_call === null || value.turn !== null,
  { message: "applied message requires a turn" },
).refine(
  (value) => value.mode !== "correction" || value.turn !== null,
  { message: "correction requires a target turn" },
);
function validMessageSeqs(value: { created_seq: string; state_seq: string }) {
  return seqSchema.safeParse(value.created_seq).success &&
    seqSchema.safeParse(value.state_seq).success &&
    BigInt(value.created_seq) <= BigInt(value.state_seq);
}
const messageSnapshotSchema = z.object({
  message: messageSchema,
  created_seq: seqSchema,
  state_seq: seqSchema,
}).refine(validMessageSeqs, {
  message: "message state precedes creation",
});
const messageCommandOutputSchema = z.object({
  message: messageSchema,
  created_seq: seqSchema,
  state_seq: seqSchema,
}).refine(validMessageSeqs, {
  message: "message state precedes creation",
});
const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const commandErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
] as const;
// 본문은 값 그대로 싣는다. core가 redaction을 거쳐 blob으로 준비하고 command가 영구
// 참조를 등록한다. 호출자는 hash를 만들지도 blob을 준비하지도 않는다.
const receiveMessageInputSchema = z.strictObject({
  id: idSchema("msg"),
  session: idSchema("ses"),
  content: userMessageContentInputSchema,
  mode: messageModeSchema,
  turn: idSchema("trn").optional(),
}).refine((value) => value.mode !== "correction" || value.turn !== undefined, {
  message: "correction requires target turn",
});
const receiveMessageCompareSchema = z.strictObject({
  session_state: z.literal("open"),
  session_state_seq: seqSchema,
  assignment_revision: revision,
  // paused·withdrawn은 새 입력을 거절한다.
  assignment_state: z.literal("enabled"),
});
export const receiveMessage = defineCommand({
  resource: "messages",
  method: "receive",
  name: "ReceiveMessage",
  input: receiveMessageInputSchema,
  compare: receiveMessageCompareSchema,
  output: messageCommandOutputSchema,
  actors: ["user"],
  errors: commandErrors,
});
// agent의 답을 그 session의 기록에 남긴다. 받은 message와 같은 봉투로 쓴다: 보낸 쪽은 그 session
// 자신(`from: agent`)이고 `turn`은 답한 turn이다. 도는 turn의 session만 받는다.
const recordMessageInputSchema = z.strictObject({
  id: idSchema("msg"),
  session: idSchema("ses"),
  turn: idSchema("trn"),
  // agent는 글·시각 블록, machine은 글만 낸다(owner가 actor로 검사한다).
  content: agentMessageContentInputSchema,
});
export const recordMessage = defineCommand({
  resource: "messages",
  method: "record",
  name: "RecordMessage",
  input: recordMessageInputSchema,
  output: z.object({ message: idSchema("msg"), state_seq: seqSchema }),
  actors: ["agent", "machine"],
  errors: commandErrors,
});
const messagesListInputSchema = z.strictObject({
  session: idSchema("ses"),
  turn: idSchema("trn").optional(),
  after_seq: seqSchema.optional(),
  through_seq: seqSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).refine(
  (value) =>
    (value.after_seq === undefined ||
      seqSchema.safeParse(value.after_seq).success) &&
    (value.through_seq === undefined ||
      seqSchema.safeParse(value.through_seq).success) &&
    (value.after_seq === undefined || value.through_seq === undefined ||
      BigInt(value.after_seq) < BigInt(value.through_seq)),
  { message: "empty or inverted seq range" },
);
const messagesListOutputSchema = withReadCommon(
  z.object({ messages: z.array(messageSnapshotSchema) }),
).refine((value) => {
  if (!seqSchema.safeParse(value.as_of_seq).success) return false;
  let previous = -1n;
  const ids = new Set<string>();
  return value.messages.every((entry) => {
    if (!validMessageSeqs(entry)) return false;
    const created = BigInt(entry.created_seq);
    const state = BigInt(entry.state_seq);
    const valid = created > previous && !ids.has(entry.message.id) &&
      created <= state && state <= BigInt(value.as_of_seq);
    previous = created;
    ids.add(entry.message.id);
    return valid;
  });
}, { message: "messages must be unique, ordered and within snapshot" });
export const messagesList = defineRead({
  resource: "messages",
  method: "list",
  name: "ListMessages",
  input: messagesListInputSchema,
  output: messagesListOutputSchema,
  actors: ["user", "agent", "machine"],
  errors: commandErrors.filter((code) => code !== "conflict"),
});
// 확정 메시지 하나의 본문. 허용된 읽는 쪽(사람, 그 assignment의 agent, machine)만
// 읽고, 범위 밖 메시지는 없는 메시지와 똑같이 not_found다. 본문 blob은 core가 읽고
// hash를 확인한 뒤 값으로 돌려준다.
export const messageBodyInputSchema = z.strictObject({
  message: idSchema("msg"),
});
const messageBodyOutputSchema = withReadCommon(z.object({
  message: idSchema("msg"),
  session: idSchema("ses"),
  body: sha256Schema,
  size_bytes: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  content: messageContentSchema,
}));
export const messageBody = defineRead({
  resource: "messages",
  method: "body",
  name: "ReadMessageBody",
  input: messageBodyInputSchema,
  output: messageBodyOutputSchema,
  actors: ["user", "agent", "machine"],
  errors: commandErrors.filter((code) => code !== "conflict"),
});
export const MESSAGE_ROUTES = [
  receiveMessage,
  recordMessage,
  messagesList,
  messageBody,
] as const;

// owner는 링크 존재·같은 session/assignment/turn·최초 반영 transaction·blob
// 영구 참조 등록·authenticated actor·보존 request의 사람 선택·idempotency를 검사한다.
// redaction과 blob 준비는 core가 command 앞에서 한다.
