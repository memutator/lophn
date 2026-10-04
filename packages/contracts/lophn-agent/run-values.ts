import { z } from "zod";
import {
  atSchema,
  durationMsSchema,
  idSchema,
  seqSchema,
  sha256Schema,
} from "../platform/mod.ts";
import { sectionKeySchema } from "../documents/mod.ts";
import { workPlaceOutputSchema, workPlaceSchema } from "./scope.ts";
import {
  resolvedModelOutputSchema,
  resolvedModelSchema,
} from "./resolved-model.ts";

export const positiveSafeIntegerSchema = z.number().refine(
  (value): value is number => Number.isSafeInteger(value) && value >= 1,
  { message: "expected a positive safe integer" },
);

export const positiveRevisionSchema = positiveSafeIntegerSchema;

const dedupKeySchema = z.string().min(1).refine(
  (value) => value.trim().length > 0 && !/\p{Cc}/u.test(value),
  { message: "dedup key must be nonempty without controls" },
);

const handoffReferenceFields = {
  document: idSchema("doc"),
  version: idSchema("ver"),
  section: sectionKeySchema.nullable(),
  question: idSchema("qst").nullable(),
};

export const handoffReferenceSchema = z.strictObject(handoffReferenceFields);
export const handoffReferenceOutputSchema = z.object(handoffReferenceFields);

export type HandoffReference = z.infer<typeof handoffReferenceSchema>;

const messageSourceFields = {
  kind: z.literal("message"),
  message: idSchema("msg"),
};

const scheduleSourceFields = {
  kind: z.literal("schedule"),
  assignment_revision: positiveRevisionSchema,
  scheduled_at: atSchema,
};

const handoffSourceFields = {
  kind: z.literal("handoff"),
  sender_run: idSchema("run"),
  original_message: idSchema("msg"),
  body: sha256Schema,
  references: z.array(handoffReferenceSchema),
  dedup_key: dedupKeySchema,
};

const handoffSourceOutputFields = {
  ...handoffSourceFields,
  references: z.array(handoffReferenceOutputSchema),
};

// 다른 가지 필드는 strict object가 거절한다. 같은 assignment·self 검사는 runtime이다.
export const runSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject(messageSourceFields),
  z.strictObject(scheduleSourceFields),
  z.strictObject(handoffSourceFields),
]);

export const runSourceOutputSchema = z.discriminatedUnion("kind", [
  z.object(messageSourceFields),
  z.object(scheduleSourceFields),
  z.object(handoffSourceOutputFields),
]);

export type RunSource = z.infer<typeof runSourceSchema>;

const pinnedRevisionFields = {
  id: z.string().min(1),
  revision: positiveRevisionSchema,
  snapshot_hash: sha256Schema,
  basis_seq: seqSchema,
};

export const runBasisPresetSchema = z.strictObject({
  ...pinnedRevisionFields,
  id: idSchema("pst"),
});
export const runBasisPresetOutputSchema = z.object({
  ...pinnedRevisionFields,
  id: idSchema("pst"),
});
export const runBasisAssignmentSchema = z.strictObject({
  ...pinnedRevisionFields,
  id: idSchema("asg"),
});
export const runBasisAssignmentOutputSchema = z.object({
  ...pinnedRevisionFields,
  id: idSchema("asg"),
});

const toolLimitsFields = {
  bytes: positiveSafeIntegerSchema,
  lines: positiveSafeIntegerSchema,
  list: positiveSafeIntegerSchema,
};

export const runLimitsFields = {
  model_attempts: positiveSafeIntegerSchema,
  stall_ms: positiveSafeIntegerSchema,
  active_ms: positiveSafeIntegerSchema,
};

export const runLimitsSchema = z.strictObject(runLimitsFields);
export const runLimitsOutputSchema = z.object(runLimitsFields);

export const DEFAULT_RUN_LIMITS = {
  model_attempts: 30,
  stall_ms: 300_000,
  active_ms: 1_800_000,
} as const;

