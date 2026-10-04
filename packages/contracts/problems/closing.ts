import { z } from "zod";
import {
  defineCommand,
  defineDecision,
  defineEvent,
  idSchema,
  seqSchema,
} from "../platform/mod.ts";

export const CLOSURE_REASONS = [
  "verified",
  "user_confirmed",
  "recovered",
  "dismissed",
] as const;
export const closureReasonSchema = z.enum(CLOSURE_REASONS);
export type ClosureReason = z.infer<typeof closureReasonSchema>;

export const DECISION_CHOICES = [
  "fixed",
  "not_fixed",
  "not_visible",
  "dismiss",
] as const;
export const decisionChoiceSchema = z.enum(DECISION_CHOICES);
export type DecisionChoice = z.infer<typeof decisionChoiceSchema>;

// closing#R8: 더 다루지 않음의 이유는 공백 아닌 한 줄이다.
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
export const closureInputSchema = z.strictObject(closureFields).refine(
  validClosure,
);
export type Closure = z.infer<typeof closureSchema>;

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
export const userProblemDecisionSchema = z.object(decisionFields).refine(
  validDecision,
);
export const userProblemDecisionInputSchema = z.strictObject(decisionFields)
  .refine(validDecision);
export type UserProblemDecision = z.infer<typeof userProblemDecisionSchema>;

// 문제 결정 handle binding은 T13 owner_decision으로 등록한다.
export const PROBLEM_DECISION = defineDecision("problem_decision");

export const closeProblemVerifiedInputSchema = z.strictObject({
  problem: idSchema("prb"),
  verification: idSchema("vrf"),
  problem_seq: seqSchema,
  release: idSchema("rel"),
});
export const closeProblemVerifiedCompareSchema = z.strictObject({
  problem_seq: seqSchema,
  release: idSchema("rel"),
});
export const closeProblemVerifiedOutputSchema = z.object({
  closure: closureSchema,
});
export const closeProblemVerified = defineCommand({
  resource: "problems",
  method: "close-verified",
  name: "CloseProblemVerified",
  input: closeProblemVerifiedInputSchema,
  output: closeProblemVerifiedOutputSchema,
  compare: closeProblemVerifiedCompareSchema,
  actors: ["machine"],
  errors: ["not_found", "forbidden", "conflict", "invalid_input"],
});

export const applyProblemDecisionInputSchema = userProblemDecisionInputSchema;
export const applyProblemDecisionCompareSchema = z.strictObject({
  problem_seq: seqSchema,
  release: idSchema("rel").nullable(),
});
export const applyProblemDecisionOutputSchema = z.object({
  status: z.enum(["open", "closed"]),
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
  display_read: "/v1/problems/get",
});

export const problemClosed = defineEvent("ProblemClosed", {
  subject: idSchema("prb"),
  payload: z.object({
    previous_status: z.enum(["open", "fixing"]),
    closure: closureSchema,
  }),
});
export const problemReopened = defineEvent("ProblemReopened", {
  subject: idSchema("prb"),
  payload: z.object({
    previous: closureSchema,
    report: idSchema("rpt").nullable(),
    decision: userProblemDecisionSchema.nullable(),
  }).refine(
    (value) => (value.report === null) !== (value.decision === null),
    { message: "reopen names a report or a decision, not both" },
  ),
});
export const problemConfirmationRecorded = defineEvent(
  "ProblemConfirmationRecorded",
  {
    subject: idSchema("prb"),
    payload: userProblemDecisionSchema,
  },
);
