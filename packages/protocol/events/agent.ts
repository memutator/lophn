import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { atSchema, durationMsSchema } from "../base/values.ts";
import { turnRequestSchema } from "../approvals/mod.ts";
import { callFromOutputSchema } from "../lophn-agent/calls.ts";
import { contentBlockSchema } from "../lophn-agent/content-block.ts";
import {
  agentIdSchema,
  workspaceOutputSchema,
} from "../lophn-agent/workspaces.ts";
import { toolCallDisplaySchema } from "../lophn-agent/tool-values.ts";
import { turnOutcomeOutputSchema } from "../lophn-agent/turn-values.ts";
import { eventTypeSchema } from "../base/event.ts";

// agent event는 session에서 일어나고 메모리로만 흐른다. seq가 없고 저장하지 않는다.
// ToolCallStarted·ToolCallEnded, QuestionAsked·QuestionResolved, CompactStarted·CompactEnded는 core가 낸다.
// MessageRecorded는 agent runtime이 감독 pipe로 내고 core가 Bus에 낸다.
// ModelOutputStreamed(agent runtime이 보낸 날 글을 core가 redaction한 것)와 TurnResumed는 core가 낸다.
// model 호출의 시작·끝은 event로 두지 않는다(쓰는 중인 글만 흐른다).

type AgentEventDefinition<
  T extends string = string,
  P extends z.ZodType = z.ZodType,
> = { type: T; payload: P };

function defineAgentEvent<T extends string, P extends z.ZodType>(
  type: T,
  payload: P,
): AgentEventDefinition<T, P> {
  if (!eventTypeSchema.safeParse(type).success) {
    throw new Error("event type must be <Entity><과거형 동사> PascalCase");
  }
  return { type, payload };
}

