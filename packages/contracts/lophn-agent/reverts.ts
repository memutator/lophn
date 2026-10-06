import { z } from "zod";
import {
  defineCommand,
  defineEvent,
  defineRead,
  idSchema,
  jsonObjectSchema,
  seqSchema,
  sha256Schema,
  withReadCommon,
} from "../platform/mod.ts";
import { defineDecision } from "../platform/confirmation-handle.ts";
import { readCursorSchema } from "./run-values.ts";
import {
  revertCapabilitySchema,
  revertOutcomeSchema,
  revertReasonSchema,
  revertResultSchema,
} from "./decision-values.ts";

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

const readActors = ["user", "agent", "machine", "coding_agent"] as const;

const targetSchema = z.string().regex(/^[a-z]{3}_[0-7][0-9a-hjkmnp-tv-z]{25}$/);

const sourceSeqsSchema = z.array(seqSchema).min(1).refine(
  (seqs) =>
    new Set(seqs).size === seqs.length &&
    seqs.every((seq, index) =>
      index === 0 || BigInt(seqs[index - 1]) < BigInt(seq)
    ),
  { message: "source seqs must be unique and ascending" },
);

const dependencySchema = z.strictObject({
  owner: z.string().regex(/^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)*$/),
  target: targetSchema,
  comparison: jsonObjectSchema,
});

const appRevertBindingSchema = z.strictObject({
  app: idSchema("app"),
  release: idSchema("rel"),
  command: z.string().min(1),
  tool_call: idSchema("tcl"),
  invocation: idSchema("inv"),
  receipt: z.string().min(1),
  expected_revision: z.string().min(1),
  revert_command: z.string().min(1),
  step_key: z.string().min(1),
  revert_invocation: idSchema("inv").nullable(),
});

const revertGroupSchema = z.strictObject({
  ordinal: z.number().int().nonnegative(),
  owner: dependencySchema.shape.owner,
  target: targetSchema.nullable(),
  source_seqs: sourceSeqsSchema,
  capability: revertCapabilitySchema,
  reason: revertReasonSchema.nullable(),
  comparison: jsonObjectSchema.nullable(),
  before_ref: jsonObjectSchema.nullable(),
  dependencies: z.array(dependencySchema),
  app_revert: appRevertBindingSchema.nullable(),
}).refine(
  (value) =>
    (value.capability === "reversible" || value.capability === "conflict"
      ? value.comparison !== null
      : true) &&
    (value.capability === "reversible" ? value.before_ref !== null : true) &&
    (value.capability === "retained" || value.capability === "irreversible" ||
        value.capability === "conflict"
      ? value.reason !== null
      : true),
  { message: "revert group fields disagree with its capability" },
);

const revertChangeSchema = z.strictObject({
  ordinal: z.number().int().nonnegative(),
  owner: dependencySchema.shape.owner,
  target: targetSchema.nullable(),
  source_seqs: sourceSeqsSchema,
  capability: revertCapabilitySchema,
  result: revertResultSchema,
  reason: revertReasonSchema.nullable(),
  restored_seqs: z.array(seqSchema),
  app_revert: appRevertBindingSchema.nullable(),
}).refine(
  (value) => value.result === "restored" || value.reason !== null,
  { message: "a non-restored change needs a reason" },
);

const preparedSchema = z.strictObject({
  source_seqs: sourceSeqsSchema,
  comparison: jsonObjectSchema,
  prepared_ref: sha256Schema.nullable(),
});

// 사람 결정은 적용 자체다. 표시는 같은 run의 reverts/preview를 읽는다. ledger는 확인 handle의
// 결정 이름으로 command 이름(route.name)을 검사하므로 이 이름이 command 이름과 같아야 한다.
export const REVERT_RUN_DECISION = defineDecision("RevertRun");

export const revertRunInputSchema = z.strictObject({
  id: idSchema("rvt"),
  run: idSchema("run"),
  allow_partial: z.boolean(),
  preview_hash: sha256Schema,
  groups: z.array(preparedSchema).min(1),
});

export const checkpointRevertInputSchema = z.strictObject({
  revert: idSchema("rvt"),
  step_key: z.string().min(1),
  invocation: idSchema("inv"),
  result: revertResultSchema,
});

export const finishRevertInputSchema = z.strictObject({
  revert: idSchema("rvt"),
  step_keys: z.array(z.string().min(1)).min(1),
});

