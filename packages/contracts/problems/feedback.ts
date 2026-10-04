import { z } from "zod";
import { canonicalize } from "../../base/mod.ts";
import { atSchema, defineWorker, idSchema } from "../platform/mod.ts";
import { snapshotInputSchema } from "./snapshots.ts";
import {
  blobMetadataBytes,
  reportBlobInputSchema,
  reportBlobsInputSchema,
} from "./report-blobs.ts";
import { REPORT_ERRORS, reportAcceptanceSchema } from "./reports.ts";
import { REPORTING_LIMITS } from "./sdk-report.ts";

export const feedbackTextSchema = z.string().regex(/\S/).refine((text) => {
  const scalars = [...text];
  return scalars.length >= 1 &&
    scalars.length <= REPORTING_LIMITS.feedback_text_scalars &&
    scalars.every((scalar) => {
      const code = scalar.codePointAt(0)!;
      return code < 0xd800 || code > 0xdfff;
    });
}, { message: "feedback text must have 1..500 Unicode scalars" });
// PNG bytes use blob/file/IPC, not base64 in generic JSON.
export const feedbackScreenshotInputSchema = z.strictObject({
  blob: reportBlobInputSchema,
  mime_type: z.literal("image/png"),
  width: z.number().int().min(1).max(REPORTING_LIMITS.feedback_png_long_side),
  height: z.number().int().min(1).max(REPORTING_LIMITS.feedback_png_long_side),
}).refine((value) => value.blob.purpose === "feedback_screenshot");
const feedbackFields = {
  report_id: idSchema("rpt"),
  app: idSchema("app"),
  text: feedbackTextSchema,
  existing_problem: idSchema("prb").nullable(),
  observed_at: atSchema,
  view_binding: z.string().regex(/\S/).nullable(),
  screen_selected: z.boolean(),
  screenshot_selected: z.boolean(),
  snapshot: snapshotInputSchema,
};
export const feedbackInputSchema = z.strictObject(feedbackFields).refine(
  (value) => {
    const screen = value.snapshot.screen;
    return (screen?.state == null || value.screen_selected) &&
      (screen?.screenshot == null || value.screenshot_selected) &&
      (screen === null ||
        value.view_binding !== null &&
          screen.observed_at === value.observed_at);
  },
);
export type Feedback = z.infer<typeof feedbackInputSchema>;
export const submitFeedbackInputSchema = z.strictObject({
  feedback: feedbackInputSchema,
  blobs: reportBlobsInputSchema,
  screenshot: feedbackScreenshotInputSchema.nullable(),
}).refine((value) => {
  const screen = value.feedback.snapshot.screen;
  const expected = [
    ["feedback_state", screen?.state ?? null],
    ["feedback_screenshot", screen?.screenshot ?? null],
    ["snapshot_logs", value.feedback.snapshot.logs?.blob ?? null],
    ["snapshot_stack", value.feedback.snapshot.error?.stack ?? null],
  ];
  const screenshot = value.screenshot;
  return value.blobs.every((blob) =>
    expected.some(([purpose, hash]) =>
      blob.purpose === purpose && blob.hash === hash
    )
  ) && expected.every(([purpose, hash]) =>
    hash === null || value.blobs.some((blob) =>
      blob.purpose === purpose && blob.hash === hash
    )
  ) && (screen?.screenshot == null
    ? screenshot === null
    : screenshot !== null && screenshot.blob.hash === screen.screenshot &&
      value.blobs.some((blob) =>
        blob.purpose === "feedback_screenshot" &&
        canonicalize(blob) === canonicalize(screenshot.blob)
      ));
}).refine((value) =>
  new TextEncoder().encode(JSON.stringify(value)).length +
      blobMetadataBytes(value.blobs) <= REPORTING_LIMITS.feedback_total_bytes
);
export type SubmitFeedbackInput = z.infer<typeof submitFeedbackInputSchema>;
// Current shell/view authorization, selected hash binding, PNG header and final
// redaction are trusted host checks; supplied metadata is not permission.
export const submitFeedback = defineWorker({
  resource: "problems",
  method: "submit-feedback",
  name: "SubmitFeedback",
  input: submitFeedbackInputSchema,
  output: reportAcceptanceSchema,
  actors: ["user"],
  errors: REPORT_ERRORS,
});
