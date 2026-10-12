import { z } from "zod";
import { atSchema, idSchema } from "../server/mod.ts";
import {
  invocationEvidenceInputSchema,
  missingReasonInputSchema,
} from "./snapshots.ts";
import { REPORTING_LIMITS } from "./sdk-report.ts";

// Raw strings exist only in authenticated observer -> collector bounded memory.
// The collector redacts and resolves source maps before any permanent content.
export const exceptionObservationErrorSchema = z.strictObject({
  name: z.string().regex(/\S/),
  message: z.string().nullable(),
  message_missing_reason: missingReasonInputSchema.nullable(),
  stack: z.string().nullable(),
  stack_missing_reason: missingReasonInputSchema.nullable(),
}).refine((value) =>
  (value.message === null) !== (value.message_missing_reason === null) &&
  (value.stack === null) !== (value.stack_missing_reason === null)
);
export const exceptionObservationInputSchema = z.strictObject({
  report_id: idSchema("rpt"),
  observed_at: atSchema,
  observation: z.enum([
    "error",
    "unhandledrejection",
    "render_error",
    "process_exit",
  ]),
  error: exceptionObservationErrorSchema.nullable(),
  error_missing_reason: missingReasonInputSchema.nullable(),
  invocation: invocationEvidenceInputSchema.nullable(),
}).refine((value) =>
  (value.error === null) !== (value.error_missing_reason === null)
).refine((value) =>
  new TextEncoder().encode(JSON.stringify(value)).length <=
    REPORTING_LIMITS.automatic_body_bytes
);
export type ObservedExceptionError = z.infer<
  typeof exceptionObservationErrorSchema
>;
export type ObservedExceptionInput = z.infer<
  typeof exceptionObservationInputSchema
>;
