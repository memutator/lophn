import { z } from "zod";
import {
  permanentBlobReferenceSchema,
  preparedBlobSchema,
} from "../storage/blob.ts";
import { sha256Schema } from "../base/values.ts";
import { REPORTING_LIMITS } from "./sdk-report.ts";

const REPORT_BLOB_PURPOSES = [
  "report_text",
  "report_details",
  "snapshot_stack",
  "snapshot_logs",
  "feedback_state",
  "feedback_screenshot",
] as const;
const reportBlobPurposeSchema = z.enum(REPORT_BLOB_PURPOSES);
const reportBlobInputSchema = z.strictObject({
  hash: sha256Schema,
  size_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  purpose: reportBlobPurposeSchema,
  source: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("prepared"),
      blob: z.strictObject(preparedBlobSchema.shape),
    }),
    z.strictObject({
      kind: z.literal("existing"),
      reference: z.strictObject(permanentBlobReferenceSchema.shape),
    }),
  ]),
}).refine((value) => {
  const source = value.source;
  return source.kind === "prepared"
    ? source.blob.hash === value.hash &&
      source.blob.size_bytes === value.size_bytes &&
      source.blob.purpose === value.purpose
    : source.reference.hash === value.hash;
}, { message: "blob authority must bind content metadata" }).refine((value) => {
  const limits: Record<typeof value.purpose, number> = {
    report_text: REPORTING_LIMITS.automatic_body_bytes,
    report_details: REPORTING_LIMITS.automatic_body_bytes,
    snapshot_stack: REPORTING_LIMITS.stack_bytes,
    snapshot_logs: REPORTING_LIMITS.log_bytes,
    feedback_state: REPORTING_LIMITS.feedback_state_bytes,
    feedback_screenshot: REPORTING_LIMITS.feedback_png_bytes,
  };
  return value.size_bytes <= limits[value.purpose];
});
export const reportBlobsInputSchema = z.array(reportBlobInputSchema).max(6)
  .refine((values) =>
    new Set(values.map((value) => value.purpose)).size === values.length
  );

// Actual bytes, permanent reference sizes/purposes, and authority are host checks.
