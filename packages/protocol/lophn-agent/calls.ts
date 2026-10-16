import { z } from "zod";
import { defineCommand, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { atSchema, seqSchema } from "../base/values.ts";
import { annotationIdSchema } from "../apps/annotation.ts";
import { codingOptionsSchema } from "../coding-agent/harness-id.ts";
import { withReadCommon } from "../base/envelope.ts";
import {
  agentRefOutputSchema,
  agentRefSchema,
  placeOutputSchema,
  roleSchema,
} from "./places.ts";

// call은 agent·사람·program이 다른 session에 일을 맡기거나 답하는 봉투다.
// 보낸 쪽 입력(strict)과 저장·output(느슨한 쪽)을 같은 factory로 만든다.
function obj<S extends z.ZodRawShape>(strict: boolean, shape: S) {
  return strict ? z.strictObject(shape) : z.object(shape);
}

export const CALL_REPLIES = ["none", "result", "conversation"] as const;
const callReplySchema = z.enum(CALL_REPLIES);
export type CallReply = z.infer<typeof callReplySchema>;

function fromSchemas(strict: boolean) {
  return z.discriminatedUnion("kind", [
    obj(strict, { kind: z.literal("human") }),
    // 근거 domain event의 seq다.
    obj(strict, { kind: z.literal("program"), event_seq: seqSchema }),
    obj(strict, { kind: z.literal("agent"), session: idSchema("ses") }),
    // coding agent의 CLI 메시지. 그 harness session이다.
    obj(strict, { kind: z.literal("coding_agent"), session: idSchema("ses") }),
  ]);
}
export const callFromOutputSchema = fromSchemas(false);
export type CallFrom = z.infer<typeof callFromOutputSchema>;

// 받을 agent. AgentRef에 App의 coding agent 가지를 더했다.
export const callAgentSchema = z.discriminatedUnion("role", [
  ...agentRefSchema.options,
  z.strictObject({ role: z.literal("coding_agent"), app: idSchema("app") }),
]);
export const callAgentOutputSchema = z.discriminatedUnion("role", [
  ...agentRefOutputSchema.options,
  z.object({ role: z.literal("coding_agent"), app: idSchema("app") }),
]);
export type CallAgent = z.infer<typeof callAgentOutputSchema>;

// agent가 tool에 쓰는 받는 이름이다. 정확히 맞는 것만 푼다. lophn은 place가 없고 Operator는 name을 준다.
const namedAgentSchema = z.strictObject({
  role: z.union([roleSchema, z.literal("coding_agent")]),
  place: z.union([
    z.strictObject({ project: z.string().min(1) }),
    z.strictObject({ app: z.string().min(1) }),
  ]).optional(),
  name: z.string().min(1).optional(),
});
export type NamedAgent = z.infer<typeof namedAgentSchema>;

// 보내는 쪽이 쓰는 받는 곳 셋(이름 기준). Router가 이름을 푼다.
const callToInputSchema = z.union([
  z.strictObject({ session: idSchema("ses") }),
  namedAgentSchema,
  namedAgentSchema.extend({
    session: idSchema("ses"),
    fallback: z.literal("new"),
  }),
]);
export type CallToInput = z.infer<typeof callToInputSchema>;

// 풀린 뒤 agent_calls 행에 남는 받는 곳 셋(id 기준).
export const callToSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("new_session"), agent: callAgentOutputSchema }),
  z.object({ kind: z.literal("open_session"), session: idSchema("ses") }),
  z.object({
    kind: z.literal("open_session_or_new"),
    session: idSchema("ses"),
    agent: callAgentOutputSchema,
  }),
]);
export type CallTo = z.infer<typeof callToSchema>;

// 근거 링크. annotation은 ticket evidence와 같은 {kind, id} 꼴이다.
function refSchemas(strict: boolean) {
  return z.discriminatedUnion("kind", [
    obj(strict, { kind: z.literal("ticket"), ticket: idSchema("tkt") }),
    obj(strict, { kind: z.literal("problem"), problem: idSchema("prb") }),
    obj(strict, { kind: z.literal("file"), path: z.string().min(1) }),
    obj(strict, { kind: z.literal("session"), session: idSchema("ses") }),
    obj(strict, { kind: z.literal("annotation"), id: annotationIdSchema }),
  ]);
}
export const callRefSchema = refSchemas(true);
export const callRefOutputSchema = refSchemas(false);
export type CallRef = z.infer<typeof callRefOutputSchema>;

export const CALL_STATES = ["accepted", "done", "failed", "cancelled"] as const;
const callStateSchema = z.enum(CALL_STATES);
export type CallState = z.infer<typeof callStateSchema>;

export const CALL_FAIL_REASONS = [
  "not_found",
  "not_allowed",
  "closed",
  "receiver_ended",
  "lophn_restarted",
] as const;
const callFailReasonSchema = z.enum(CALL_FAIL_REASONS);
export type CallFailReason = z.infer<typeof callFailReasonSchema>;

// 끝난 call은 다시 열지 않는다. 배달 실패는 accepted를 거치지 않고 바로 failed로 생긴다.
export function callCanMove(from: CallState, to: CallState): boolean {
  return from === "accepted" && to !== "accepted";
}