const revertHeaderOutput = z.object({
  id: idSchema("rvt"),
  run: idSchema("run"),
  outcome: revertOutcomeSchema,
  result_seq: seqSchema.nullable(),
  replayed: z.boolean(),
}).refine(
  (value) => (value.outcome === "applying") === (value.result_seq === null),
  { message: "only an applying revert lacks a result event" },
);

export const revertRun = defineCommand({
  resource: "reverts",
  method: "apply",
  name: "RevertRun",
  input: revertRunInputSchema,
  output: revertHeaderOutput,
  compare: z.strictObject({ preview_hash: sha256Schema }),
  actors: ["user"],
  errors: [...commandErrors],
  confirmation: "required",
  binding: ["id", "run", "allow_partial", "preview_hash"],
  display_read: "/v1/reverts/preview",
});

export const checkpointRevert = defineCommand({
  resource: "reverts",
  method: "checkpoint",
  name: "CheckpointRevert",
  input: checkpointRevertInputSchema,
  output: z.object({
    revert: idSchema("rvt"),
    step_key: z.string().min(1),
    recorded: z.boolean(),
  }),
  actors: ["machine"],
  errors: [...commandErrors],
});

export const finishRevert = defineCommand({
  resource: "reverts",
  method: "finish",
  name: "FinishRevert",
  input: finishRevertInputSchema,
  output: revertHeaderOutput,
  actors: ["machine"],
  errors: [...commandErrors],
});

const previewOutput = z.object({
  run: idSchema("run"),
  groups: z.array(revertGroupSchema),
  binding_hash: sha256Schema,
});

const revertRecordSchema = z.object({
  id: idSchema("rvt"),
  run: idSchema("run"),
  allow_partial: z.boolean(),
  outcome: revertOutcomeSchema,
  changes: z.array(revertChangeSchema),
  result_seq: seqSchema.nullable(),
  preview_hash: sha256Schema,
});

export const revertPreviewInputSchema = z.strictObject({
  run: idSchema("run"),
});

export const revertListInputSchema = z.strictObject({
  run: idSchema("run").optional(),
  cursor: readCursorSchema.optional(),
});

export const revertPreview = defineRead({
  resource: "reverts",
  method: "preview",
  name: "PreviewRevert",
  input: revertPreviewInputSchema,
  output: withReadCommon(previewOutput),
  actors: readActors,
  errors: [...readErrors],
});

export const revertList = defineRead({
  resource: "reverts",
  method: "list",
  name: "ListReverts",
  input: revertListInputSchema,
  output: withReadCommon(z.object({ reverts: z.array(revertRecordSchema) })),
  actors: readActors,
  errors: [...readErrors],
});

const revertSubject = idSchema("rvt");

// 결과 event는 변경 목록을 싣지 않고 결과별 묶음 수만 싣는다. 목록은 reverts/list가 읽는다.
export const revertResultCountsSchema = z.strictObject({
  restored: z.number().int().nonnegative(),
  retained: z.number().int().nonnegative(),
  irreversible: z.number().int().nonnegative(),
  conflict: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
  failure: z.number().int().nonnegative(),
  uncertain: z.number().int().nonnegative(),
});

export const revertStarted = defineEvent("RevertStarted", {
  subject: revertSubject,
  payload: z.object({
    run: idSchema("run"),
    preview_hash: sha256Schema,
    steps: z.array(z.string().min(1)),
  }),
});

export const revertApplied = defineEvent("RevertApplied", {
  subject: revertSubject,
  payload: z.object({
    run: idSchema("run"),
    allow_partial: z.boolean(),
    partial: z.boolean(),
    results: revertResultCountsSchema,
  }),
});

export const revertBlocked = defineEvent("RevertBlocked", {
  subject: revertSubject,
  payload: z.object({
    run: idSchema("run"),
    results: revertResultCountsSchema,
  }),
});

export const revertFinished = defineEvent("RevertFinished", {
  subject: revertSubject,
  payload: z.object({
    run: idSchema("run"),
    outcome: z.enum(["partial", "uncertain"]),
    results: revertResultCountsSchema,
  }),
});

export const REVERT_ROUTES = [
  checkpointRevert,
  finishRevert,
  revertRun,
  revertPreview,
  revertList,
] as const;

export const REVERT_EVENTS = [
  revertStarted,
  revertApplied,
  revertBlocked,
  revertFinished,
] as const;

export { revertChangeSchema, revertGroupSchema };
