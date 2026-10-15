import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { atSchema } from "../base/values.ts";
import { turnPermissionRequestSchema } from "../approvals/mod.ts";
import {
  callAgentOutputSchema,
  callFromOutputSchema,
} from "../lophn-agent/calls.ts";
import { placeOutputSchema } from "../lophn-agent/places.ts";
import { turnOutcomeOutputSchema } from "../lophn-agent/turn-values.ts";
import { eventTypeSchema } from "../base/event.ts";

// agent event는 session에서 일어나고 메모리로만 흐른다. seq가 없고 저장하지 않는다.
// coding agent는 SessionStarted, MessageReceived, TurnStarted, TurnEnded, SessionEnded와
// harness가 물어 올 때의 PermissionRequested·PermissionResolved만 낸다.
// ToolCall*, Question*, Compact*는 내지 않는다. subagent와 model 호출은 event로 두지 않는다.

export type AgentEventDefinition<
  T extends string = string,
  P extends z.ZodType = z.ZodType,
> = { type: T; payload: P };

export function defineAgentEvent<T extends string, P extends z.ZodType>(
  type: T,
  payload: P,
): AgentEventDefinition<T, P> {
  if (!eventTypeSchema.safeParse(type).success) {
    throw new Error("event type must be <Entity><과거형 동사> PascalCase");
  }
  return { type, payload };
}

export function agentEventEnvelopeSchema<
  T extends string,
  P extends z.ZodType,
>(definition: AgentEventDefinition<T, P>) {
  return z.object({
    session: idSchema("ses"),
    type: z.literal(definition.type),
    at: atSchema,
    payload: definition.payload,
  });
}

const turn = idSchema("trn");
const toolCall = idSchema("tcl");
const group = idSchema("qgr");

// title은 싣지 않는다. 필요하면 session을 read로 읽는다.
export const sessionStarted = defineAgentEvent(
  "SessionStarted",
  z.strictObject({
    agent: callAgentOutputSchema,
    place: placeOutputSchema.nullable(),
    external_session: z.string().min(1).nullable(),
    revived: z.boolean(),
  }),
);

// 사람 메시지, call, 답, reaction이 모두 이것으로 보인다. steer는 도는 turn 안에서 들어온 메시지다.
export const messageReceived = defineAgentEvent(
  "MessageReceived",
  z.strictObject({
    message: idSchema("msg"),
    body: z.string(),
    from: callFromOutputSchema,
    call: idSchema("cal").nullable(),
    reply_to: idSchema("cal").nullable(),
    steer: z.boolean(),
  }),
);

export const turnStarted = defineAgentEvent(
  "TurnStarted",
  z.strictObject({ turn, input_message: idSchema("msg") }),
);

// outcome은 turnOutcomeSchema와 같은 값이다.
export const turnEnded = defineAgentEvent(
  "TurnEnded",
  z.strictObject({
    turn,
    outcome: turnOutcomeOutputSchema,
    messages: z.array(idSchema("msg")),
    error: z.strictObject({ code: z.string().min(1), message: z.string() })
      .nullable(),
  }),
);

export const toolCallStarted = defineAgentEvent(
  "ToolCallStarted",
  z.strictObject({ turn, tool_call: toolCall, tool: z.string().min(1) }),
);

export const toolCallEnded = defineAgentEvent(
  "ToolCallEnded",
  z.strictObject({
    turn,
    tool_call: toolCall,
    outcome: z.enum(["ok", "error", "denied", "cancelled"]),
  }),
);

export const permissionRequested = defineAgentEvent(
  "PermissionRequested",
  z.strictObject({ request: turnPermissionRequestSchema }),
);

export const permissionResolved = defineAgentEvent(
  "PermissionResolved",
  z.strictObject({
    request: idSchema("apr"),
    outcome: z.enum(["allow", "reject", "cancelled"]),
  }),
);

// 질문 내용은 싣지 않는다. session snapshot과 질문 read가 준다.
export const questionAsked = defineAgentEvent(
  "QuestionAsked",
  z.strictObject({ group, turn, tool_call: toolCall }),
);

export const questionResolved = defineAgentEvent(
  "QuestionResolved",
  z.strictObject({
    group,
    outcome: z.enum(["submitted", "cancelled", "human_message"]),
  }),
);

export const compactStarted = defineAgentEvent(
  "CompactStarted",
  z.strictObject({ turn: turn.nullable() }),
);

export const compactEnded = defineAgentEvent(
  "CompactEnded",
  z.strictObject({ ok: z.boolean() }),
);

export const sessionEnded = defineAgentEvent(
  "SessionEnded",
  z.strictObject({
    reason: z.enum(["archived", "deleted", "exited", "lophn_stopped"]),
  }),
);

export const AGENT_EVENTS = [
  sessionStarted,
  messageReceived,
  turnStarted,
  turnEnded,
  toolCallStarted,
  toolCallEnded,
  permissionRequested,
  permissionResolved,
  questionAsked,
  questionResolved,
  compactStarted,
  compactEnded,
  sessionEnded,
] as const;

export type AgentEventType = (typeof AGENT_EVENTS)[number]["type"];

export const agentEventSchema = z.discriminatedUnion("type", [
  agentEventEnvelopeSchema(sessionStarted),
  agentEventEnvelopeSchema(messageReceived),
  agentEventEnvelopeSchema(turnStarted),
  agentEventEnvelopeSchema(turnEnded),
  agentEventEnvelopeSchema(toolCallStarted),
  agentEventEnvelopeSchema(toolCallEnded),
  agentEventEnvelopeSchema(permissionRequested),
  agentEventEnvelopeSchema(permissionResolved),
  agentEventEnvelopeSchema(questionAsked),
  agentEventEnvelopeSchema(questionResolved),
  agentEventEnvelopeSchema(compactStarted),
  agentEventEnvelopeSchema(compactEnded),
  agentEventEnvelopeSchema(sessionEnded),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;