// options는 새 coding session을 띄울 때만 뜻이 있다.
function launchesCoding(to: CallTo): boolean {
  return to.kind !== "open_session" && to.agent.role === "coding_agent";
}

// Router 안에서 쓰는 풀린 봉투다. from은 core가 호출자 identity로 채운다.
const callEnvelopeSchema = z.object({
  call: idSchema("cal"),
  from: callFromOutputSchema,
  to: callToSchema,
  reply: callReplySchema,
  body: z.string().min(1),
  refs: z.array(callRefOutputSchema),
  reply_to: idSchema("cal").nullable(),
  // 보낸 쪽 tool call ID. agent가 보낸 call에만 있다.
  dedup: z.string().min(1).nullable(),
  options: codingOptionsSchema.nullable(),
}).refine((v) => v.options === null || launchesCoding(v.to), {
  message: "options are only for launching a coding agent",
}).refine((v) => v.dedup === null || v.from.kind === "agent", {
  message: "dedup is only for an agent-originated call",
});
export type CallEnvelope = z.infer<typeof callEnvelopeSchema>;

// agent_calls 행이다. 내용(body, refs)은 받는 session 기록에 있다.
const agentCallRecordSchema = z.object({
  call: idSchema("cal"),
  from: callFromOutputSchema,
  to: callToSchema,
  // 줄에 서서 기다리는 coding 맡기기와 배달 실패는 null이다.
  receiver_session: idSchema("ses").nullable(),
  reply: callReplySchema,
  state: callStateSchema,
  fail_reason: callFailReasonSchema.nullable(),
  dedup: z.string().min(1).nullable(),
  created_at: atSchema,
  state_changed_at: atSchema,
}).refine((v) => (v.state === "failed") === (v.fail_reason !== null), {
  message: "fail_reason belongs to a failed call",
});
export type AgentCallRecord = z.infer<typeof agentCallRecordSchema>;

const commandErrors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
  "unauthorized",
] as const;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

// tool `call`의 입력이다. from은 core가 채우고 call ID는 Router가 만든다.
export const callSendInputSchema = z.strictObject({
  to: callToInputSchema,
  reply: callReplySchema,
  body: z.string().min(1),
  refs: z.array(callRefSchema),
  options: codingOptionsSchema.optional(),
  dedup: z.string().min(1),
  // call tool이 ToolGate에서 사람의 허락을 받은 뒤에만 싣는다. 묻는 grant를 통과시키고 deny는 못 푼다.
  gate_allowed: z.literal(true).optional(),
});

export const callSend = defineCommand({
  resource: "calls",
  method: "send",
  name: "SendCall",
  input: callSendInputSchema,
  output: z.object({
    call: idSchema("cal"),
    state: callStateSchema,
    fail_reason: callFailReasonSchema.nullable(),
  }),
  compare: z.strictObject({}),
  actors: ["agent"],
  errors: [...commandErrors],
});

// 닫힌 call에 늦게 온 답은 오류가 아니라 closed: true로 돌려준다.
export const callReply = defineCommand({
  resource: "calls",
  method: "reply",
  name: "ReplyCall",
  input: z.strictObject({
    call: idSchema("cal"),
    body: z.string().min(1),
    refs: z.array(callRefSchema).default([]),
  }),
  output: z.object({ delivered: z.boolean(), closed: z.boolean() }),
  actors: ["agent"],
  errors: [...commandErrors],
});

// agent는 자기가 보낸 것만, 사람은 모두 취소한다. 판정은 core handler가 한다.
export const callCancel = defineCommand({
  resource: "calls",
  method: "cancel",
  name: "CancelCall",
  input: z.strictObject({
    call: idSchema("cal"),
    reason: z.string().min(1).optional(),
  }),
  output: z.object({ call: idSchema("cal"), state: callStateSchema }),
  actors: ["agent", "user"],
  errors: [...commandErrors],
});

export const SENDABLE_SESSION_STATES = [
  "running",
  "waiting",
  "idle",
  "unknown",
] as const;

export const callSendable = defineRead({
  resource: "calls",
  method: "sendable",
  name: "ListSendableSessions",
  input: z.strictObject({}),
  output: withReadCommon(z.object({
    sessions: z.array(z.object({
      session: idSchema("ses"),
      role: z.union([roleSchema, z.literal("coding_agent")]),
      place: placeOutputSchema.nullable(),
      name: z.string(),
      state: z.enum(SENDABLE_SESSION_STATES),
    })),
    queued_coding: z.array(z.object({
      call: idSchema("cal"),
      app: idSchema("app"),
    })),
  })),
  actors: ["agent"],
  errors: [...readErrors],
});

// 상태 구독은 없다. 누를 때 읽는다.
export const callRead = defineRead({
  resource: "calls",
  method: "read",
  name: "ReadCall",
  input: z.strictObject({ call: idSchema("cal") }),
  output: withReadCommon(z.object({ call: agentCallRecordSchema })),
  actors: ["user", "agent", "machine"],
  errors: [...readErrors],
});

// registry에는 lead가 올린다.
export const CALL_ROUTES = [
  callSend,
  callReply,
  callCancel,
  callSendable,
  callRead,
] as const;
