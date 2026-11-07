import { z } from "zod";
import { defineCommand, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { atSchema } from "../base/values.ts";
import { annotationIdSchema } from "../apps/annotation.ts";
import { withReadCommon } from "../base/envelope.ts";
import { contentBlocksSchema } from "./content-block.ts";
import {
  agentAddressSchema,
  agentAtWorkspaceOutputSchema,
  agentIdSchema,
  workspaceOutputSchema,
} from "./workspaces.ts";

// call은 agent·사람·program이 다른 session에 일을 맡기거나 답하는 봉투다.
// 보낸 쪽 입력(strict)과 저장·output(느슨한 쪽)을 같은 factory로 만든다.
function obj<S extends z.ZodRawShape>(strict: boolean, shape: S) {
  return strict ? z.strictObject(shape) : z.object(shape);
}

export const CALL_REPLIES = ["none", "result", "conversation"] as const;
export const callReplySchema = z.enum(CALL_REPLIES);
export type CallReply = z.infer<typeof callReplySchema>;

function fromSchemas(strict: boolean) {
  return z.discriminatedUnion("kind", [
    obj(strict, { kind: z.literal("human") }),
    // program이 낸 입력이다(늦은 실패 알림, 취소 알림, tools_changed 알림).
    obj(strict, { kind: z.literal("program") }),
    obj(strict, { kind: z.literal("agent"), session: idSchema("ses") }),
  ]);
}
export const callFromOutputSchema = fromSchemas(false);
export type CallFrom = z.infer<typeof callFromOutputSchema>;

// 근거 링크.
function refSchemas(strict: boolean) {
  return z.discriminatedUnion("kind", [
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
  "closed",
  "receiver_ended",
  "lophn_restarted",
] as const;
export const callFailReasonSchema = z.enum(CALL_FAIL_REASONS);
export type CallFailReason = z.infer<typeof callFailReasonSchema>;

// 끝난 call은 다시 열지 않는다. 배달 실패는 accepted를 거치지 않고 바로 failed로 생긴다.
export function callCanMove(from: CallState, to: CallState): boolean {
  return from === "accepted" && to !== "accepted";
}

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

// 닫힌 call에 늦게 온 답은 오류가 아니라 closed: true로 돌려준다.
export const callReply = defineCommand({
  resource: "calls",
  method: "reply",
  name: "ReplyCall",
  input: z.strictObject({
    call: idSchema("cal"),
    body: contentBlocksSchema,
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

export const callAddressInputSchema = z.union([
  z.strictObject({ session: idSchema("ses") }),
  agentAddressSchema,
  agentAddressSchema.extend({
    session: idSchema("ses"),
    fallback: z.literal("new"),
  }),
]);
export type CallAddressInput = z.infer<typeof callAddressInputSchema>;

export const callTargetSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("new_session"),
    agent: agentAtWorkspaceOutputSchema,
  }),
  z.object({ kind: z.literal("open_session"), session: idSchema("ses") }),
  z.object({
    kind: z.literal("open_session_or_new"),
    session: idSchema("ses"),
    agent: agentAtWorkspaceOutputSchema,
  }),
]);
export type CallTarget = z.infer<typeof callTargetSchema>;

// Router 안에서 쓰는 풀린 봉투다. from은 core가 호출자 identity로 채운다.
export const agentCallEnvelopeSchema = z
  .object({
    call: idSchema("cal"),
    from: callFromOutputSchema,
    to: callTargetSchema,
    reply: callReplySchema,
    body: contentBlocksSchema,
    refs: z.array(callRefOutputSchema),
    reply_to: idSchema("cal").nullable(),
    // 보낸 쪽 tool call ID. agent가 보낸 call에만 있다.
    dedup: z.string().min(1).nullable(),
    // 보낸 turn의 mode가 unattended면 true. 답과 늦은 실패, 취소 알림이 이 표시를 따른다.
    unattended: z.boolean(),
  })
  .refine((v) => v.dedup === null || v.from.kind === "agent", {
    message: "dedup is only for an agent-originated call",
  });
export type AgentCallEnvelope = z.infer<typeof agentCallEnvelopeSchema>;

// agent_calls 행이다. 내용(body, refs)은 받는 session 기록에 있다.
export const agentCallRowSchema = z
  .object({
    call: idSchema("cal"),
    from: callFromOutputSchema,
    to: callTargetSchema,
    // 배달이 실패하면 null이다.
    receiver_session: idSchema("ses").nullable(),
    reply: callReplySchema,
    state: callStateSchema,
    fail_reason: callFailReasonSchema.nullable(),
    dedup: z.string().min(1).nullable(),
    unattended: z.boolean(),
    created_at: atSchema,
    state_changed_at: atSchema,
  })
  .refine((v) => (v.state === "failed") === (v.fail_reason !== null), {
    message: "fail_reason belongs to a failed call",
  });
export type AgentCallRow = z.infer<typeof agentCallRowSchema>;

export const agentCallSend = defineCommand({
  resource: "calls",
  method: "send",
  name: "SendCall",
  input: z.strictObject({
    to: callAddressInputSchema,
    reply: callReplySchema,
    body: contentBlocksSchema,
    refs: z.array(callRefSchema),
    dedup: z.string().min(1),
  }),
  output: z.object({
    call: idSchema("cal"),
    state: callStateSchema,
    fail_reason: callFailReasonSchema.nullable(),
  }),
  compare: z.strictObject({}),
  actors: ["agent"],
  errors: [...commandErrors],
});

export const agentCallSendable = defineRead({
  resource: "calls",
  method: "sendable",
  name: "ListSendableSessions",
  input: z.strictObject({}),
  output: withReadCommon(
    z.object({
      sessions: z.array(
        z.object({
          session: idSchema("ses"),
          // agent의 주소(handle)와 보이는 이름이다. 새 session을 열 때는 handle을 쓴다.
          handle: z.string(),
          name: z.string(),
          title: z.string().nullable(),
          workspace: workspaceOutputSchema.nullable(),
          // waiting은 사람의 동의나 질문 답을 기다리는 turn이다.
          state: z.enum(SENDABLE_SESSION_STATES),
          // 마지막 turn이 끝난(없으면 시작한) 시각. turn이 없으면 null이다.
          last_active_at: z.string().nullable(),
        }),
      ),
    }),
  ),
  actors: ["agent"],
  errors: [...readErrors],
});

// 상태 구독은 없다. 누를 때 읽는다.
export const agentCallRead = defineRead({
  resource: "calls",
  method: "read",
  name: "ReadCall",
  input: z.strictObject({ call: idSchema("cal") }),
  output: withReadCommon(z.object({ call: agentCallRowSchema })),
  actors: ["user", "agent", "machine"],
  errors: [...readErrors],
});

export const AGENT_CALL_ROUTES = [
  agentCallSend,
  callReply,
  callCancel,
  agentCallSendable,
  agentCallRead,
] as const;
