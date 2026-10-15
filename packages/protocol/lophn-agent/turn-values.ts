import { z } from "zod";
import { atSchema, seqSchema, sha256Schema } from "../base/values.ts";
import { idSchema } from "../base/ids.ts";
import { resolvedSourcesSchema } from "./agent-values.ts";
import {
  agentRefOutputSchema,
  agentRefSchema,
  placeOutputSchema,
  placeSchema,
} from "./places.ts";
import {
  resolvedModelOutputSchema,
  resolvedModelSchema,
} from "./resolved-model.ts";
import {
  positiveRevisionSchema,
  positiveSafeIntegerSchema,
  runElapsedOutputSchema,
  runLimitsOutputSchema,
  runLimitsSchema,
} from "./run-values.ts";

// agent event TurnEnded의 outcome이다. interrupted는 사람이 멈춤, lophn이 꺼졌다 켜짐, session을
// archive하거나 지움이다.
export const TURN_OUTCOME_REASONS = {
  completed: ["answer_completed"],
  failed: [
    "model_error",
    "tool_error",
    "context_limit",
    "model_attempt_limit",
    "stall_limit",
    "active_limit",
    "repeated_tool_failure",
    "effect_unknown",
    "clock_uncertain",
    "configuration_unavailable",
    "target_unavailable",
    "no_answer",
  ],
  interrupted: ["user_stopped", "restarted", "session_ended"],
} as const;

export const turnOutcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("completed"),
    reason: z.enum(TURN_OUTCOME_REASONS.completed),
  }),
  z.strictObject({
    kind: z.literal("failed"),
    reason: z.enum(TURN_OUTCOME_REASONS.failed),
  }),
  z.strictObject({
    kind: z.literal("interrupted"),
    reason: z.enum(TURN_OUTCOME_REASONS.interrupted),
  }),
]);

export const turnOutcomeOutputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("completed"),
    reason: z.enum(TURN_OUTCOME_REASONS.completed),
  }),
  z.object({
    kind: z.literal("failed"),
    reason: z.enum(TURN_OUTCOME_REASONS.failed),
  }),
  z.object({
    kind: z.literal("interrupted"),
    reason: z.enum(TURN_OUTCOME_REASONS.interrupted),
  }),
]);

export type TurnOutcome = z.infer<typeof turnOutcomeSchema>;

// 입력은 메모리 입력함에 있다가 turn이 시작되면서 행이 생긴다. 권한·질문 대기는 turn이 running인 채
// session snapshot이 가진다.
export const TURN_STATES = ["running", "finished"] as const;
export const turnStateSchema = z.enum(TURN_STATES);

const toolContextPinFields = {
  context: idSchema("ctx"),
  bundle: idSchema("cbn"),
  bundle_hash: sha256Schema,
  title: z.string().min(1),
};

const toolLimitsFields = {
  bytes: positiveSafeIntegerSchema,
  lines: positiveSafeIntegerSchema,
  list: positiveSafeIntegerSchema,
};

// 고정한 resolved agent는 hash와 칸별 출처만 기준에 두고 전체 값은 blob이다.
const resolvedFields = {
  hash: sha256Schema,
  sources: resolvedSourcesSchema,
};

export const turnBasisSchema = z.strictObject({
  agent: agentRefSchema,
  resolved: z.strictObject(resolvedFields),
  tools: z.strictObject({
    revision: positiveRevisionSchema,
    definitions_hash: sha256Schema,
    contexts: z.array(z.strictObject(toolContextPinFields)),
  }),
  extensions: z.strictObject({
    settings_revision: positiveRevisionSchema,
    skill_hashes: z.array(sha256Schema),
    mcp_config_revisions: z.array(positiveRevisionSchema),
    mcp_tool_definition_hashes: z.array(sha256Schema),
  }),
  models: z.strictObject({
    judgment: resolvedModelSchema.extend({ purpose: z.literal("judgment") }),
    organizing: resolvedModelSchema.extend({
      purpose: z.literal("organizing"),
    }),
  }),
  place: placeSchema.nullable(),
  limits: runLimitsSchema,
  tool_result_limits: z.strictObject(toolLimitsFields),
});

export const turnBasisOutputSchema = z.object({
  agent: agentRefOutputSchema,
  resolved: z.object(resolvedFields),
  tools: z.object({
    revision: positiveRevisionSchema,
    definitions_hash: sha256Schema,
    contexts: z.array(z.object(toolContextPinFields)),
  }),
  extensions: z.object({
    settings_revision: positiveRevisionSchema,
    skill_hashes: z.array(sha256Schema),
    mcp_config_revisions: z.array(positiveRevisionSchema),
    mcp_tool_definition_hashes: z.array(sha256Schema),
  }),
  models: z.object({
    judgment: resolvedModelOutputSchema.extend({
      purpose: z.literal("judgment"),
    }),
    organizing: resolvedModelOutputSchema.extend({
      purpose: z.literal("organizing"),
    }),
  }),
  place: placeOutputSchema.nullable(),
  limits: runLimitsOutputSchema,
  tool_result_limits: z.object(toolLimitsFields),
});

export type TurnBasis = z.infer<typeof turnBasisSchema>;

export const turnRecordSchema = z.object({
  id: idSchema("trn"),
  session: idSchema("ses"),
  // 이 turn을 시작한 입력의 메시지.
  input_message: idSchema("msg"),
  state: turnStateSchema,
  basis: sha256Schema,
  started_at: atSchema,
  limits: runLimitsOutputSchema,
  elapsed: runElapsedOutputSchema,
  finished_at: atSchema.nullable(),
  outcome: turnOutcomeOutputSchema.nullable(),
  result: sha256Schema.nullable(),
  state_seq: seqSchema,
}).refine((value) => {
  const finished = value.state === "finished";
  return (value.finished_at !== null) === finished &&
    (value.outcome !== null) === finished &&
    (value.result !== null) === finished;
}, { message: "turn state fields are not coupled" });

export type TurnRecord = z.infer<typeof turnRecordSchema>;
export type Turn = TurnRecord;
