import { z } from "zod";
import { atSchema, sha256Schema } from "../base/values.ts";
import { defineWorker } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import {
  REPORT_ERRORS,
  reportAcceptanceSchema,
  reportModeSchema,
} from "./reports.ts";
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

const nonblank = z.string().regex(/\S/);
export const FEEDBACK_CAPTURE_BLOCKS = [
  "hidden",
  "protected_window",
  "capture_failed",
] as const;
// 버튼 시점에 shell main이 고정한 app view와 그 binding. 제출 시점의 새 화면으로
// 다시 풀지 않는다. binding은 불투명한 참조이고 권한이 아니다.
export const feedbackViewSchema = z.strictObject({
  binding: nonblank,
  name: nonblank,
  app: idSchema("app"),
  release: idSchema("rel").nullable(),
  mode: reportModeSchema,
  bundle_hash: sha256Schema.nullable(),
  diagnostic_scope: nonblank.nullable(),
  observed_at: atSchema,
  // 이미지를 얻을 수 없었던 이유. null이면 캡처할 수 있었다.
  capture: z.enum(FEEDBACK_CAPTURE_BLOCKS).nullable(),
  // 사람이 미리보기에서 확인한 최종 이미지의 hash.
  final_screenshot_hash: sha256Schema.nullable(),
}).refine((value) =>
  (value.mode === "live") === (value.diagnostic_scope === null)
);
// 화면 원자료. collector가 안전한 상태로 줄이고 redaction한다. query 값·업무 값·
// command 원입력·read 결과는 담지 않고, 아래 셋은 있었다는 사실만 이유와 함께 남는다.
export const feedbackScreenFactsSchema = z.strictObject({
  tab: z.string().nullable(),
  url: z.string().nullable(),
  inputs: z.array(z.strictObject({ name: z.string(), value: z.json() })),
  business_data: z.json().optional(),
  command_input: z.json().optional(),
  read_result: z.json().optional(),
});
// 사람이 [문제 알리기]를 누른 시점에 shell이 고정한 지목. 모르는 것은 null이다.
export const feedbackTargetsSchema = z.strictObject({
  invocation: idSchema("inv").nullable(),
  automation: nonblank.nullable(),
  version: idSchema("ver").nullable(),
  command_start: z.enum(["started", "blocked_before_start", "unknown"]),
});
// 선택한 PNG의 바이트는 JSON이 아니라 worker 요청의 byte channel로 온다. 여기에는 선언
// 크기만 있고, 실제 PNG 머리·크기·hash와 글·상태 redaction은 collector가 검사한다.
export const feedbackScreenshotInputSchema = z.strictObject({
  size_bytes: z.number().int().min(1).max(REPORTING_LIMITS.feedback_png_bytes),
});
export const submitFeedbackInputSchema = z.strictObject({
  report_id: idSchema("rpt"),
  app: idSchema("app"),
  // 사람이 쓴 원문. redaction 뒤 공백 외 1~500 scalar는 collector가 본다.
  text: z.string(),
  existing_problem: idSchema("prb").nullable(),
  observed_at: atSchema,
  selection: z.strictObject({ screen: z.boolean(), screenshot: z.boolean() }),
  // null이면 화면이 없다.
  view: feedbackViewSchema.nullable(),
  facts: feedbackScreenFactsSchema.nullable(),
  targets: feedbackTargetsSchema,
  screenshot: feedbackScreenshotInputSchema.nullable(),
}).refine((value) =>
  value.view === null ||
  value.view.app === value.app && value.view.observed_at === value.observed_at
).refine((value) =>
  new TextEncoder().encode(JSON.stringify(value)).length +
      (value.screenshot?.size_bytes ?? 0) <=
    REPORTING_LIMITS.feedback_total_bytes
);
export type SubmitFeedbackInput = z.infer<typeof submitFeedbackInputSchema>;
// Current shell/view authorization is a trusted host check; supplied metadata is not
// permission. The chosen screenshot is attached as-is without redaction, after
// the collector checks its PNG header, size and the preview's final hash.
export const submitFeedback = defineWorker({
  resource: "problems",
  method: "submit-feedback",
  name: "SubmitFeedback",
  input: submitFeedbackInputSchema,
  output: reportAcceptanceSchema,
  actors: ["user"],
  errors: REPORT_ERRORS,
});
