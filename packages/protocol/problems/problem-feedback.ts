import { z } from "zod";
import { atSchema, sha256Schema } from "../base/values.ts";
import { defineWorker } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { feedbackTextSchema } from "./feedback.ts";
import {
  REPORT_ERRORS,
  reportAcceptanceSchema,
  reportModeSchema,
} from "./reports.ts";

const nonblank = z.string().regex(/\S/);

// 글 500자에 view를 더한 값의 JSON 상한.
const PROBLEM_FEEDBACK_INPUT_BYTES = 8_192;

// 버튼 시점에 shell main이 고정한 앱 view. binding은 불투명한 참조이고 권한이 아니다.
const problemFeedbackViewSchema = z.strictObject({
  binding: nonblank,
  name: nonblank,
  app: idSchema("app"),
  release: idSchema("rel").nullable(),
  mode: reportModeSchema,
  bundle_hash: sha256Schema.nullable(),
  diagnostic_scope: nonblank.nullable(),
  observed_at: atSchema,
}).refine((value) =>
  (value.mode === "live") === (value.diagnostic_scope === null)
);

// 제보는 글만 받는다. existing_problem이 null이면 새 문제다.
export const problemFeedbackInputSchema = z.strictObject({
  report_id: idSchema("rpt"),
  app: idSchema("app"),
  text: feedbackTextSchema,
  existing_problem: idSchema("prb").nullable(),
  observed_at: atSchema,
  view: problemFeedbackViewSchema.nullable(),
}).refine((value) =>
  value.view === null ||
  value.view.app === value.app && value.view.observed_at === value.observed_at
).refine((value) =>
  new TextEncoder().encode(JSON.stringify(value)).length <=
    PROBLEM_FEEDBACK_INPUT_BYTES
);
export type ProblemFeedbackInput = z.infer<typeof problemFeedbackInputSchema>;

// 접수 결과는 core가 problem.record_report(source feedback)로 기록한다.
export const problemSubmitFeedback = defineWorker({
  resource: "problems",
  method: "submit_feedback",
  name: "problem.submit_feedback",
  input: problemFeedbackInputSchema,
  output: reportAcceptanceSchema,
  actors: ["user"],
  errors: REPORT_ERRORS,
});