export const runBasisSchema = z.strictObject({
  preset: runBasisPresetSchema,
  assignment: runBasisAssignmentSchema,
  tools: z.strictObject({
    revision: positiveRevisionSchema,
    definitions_hash: sha256Schema,
  }),
  extensions: z.strictObject({
    settings_revision: positiveRevisionSchema,
    preset_selection: sha256Schema,
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
  initial_work_place: workPlaceSchema,
  limits: runLimitsSchema,
  tool_result_limits: z.strictObject(toolLimitsFields),
});

export const runBasisOutputSchema = z.object({
  preset: runBasisPresetOutputSchema,
  assignment: runBasisAssignmentOutputSchema,
  tools: z.object({
    revision: positiveRevisionSchema,
    definitions_hash: sha256Schema,
  }),
  extensions: z.object({
    settings_revision: positiveRevisionSchema,
    preset_selection: sha256Schema,
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
  initial_work_place: workPlaceOutputSchema,
  limits: runLimitsOutputSchema,
  tool_result_limits: z.object(toolLimitsFields),
});

export type RunBasis = z.infer<typeof runBasisSchema>;

const elapsedFields = {
  active_ms: durationMsSchema,
  stall_ms: durationMsSchema,
  checkpoint_at: atSchema.nullable(),
};

export const runElapsedSchema = z.strictObject(elapsedFields);
export const runElapsedOutputSchema = z.object(elapsedFields);

export type RunElapsed = z.infer<typeof runElapsedSchema>;

export const RUN_OUTCOME_REASONS = {
  completed: ["answer_completed", "no_change"],
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
  ],
  stopped: [
    "user_stopped",
    "assignment_paused",
    "assignment_withdrawn",
    "no_answer",
  ],
} as const;

export const runOutcomeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("completed"),
    reason: z.enum(RUN_OUTCOME_REASONS.completed),
  }),
  z.strictObject({
    kind: z.literal("failed"),
    reason: z.enum(RUN_OUTCOME_REASONS.failed),
  }),
  z.strictObject({
    kind: z.literal("stopped"),
    reason: z.enum(RUN_OUTCOME_REASONS.stopped),
  }),
]);

export const runOutcomeOutputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("completed"),
    reason: z.enum(RUN_OUTCOME_REASONS.completed),
  }),
  z.object({
    kind: z.literal("failed"),
    reason: z.enum(RUN_OUTCOME_REASONS.failed),
  }),
  z.object({
    kind: z.literal("stopped"),
    reason: z.enum(RUN_OUTCOME_REASONS.stopped),
  }),
]);

export type RunOutcome = z.infer<typeof runOutcomeSchema>;

export const RUN_STATES = [
  "accepted",
  "running",
  "waiting_user",
  "finished",
] as const;

export const runStateSchema = z.enum(RUN_STATES);

export const waitingOnSchema = z.union([idSchema("qst"), idSchema("apr")]);

export function nonSelfRunLinks(value: {
  id: string;
  continued_from: string | null;
  start_after: string | null;
}): boolean {
  return value.continued_from !== value.id && value.start_after !== value.id;
}

const runRecordFields = {
  id: idSchema("run"),
  assignment: idSchema("asg"),
  session: idSchema("ses").nullable(),
  source: runSourceOutputSchema,
  continued_from: idSchema("run").nullable(),
  start_after: idSchema("run").nullable(),
  start_confirmed_seq: seqSchema.nullable(),
  state: runStateSchema,
  basis: sha256Schema.nullable(),
  waiting_on: waitingOnSchema.nullable(),
  started_at: atSchema.nullable(),
  limits: runLimitsOutputSchema,
  elapsed: runElapsedOutputSchema,
  finished_at: atSchema.nullable(),
  outcome: runOutcomeOutputSchema.nullable(),
  result: sha256Schema.nullable(),
  state_seq: seqSchema,
  accepted_seq: seqSchema,
};

export const runRecordSchema = z.object(runRecordFields).refine((value) => {
  const terminal = value.state === "finished";
  const started = value.started_at !== null;
  if ((value.basis !== null) !== started) return false;
  if (value.state === "accepted" && started) return false;
  if (
    (value.state === "running" || value.state === "waiting_user") && !started
  ) return false;
  if ((value.waiting_on !== null) !== (value.state === "waiting_user")) {
    return false;
  }
  if ((value.finished_at !== null) !== terminal) return false;
  if ((value.outcome !== null) !== terminal) return false;
  if ((value.result !== null) !== terminal) return false;
  if (
    !started &&
    (value.elapsed.active_ms !== 0 || value.elapsed.stall_ms !== 0 ||
      value.elapsed.checkpoint_at !== null)
  ) return false;
  if (value.start_confirmed_seq !== null && value.start_after === null) {
    return false;
  }
  if (
    !seqSchema.safeParse(value.accepted_seq).success ||
    !seqSchema.safeParse(value.state_seq).success
  ) return false;
  if (BigInt(value.accepted_seq) > BigInt(value.state_seq)) return false;
  return nonSelfRunLinks(value);
}, { message: "run state fields are not coupled" });

export type RunRecord = z.infer<typeof runRecordSchema>;
export type Run = RunRecord;

export const INITIAL_RUN_ELAPSED: RunElapsed = {
  active_ms: 0,
  stall_ms: 0,
  checkpoint_at: null,
};

export const readCursorSchema = z.string().min(1);