function agentEventEnvelopeSchema<T extends string, P extends z.ZodType>(
  definition: AgentEventDefinition<T, P>,
) {
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
const modelCall = idSchema("mcl");

// title은 싣지 않는다. 필요하면 session을 read로 읽는다.
const sessionStarted = defineAgentEvent(
  "SessionStarted",
  z.strictObject({
    agent: agentIdSchema,
    workspace: workspaceOutputSchema.nullable(),
    revived: z.boolean(),
  }),
);

// 사람 메시지, call, 답, reaction이 모두 이것으로 보인다. steer는 도는 turn 안에서 들어온 메시지다.
const messageReceived = defineAgentEvent(
  "MessageReceived",
  z.strictObject({
    message: idSchema("msg"),
    body: z.array(contentBlockSchema),
    from: callFromOutputSchema,
    call: idSchema("cal").nullable(),
    reply_to: idSchema("cal").nullable(),
    steer: z.boolean(),
  }),
);

// 다음 turn 줄의 사람 메시지를 [Send now]로 도는 turn의 steer로 올렸다. 다음 model 요청에 실린다.
const messageSteered = defineAgentEvent(
  "MessageSteered",
  z.strictObject({ message: idSchema("msg") }),
);

// 다음 turn 줄의 사람 메시지를 뺐다. 기록에서도 지워졌다.
const messageRemoved = defineAgentEvent(
  "MessageRemoved",
  z.strictObject({ message: idSchema("msg") }),
);

const turnStarted = defineAgentEvent(
  "TurnStarted",
  z.strictObject({ turn, input_message: idSchema("msg") }),
);

// outcome은 turnOutcomeSchema와 같은 값이다. active_ms는 사람 기다림을 뺀 일한 시간이고 모르면 null이다.
const turnEnded = defineAgentEvent(
  "TurnEnded",
  z.strictObject({
    turn,
    outcome: turnOutcomeOutputSchema,
    messages: z.array(idSchema("msg")),
    active_ms: durationMsSchema.nullable(),
    error: z
      .strictObject({ code: z.string().min(1), message: z.string() })
      .nullable(),
  }),
);

// 사람 기다림(승인, 질문)이 끝나 turn이 다시 일하는 순간이다. envelope의 at이 그 순간이고 active_ms는
// 그때까지 사람 기다림을 뺀 시간이다.
const turnResumed = defineAgentEvent(
  "TurnResumed",
  z.strictObject({ turn, active_ms: durationMsSchema }),
);

// core가 낸다. offset은 같은 model_call·kind에서 앞서 낸 글의 UTF-16 길이이고 redaction을 거친 글로 센다.
// 다른 model_call의 조각이 오면 앞 model 호출의 쓰는 중인 글을 버린다. 쌓인 글 전체에 redaction을 걸고
// 끝을 붙잡는 규칙은 내는 쪽이 지킨다.
const modelOutputStreamed = defineAgentEvent(
  "ModelOutputStreamed",
  z.strictObject({
    turn,
    model_call: modelCall,
    kind: z.enum(["text", "reasoning"]),
    offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    text: z.string().min(1),
  }),
);

// agent runtime이 model 응답의 agent message를 RecordMessage로 저장한 뒤 낸다. 화면은 그 model_call의
// 쓰는 중인 글을 버리고 message 본문을 읽는다. harness host가 낸 message는 model 호출이 없어 model_call이 null이다.
const messageRecorded = defineAgentEvent(
  "MessageRecorded",
  z.strictObject({
    turn,
    message: idSchema("msg"),
    model_call: modelCall.nullable(),
  }),
);

// display는 낼 때 만들고 지금의 redaction을 거친다.
const toolCallStarted = defineAgentEvent(
  "ToolCallStarted",
  z.strictObject({
    turn,
    tool_call: toolCall,
    tool: z.string().min(1),
    display: toolCallDisplaySchema,
  }),
);

const toolCallEnded = defineAgentEvent(
  "ToolCallEnded",
  z.strictObject({
    turn,
    tool_call: toolCall,
    outcome: z.enum(["ok", "error", "denied", "cancelled"]),
  }),
);

const turnRequestOpened = defineAgentEvent(
  "TurnRequestOpened",
  z.strictObject({ request: turnRequestSchema }),
);

const turnRequestClosed = defineAgentEvent(
  "TurnRequestClosed",
  z.strictObject({
    request: idSchema("apr"),
    outcome: z.enum(["allow", "reject", "cancelled"]),
  }),
);

// 질문 내용은 싣지 않는다. session snapshot과 질문 read가 준다.
const questionAsked = defineAgentEvent(
  "QuestionAsked",
  z.strictObject({ group, turn, tool_call: toolCall }),
);

const questionResolved = defineAgentEvent(
  "QuestionResolved",
  z.strictObject({
    group,
    outcome: z.enum(["submitted", "cancelled", "human_message"]),
  }),
);

const compactStarted = defineAgentEvent(
  "CompactStarted",
  z.strictObject({ turn: turn.nullable() }),
);

const compactEnded = defineAgentEvent(
  "CompactEnded",
  z.strictObject({ ok: z.boolean() }),
);

const sessionEnded = defineAgentEvent(
  "SessionEnded",
  z.strictObject({
    reason: z.enum(["archived", "deleted", "exited", "lophn_stopped"]),
  }),
);

export const agentEventSchema = z.discriminatedUnion("type", [
  agentEventEnvelopeSchema(sessionStarted),
  agentEventEnvelopeSchema(messageReceived),
  agentEventEnvelopeSchema(messageSteered),
  agentEventEnvelopeSchema(messageRemoved),
  agentEventEnvelopeSchema(turnStarted),
  agentEventEnvelopeSchema(turnEnded),
  agentEventEnvelopeSchema(turnResumed),
  agentEventEnvelopeSchema(modelOutputStreamed),
  agentEventEnvelopeSchema(messageRecorded),
  agentEventEnvelopeSchema(toolCallStarted),
  agentEventEnvelopeSchema(toolCallEnded),
  agentEventEnvelopeSchema(turnRequestOpened),
  agentEventEnvelopeSchema(turnRequestClosed),
  agentEventEnvelopeSchema(questionAsked),
  agentEventEnvelopeSchema(questionResolved),
  agentEventEnvelopeSchema(compactStarted),
  agentEventEnvelopeSchema(compactEnded),
  agentEventEnvelopeSchema(sessionEnded),
]);
export type AgentEvent = z.infer<typeof agentEventSchema>;
