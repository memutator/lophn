import { z } from "zod";
import {
  atSchema,
  durationMsSchema,
  positiveSafeIntegerSchema,
  seqSchema,
  sha256Schema,
} from "../base/values.ts";
import { idSchema } from "../base/ids.ts";

// agent event TurnEnded의 outcome이다. interrupted는 사람이 멈춤, lophn이 꺼졌다 켜짐, session을
// archive하거나 지움이다.
const TURN_OUTCOME_REASONS = {
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
// turn의 한도다. 시작할 때 정해 기준에 고정한다.
const turnLimitsFields = {
  model_attempts: positiveSafeIntegerSchema,
  stall_ms: positiveSafeIntegerSchema,
  active_ms: positiveSafeIntegerSchema,
};

export const turnLimitsSchema = z.strictObject(turnLimitsFields);
const turnLimitsOutputSchema = z.object(turnLimitsFields);
export type TurnLimits = z.infer<typeof turnLimitsSchema>;

export const DEFAULT_TURN_LIMITS = {
  model_attempts: 30,
  stall_ms: 300_000,
  active_ms: 1_800_000,
} as const;

// 쓴 시간이다. checkpoint가 주기로 남긴다.
const turnElapsedFields = {
  active_ms: durationMsSchema,
  stall_ms: durationMsSchema,
  checkpoint_at: atSchema.nullable(),
};

export const turnElapsedSchema = z.strictObject(turnElapsedFields);
export const turnElapsedOutputSchema = z.object(turnElapsedFields);
export type TurnElapsed = z.infer<typeof turnElapsedSchema>;

const TURN_STATES = ["running", "finished"] as const;
export const turnStateSchema = z.enum(TURN_STATES);

// 고정한 resolved agent는 hash와 칸별 출처만 기준에 두고 전체 값은 blob이다.

export const turnRecordSchema = z.object({
  id: idSchema("trn"),
  session: idSchema("ses"),
  // 이 turn을 시작한 입력의 메시지.
  input_message: idSchema("msg"),
  state: turnStateSchema,
  basis: sha256Schema,
  started_at: atSchema,
  limits: turnLimitsOutputSchema,
  elapsed: turnElapsedOutputSchema,
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
