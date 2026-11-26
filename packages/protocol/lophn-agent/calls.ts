import { z } from "zod";
import { canonicalize } from "../../base/mod.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { type Id, idSchema } from "../base/ids.ts";
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
    // 앱이 보낸 call이다. slug는 보낼 때의 것이다(받은 message의 `from="app:<slug>"` tag가 늘 같은 bytes여야 해서 얼린다).
    obj(strict, {
      kind: z.literal("app"),
      app: idSchema("app"),
      slug: z.string().min(1),
    }),
    // 다른 컴퓨터의 agent가 mail로 보낸 call이다. 받는 기계만 이 보낸 쪽을 쓴다. computer는 받은 때 이 기계 명단의 그 컴퓨터 이름이고
    // name은 mail의 것이다. 둘 다 얼린다(받은 message의 `from="remote:<name>@<computer>"` tag가 늘 같은 bytes여야 한다).
    obj(strict, {
      kind: z.literal("remote"),
      machine: idSchema("mch"),
      computer: z.string().min(1).max(64),
      agent: z.string().min(1).max(64),
      session: idSchema("ses").nullable(),
      name: z.string().min(1).max(64),
    }),
  ]);
}
export const callFromOutputSchema = fromSchemas(false);
export type CallFrom = z.infer<typeof callFromOutputSchema>;

// message 행의 `from_ref`다. agent는 보낸 session이고 앱은 `<앱 id>|<slug>`다. 다른 컴퓨터는 kind를 뺀 객체의 canonical JSON이다.
// 사람과 program은 근거가 없다.
export function callFromRef(from: CallFrom): string | null {
  switch (from.kind) {
    case "human":
    case "program":
      return null;
    case "agent":
      return from.session;
    case "app":
      return `${from.app}|${from.slug}`;
    case "remote": {
      const { kind: _kind, ...rest } = from;
      return canonicalize(rest);
    }
  }
}

export function callFromOfRow(
  kind: CallFrom["kind"],
  ref: string | null,
): CallFrom {
  switch (kind) {
    case "human":
    case "program":
      return { kind };
    case "agent":
      return { kind, session: ref! as Id<"ses"> };
    case "app": {
      const [app, ...slug] = ref!.split("|");
      return { kind, app: app as Id<"app">, slug: slug.join("|") };
    }
    case "remote":
      return {
        kind,
        ...(JSON.parse(ref!) as Omit<
          Extract<CallFrom, { kind: "remote" }>,
          "kind"
        >),
      };
  }
}

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
export const callStateSchema = z.enum(CALL_STATES);
export type CallState = z.infer<typeof callStateSchema>;

// expired, skipped, old_version은 다른 컴퓨터로 보낸 call만 받는다: 만료 전에 닿지 않음, 받는 기계의 사람이 돌리지 않음,
// 받는 기계의 lophn이 mail route를 모름.
export const CALL_FAIL_REASONS = [
  "not_found",
  "closed",
  "receiver_ended",
  "lophn_restarted",
  "expired",
  "skipped",
  "old_version",
] as const;
export const callFailReasonSchema = z.enum(CALL_FAIL_REASONS);
export type CallFailReason = z.infer<typeof callFailReasonSchema>;

// 끝난 call은 다시 열지 않는다. 배달 실패는 accepted를 거치지 않고 바로 failed로 생긴다.
export function callCanMove(from: CallState, to: CallState): boolean {
  return from === "accepted" && to !== "accepted";
}

// 팀 자식의 질문(`ask`)이나 shell 승인이 사람 대신 부모에게 가는 result call이다. 부모의 답이 그 질문·승인을 푼다.
export const CALL_ASK_KINDS = ["question", "approval"] as const;
export const callAskKindSchema = z.enum(CALL_ASK_KINDS);
export type CallAskKind = z.infer<typeof callAskKindSchema>;

