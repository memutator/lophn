import { z } from "zod";
import {
  atSchema,
  defineEvent,
  idSchema,
  sha256Schema,
} from "../platform/mod.ts";
import { REPORTING_LIMITS } from "./sdk-report.ts";

const nonblank = z.string().regex(/\S/);
const reasonFields = { reason: nonblank };
export const missingReasonSchema = z.object(reasonFields);
export const missingReasonInputSchema = z.strictObject(reasonFields);
export type MissingReason = z.infer<typeof missingReasonSchema>;
const paired = (value: unknown, reason: unknown) =>
  (value === null) !== (reason === null);
const relativePath = nonblank.refine((path) =>
  !/^[\\/]|^[A-Za-z]:|\\/.test(path) && !path.includes("\u0000") &&
  path.split("/").every((part) => part !== ".." && part !== "")
);
const frameFields = {
  path: relativePath,
  function: z.string().nullable(),
  line: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
  column: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable(),
};
export const sourceFrameSchema = z.object(frameFields);
export const sourceFrameInputSchema = z.strictObject(frameFields);
export type SourceFrame = z.infer<typeof sourceFrameSchema>;

function evidenceSchemas(strict: boolean) {
  const reason = strict ? missingReasonInputSchema : missingReasonSchema;
  const object = strict ? z.strictObject : z.object;
  const invocation = object({
    id: idSchema("inv"),
    binding: z.enum(["sdk_context", "view_context"]),
    record_missing_reason: reason.nullable(),
  });
  const error = object({
    name: nonblank,
    message: z.string().nullable(),
    message_missing_reason: reason.nullable(),
    frames: z.array(strict ? sourceFrameInputSchema : sourceFrameSchema).max(
      REPORTING_LIMITS.snapshot_frames,
    ),
    source_missing_reason: reason.nullable(),
    stack: sha256Schema.nullable(),
    stack_missing_reason: reason.nullable(),
    truncation_notes: z.array(nonblank),
  }).refine((value) =>
    paired(value.message, value.message_missing_reason) &&
    paired(value.stack, value.stack_missing_reason) &&
    (value.frames.length > 0 || value.source_missing_reason !== null)
  );
  const logs = object({
    blob: sha256Schema,
    line_count: z.number().int().min(0).max(REPORTING_LIMITS.log_lines),
    truncated: z.boolean(),
    scope: nonblank,
    from_at: atSchema.nullable(),
    to_at: atSchema.nullable(),
    collected_at: atSchema,
  }).refine((value) =>
    value.from_at === null || value.to_at === null ||
    value.from_at <= value.to_at
  );
  const screen = object({
    name: nonblank,
    observed_at: atSchema,
    state: sha256Schema.nullable(),
    state_missing_reason: reason.nullable(),
    screenshot: sha256Schema.nullable(),
    screenshot_missing_reason: reason.nullable(),
  }).refine((value) =>
    paired(value.state, value.state_missing_reason) &&
    paired(value.screenshot, value.screenshot_missing_reason)
  );
  return { invocation, error, logs, screen, reason, object };
}
const output = evidenceSchemas(false);
const input = evidenceSchemas(true);
export const invocationEvidenceSchema = output.invocation;
export const invocationEvidenceInputSchema = input.invocation;
export const errorEvidenceSchema = output.error;
export const errorEvidenceInputSchema = input.error;
export const logEvidenceSchema = output.logs;
export const logEvidenceInputSchema = input.logs;
export const screenEvidenceSchema = output.screen;
export const screenEvidenceInputSchema = input.screen;
export type InvocationEvidence = z.infer<typeof invocationEvidenceSchema>;
export type ErrorEvidence = z.infer<typeof errorEvidenceSchema>;
export type LogEvidence = z.infer<typeof logEvidenceSchema>;
export type ScreenEvidence = z.infer<typeof screenEvidenceSchema>;

function snapshotSchema(evidence: ReturnType<typeof evidenceSchemas>) {
  return evidence.object({
    id: idSchema("snp"),
    captured_at: atSchema,
    invocation: evidence.invocation.nullable(),
    invocation_missing_reason: evidence.reason.nullable(),
    error: evidence.error.nullable(),
    error_missing_reason: evidence.reason.nullable(),
    logs: evidence.logs.nullable(),
    logs_missing_reason: evidence.reason.nullable(),
    screen: evidence.screen.nullable(),
    screen_missing_reason: evidence.reason.nullable(),
  }).refine((value) =>
    paired(value.invocation, value.invocation_missing_reason) &&
    paired(value.error, value.error_missing_reason) &&
    paired(value.logs, value.logs_missing_reason) &&
    paired(value.screen, value.screen_missing_reason)
  );
}
export const snapshotSchemaOutput = snapshotSchema(output);
export { snapshotSchemaOutput as snapshotSchema };
export const snapshotInputSchema = snapshotSchema(input).refine((value) =>
  new TextEncoder().encode(JSON.stringify(value)).length <= 65_536
);
export type Snapshot = z.infer<typeof snapshotSchemaOutput>;
export type SnapshotInput = z.infer<typeof snapshotInputSchema>;
export const snapshotRecorded = defineEvent("SnapshotRecorded", {
  subject: idSchema("snp"),
  payload: z.object({
    report: idSchema("rpt"),
    captured_at: atSchema,
    evidence_hashes: z.array(sha256Schema),
    missing_reasons: z.object({
      invocation: missingReasonSchema.nullable(),
      error: missingReasonSchema.nullable(),
      logs: missingReasonSchema.nullable(),
      screen: missingReasonSchema.nullable(),
    }),
  }),
});
