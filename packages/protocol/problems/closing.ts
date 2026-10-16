import { z } from "zod";
import { defineCommand } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { seqSchema } from "../base/values.ts";

const CLOSURE_REASONS = [
  "verified",
  "user_confirmed",
  "recovered",
  "dismissed",
] as const;
export const closureReasonSchema = z.enum(CLOSURE_REASONS);
type ClosureReason = z.infer<typeof closureReasonSchema>;

const DECISION_CHOICES = [
  "fixed",
  "not_fixed",
  "not_visible",
  "dismiss",
] as const;
const decisionChoiceSchema = z.enum(DECISION_CHOICES);
type DecisionChoice = z.infer<typeof decisionChoiceSchema>;

// 더 다루지 않음의 이유는 공백 아닌 한 줄이다.
const oneLine = z.string().regex(/^[^\r\n]*\S[^\r\n]*$/);

const closureFields = {
  reason: closureReasonSchema,
  basis_seq: seqSchema,
  release: idSchema("rel").nullable(),
  verification: idSchema("vrf").nullable(),
  confirmation: z.string().nullable(),
  last_report: idSchema("rpt").nullable(),
  note: oneLine.nullable(),
};
const validClosure = (value: {
  reason: ClosureReason;
  release: string | null;
  verification: string | null;
  confirmation: string | null;
  last_report: string | null;
  note: string | null;
}) => {
  if (value.reason === "verified") {
    return value.release !== null && value.verification !== null &&
      value.confirmation === null && value.last_report === null;
  }
  if (value.confirmation === null) return false;
  if (value.reason === "user_confirmed") {
    return value.release !== null && value.verification === null &&
      value.last_report === null;
  }
  if (value.reason === "recovered") {
    return value.release !== null && value.verification === null &&
      value.last_report !== null;
  }
  return value.verification === null && value.last_report === null &&
    value.note !== null;
};
export const closureSchema = z.object(closureFields).refine(validClosure);

const decisionFields = {
  choice: decisionChoiceSchema,
  problem: idSchema("prb"),
  basis_seq: seqSchema,
  release: idSchema("rel").nullable(),
  last_report: idSchema("rpt").nullable(),
  note: oneLine.nullable(),
};
const validDecision = (value: {
  choice: DecisionChoice;
  release: string | null;
  last_report: string | null;
  note: string | null;
}) => {
  if (value.choice === "not_visible") {
    return value.release !== null && value.last_report !== null;
  }
  if (value.choice === "dismiss") return value.note !== null;
  if (value.choice === "fixed") return value.release !== null;
  return true;
};
const userProblemDecisionInputSchema = z.strictObject(decisionFields)
  .refine(validDecision);

// 문제 결정 handle binding은 owner_decision으로 등록한다.

const applyProblemDecisionInputSchema = userProblemDecisionInputSchema;
const applyProblemDecisionCompareSchema = z.strictObject({
  problem_seq: seqSchema,
  release: idSchema("rel").nullable(),
});
// not_fixed는 진행 중(fixing) 문제의 status를 바꾸지 않으므로 fixing도 결과다.
const applyProblemDecisionOutputSchema = z.object({
  status: z.enum(["open", "fixing", "closed"]),
  closure: closureSchema.nullable(),
});
export const applyProblemDecision = defineCommand({
  resource: "problems",
  method: "apply-decision",
  name: "ApplyProblemDecision",
  input: applyProblemDecisionInputSchema,
  output: applyProblemDecisionOutputSchema,
  compare: applyProblemDecisionCompareSchema,
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
  ],
  confirmation: "required",
  binding: [
    "choice",
    "problem",
    "basis_seq",
    "release",
    "last_report",
    "note",
  ],
  display_read: "/problems/get",
});