// 승인 call(ask = approval)의 답은 결정이 있어야 하고, 다른 call의 답은 결정을 싣지 않는다. always는 없다:
// 부모가 shell 규칙을 더하는 길은 없다.
export const CALL_DECISIONS = ["allow", "reject"] as const;
export const callDecisionSchema = z.enum(CALL_DECISIONS);
export type CallDecision = z.infer<typeof callDecisionSchema>;

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
  changes: [],
  input: z.strictObject({
    call: idSchema("cal"),
    body: contentBlocksSchema,
    refs: z.array(callRefSchema).default([]),
    decision: callDecisionSchema.optional(),
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
  changes: [],
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

// 기계를 건너는 workspace 이름이다. project는 기계 사이에 같은 정체(`pri_`), 앱은 앱 id 또는 slug, home은 그 기계의 home이다.
export const remoteWorkspaceSchema = z.union([
  z.strictObject({ project: idSchema("pri") }),
  z.strictObject({ app: z.string().min(1) }),
  z.strictObject({ home: z.literal(true) }),
]);

export const transferAttachmentSchema = z.strictObject({
  transfer: idSchema("trf"),
  name: z.string().min(1).max(255),
  size: z.number().int().min(0),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  rel_path: z.string().min(1).max(512).optional(),
});
export type TransferAttachment = z.infer<typeof transferAttachmentSchema>;
export type RemoteWorkspace = z.infer<typeof remoteWorkspaceSchema>;

// mail 안의 받는 곳. workspace를 늘 밝힌다(빼는 규칙은 보내는 입구가 푼다).
export const remoteAddressSchema = z.union([
  z.strictObject({ session: idSchema("ses") }),
  z.strictObject({
    agent: z.string().min(1).max(64),
    workspace: remoteWorkspaceSchema,
  }),
  z.strictObject({
    agent: z.string().min(1).max(64),
    workspace: remoteWorkspaceSchema,
    session: idSchema("ses"),
    fallback: z.literal("new"),
  }),
]);
export type RemoteAddress = z.infer<typeof remoteAddressSchema>;

// 다른 컴퓨터로 보낸 call의 배달 상태다. call은 그동안 accepted다.
// pending 아직 닿지 않음, unknown 보냈는데 답을 잃음(받았는지 모름), held 받는 기계의 대기 목록에서 기다림, running 받는 기계가 받아 돌림.
// mail.ts가 다시 낸다(calls.ts가 mail.ts를 import하면 순환이다).
export const MAIL_DELIVERIES = [
  "pending",
  "unknown",
  "held",
  "running",
] as const;
export const mailDeliverySchema = z.enum(MAIL_DELIVERIES);
export type MailDelivery = z.infer<typeof mailDeliverySchema>;

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
  // 다른 컴퓨터로 보낸 call. 보낸 기계의 행에만 있다. computer는 보낼 때의 명단 이름이다.
  z.object({
    kind: z.literal("remote"),
    machine: idSchema("mch"),
    computer: z.string(),
    address: remoteAddressSchema,
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
  .refine(
    (v) => v.dedup === null || v.from.kind === "agent" || v.from.kind === "app",
    {
      message: "dedup is only for an agent- or app-originated call",
    },
  );
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
    // 질문이나 승인을 부모에게 보낸 call이면 그 종류.
    ask: callAskKindSchema.nullable(),
    // 앱이 보낸 result call의 답 글. 앱 말고는 보낸 쪽에 답이 가는 곳이 call 행이 아니라 queue라 늘 null이다.
    result: z.string().nullable(),
    // 다른 컴퓨터로 보낸 행에만 있다. 아니면 null이다.
    delivery: mailDeliverySchema.nullable(),
    // 다른 컴퓨터로 보낸 call을 그 기계에서 받은 session(알면).
    remote_session: idSchema("ses").nullable(),
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
  changes: [],
  input: z.strictObject({
    to: callAddressInputSchema,
    reply: callReplySchema,
    body: contentBlocksSchema,
    refs: z.array(callRefSchema),
    attachments: z.array(transferAttachmentSchema).max(32).optional(),
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
