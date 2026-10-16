import { z } from "zod";
import {
  atSchema,
  blobSizeSchema,
  durationMsSchema,
  seqSchema,
  sha256Schema,
} from "../base/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { defineEvent } from "../base/event.ts";
import { idSchema } from "../base/ids.ts";
import { withReadCommon } from "../base/envelope.ts";
import {
  toolCallOutputSchema,
  toolDecisionSchema,
  toolEffectSchema,
  toolExtensionSchema,
  toolNameSchema,
  toolOutcomeSchema,
  toolResultSchema,
} from "./tool-values.ts";

const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const order = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const nonempty = z.string().regex(/\S/);
const hash = sha256Schema;
const errors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
] as const;

const requestFields = {
  id: idSchema("tcl"),
  turn: idSchema("trn"),
  model_call: idSchema("mcl"),
  response_key: nonempty.max(128),
  response_order: order,
  tool: toolNameSchema,
  definition_revision: nonempty,
  effect: toolEffectSchema,
  confirm: z.boolean(),
  extension: toolExtensionSchema.nullable(),
  input: hash,
  retry_of: idSchema("tcl").nullable(),
  attempt: z.union([z.literal(0), z.literal(1)]),
  // 준비한 input blob의 크기. 있으면 command가 영구 참조를 등록한다.
  input_size: blobSizeSchema.optional(),
  // 앱 command 원래 호출의 계약이다(app command tool만 싣는다). app·release·command·
  // blueprint_hash·permission_basis(grant·scope·basis_seq)와 definition·context 근거를 가진다.
  // 기록이 이 열로 묶여 revert가 앱의 선언된 revert command를 부른다.
  app_api: toolCallOutputSchema.shape.app_api.optional(),
};

const recordToolRequestInputSchema = z.strictObject(requestFields)
  .refine(
    (value) => (value.attempt === 0) === (value.retry_of === null),
    { message: "retry keeps the first tool call id" },
  );
const recordToolRequestCompareSchema = z.strictObject({
  turn_state_seq: seqSchema,
  model_call_finished_seq: seqSchema,
});
const recordToolRequestOutputSchema = z.object({
  tool_call: idSchema("tcl"),
});

export const recordToolRequest = defineCommand({
  resource: "tool-calls",
  method: "request",
  name: "RecordToolRequest",
  input: recordToolRequestInputSchema,
  compare: recordToolRequestCompareSchema,
  output: recordToolRequestOutputSchema,
  actors: ["machine"],
  errors,
});

const decideToolCallInputSchema = z.strictObject({
  tool_call: idSchema("tcl"),
  decision: toolDecisionSchema,
});
const decideToolCallCompareSchema = z.strictObject({
  state_seq: seqSchema,
});
const decideToolCallOutputSchema = z.object({
  tool_call: idSchema("tcl"),
  decision: z.enum(["allow", "ask", "deny"]),
});

export const decideToolCall = defineCommand({
  resource: "tool-calls",
  method: "decide",
  name: "DecideToolCall",
  input: decideToolCallInputSchema,
  compare: decideToolCallCompareSchema,
  output: decideToolCallOutputSchema,
  actors: ["machine"],
  errors,
});

const startToolCallInputSchema = z.strictObject({
  tool_call: idSchema("tcl"),
  started_at: atSchema,
  approval: idSchema("apr").nullable(),
});
const startToolCallCompareSchema = z.strictObject({
  state_seq: seqSchema,
  turn_state_seq: seqSchema,
  assignment_revision: revision,
});
const startToolCallOutputSchema = z.object({
  tool_call: idSchema("tcl"),
  idempotency_key: idSchema("tcl"),
});

export const startToolCall = defineCommand({
  resource: "tool-calls",
  method: "start",
  name: "StartToolCall",
  input: startToolCallInputSchema,
  compare: startToolCallCompareSchema,
  output: startToolCallOutputSchema,
  actors: ["machine"],
  errors,
});

const finishToolCallInputSchema = z.strictObject({
  tool_call: idSchema("tcl"),
  outcome: toolOutcomeSchema,
  output: hash.nullable(),
  // 준비한 output blob의 크기. 있으면 command가 영구 참조를 등록한다.
  output_size: blobSizeSchema.optional(),
  result: toolResultSchema.nullable(),
  finished_at: atSchema,
  duration_ms: durationMsSchema.nullable(),
}).refine(
  (value) => value.outcome.kind !== "success" || value.output !== null,
  { message: "success needs an output hash" },
).refine(
  (value) => value.outcome.kind !== "not_executed" || value.output === null,
  { message: "not_executed has no output" },
);
const finishToolCallCompareSchema = z.strictObject({
  state_seq: seqSchema,
});
const finishToolCallOutputSchema = z.object({
  tool_call: idSchema("tcl"),
  outcome: toolOutcomeSchema,
});

export const finishToolCall = defineCommand({
  resource: "tool-calls",
  method: "finish",
  name: "FinishToolCall",
  input: finishToolCallInputSchema,
  compare: finishToolCallCompareSchema,
  output: finishToolCallOutputSchema,
  actors: ["machine"],
  errors,
});

const recordReadToolCallInputSchema = z.strictObject({
  request: recordToolRequestInputSchema,
  decision: toolDecisionSchema,
  started_at: atSchema,
  finished_at: atSchema,
  duration_ms: durationMsSchema.nullable(),
  outcome: toolOutcomeSchema,
  output: hash.nullable(),
  result: toolResultSchema,
}).refine(
  (value) =>
    value.request.effect === "read" && value.request.confirm === false &&
    value.started_at <= value.finished_at,
  { message: "read record is a completed confirm-false read" },
);
const recordReadToolCallOutputSchema = z.object({
  tool_call: idSchema("tcl"),
});

export const recordReadToolCall = defineCommand({
  resource: "tool-calls",
  method: "record-read",
  name: "RecordReadToolCall",
  input: recordReadToolCallInputSchema,
  output: recordReadToolCallOutputSchema,
  actors: ["machine"],
  errors,
});

const supplementToolCallInputSchema = z.strictObject({
  tool_call: idSchema("tcl"),
  supplement_key: nonempty.max(128),
  fact: hash,
  note: nonempty.max(400).nullable(),
});
const supplementToolCallCompareSchema = z.strictObject({
  state_seq: seqSchema,
});
const supplementToolCallOutputSchema = z.object({
  tool_call: idSchema("tcl"),
  supplement_key: nonempty,
});

export const supplementToolCall = defineCommand({
  resource: "tool-calls",
  method: "supplement",
  name: "SupplementToolCall",
  input: supplementToolCallInputSchema,
  compare: supplementToolCallCompareSchema,
  output: supplementToolCallOutputSchema,
  actors: ["machine"],
  errors,
});

const toolCallReadInputSchema = z.strictObject({
  tool_call: idSchema("tcl"),
});
const toolCallReadOutputSchema = withReadCommon(z.object({
  tool_call: toolCallOutputSchema,
}));

export const toolCallRead = defineRead({
  resource: "tool-calls",
  method: "read",
  name: "ReadToolCall",
  input: toolCallReadInputSchema,
  output: toolCallReadOutputSchema,
  actors: ["user", "agent", "machine"],
  errors: errors.filter((code) => code !== "conflict"),
});

// 사람 화면은 turn별로, 한 session의 모든 turn을 한 번에 읽을 때는 session으로 거른다.
const toolCallListInputSchema = z.strictObject({
  turn: idSchema("trn").optional(),
  session: idSchema("ses").optional(),
  model_call: idSchema("mcl").optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().positive().max(100).optional(),
}).refine(
  (value) =>
    value.turn !== undefined || value.session !== undefined ||
    value.model_call !== undefined,
  { message: "list needs a turn, a session or a model call" },
);
const toolCallListOutputSchema = withReadCommon(z.object({
  tool_calls: z.array(toolCallOutputSchema),
}));

export const toolCallList = defineRead({
  resource: "tool-calls",
  method: "list",
  name: "ListToolCalls",
  input: toolCallListInputSchema,
  output: toolCallListOutputSchema,
  actors: ["user", "agent", "machine"],
  errors: errors.filter((code) => code !== "conflict"),
});

export const toolCallRequested = defineEvent("ToolCallRequested", {
  subject: idSchema("tcl"),
  payload: z.object({
    turn: idSchema("trn"),
    model_call: idSchema("mcl"),
    response_key: nonempty,
    tool: toolNameSchema,
    input: hash,
    retry_of: idSchema("tcl").nullable(),
  }),
});

export const toolCallDecided = defineEvent("ToolCallDecided", {
  subject: idSchema("tcl"),
  payload: toolDecisionSchema,
});

export const toolCallStarted = defineEvent("ToolCallStarted", {
  subject: idSchema("tcl"),
  payload: z.object({
    started_at: atSchema,
    idempotency_key: idSchema("tcl"),
  }),
});

export const toolCallFinished = defineEvent("ToolCallFinished", {
  subject: idSchema("tcl"),
  payload: z.object({
    outcome: toolOutcomeSchema,
    output: hash.nullable(),
    finished_at: atSchema,
  }),
});

export const toolCallSupplemented = defineEvent("ToolCallSupplemented", {
  subject: idSchema("tcl"),
  payload: z.object({
    previous_fact: hash,
    fact: hash,
    supplement_key: nonempty,
  }),
});

export const TOOL_CALL_ROUTES = [
  recordToolRequest,
  decideToolCall,
  startToolCall,
  finishToolCall,
  recordReadToolCall,
  supplementToolCall,
  toolCallRead,
  toolCallList,
] as const;

// 현재 scope·definition·MCP 판·approval 한 번 사용·owner transaction은 runtime 책임이다.
