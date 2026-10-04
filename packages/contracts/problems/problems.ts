import { z } from "zod";
import { sectionKeySchema } from "../documents/values.ts";
import {
  defineCommand,
  defineEvent,
  defineRead,
  idSchema,
  seqSchema,
  withReadCommon,
} from "../platform/mod.ts";
import { groupKeySchema } from "./reports.ts";
import { closureSchema } from "./closing.ts";

// grouping#R2, R3: 지문은 오류 이름과 상위 최대 3개 앱 frame의 상대 위치·함수다.
// 줄·열·절대 경로·message는 넣지 않는다. hash는 collector가 canonical JSON으로 낸다.
const fingerprintPathSchema = z.string().min(1).refine(
  (path) =>
    !/^[\\/]|^[A-Za-z]:|\\/.test(path) && !path.includes("\u0000") &&
    path.split("/").every((part) => part !== ".." && part !== ""),
  { message: "fingerprint path must stay inside the bundle" },
);
export const exceptionFingerprintInputSchema = z.strictObject({
  name: z.string().regex(/\S/),
  frames: z.array(z.strictObject({
    path: fingerprintPathSchema,
    function: z.string().nullable(),
  })).max(3),
});
export type ExceptionFingerprintInput = z.infer<
  typeof exceptionFingerprintInputSchema
>;

export const PROBLEM_STATUSES = ["open", "fixing", "closed"] as const;
export const problemStatusSchema = z.enum(PROBLEM_STATUSES);
export type ProblemStatus = z.infer<typeof problemStatusSchema>;

// grouping#R8: 진행은 열림·고치는 중·닫힘 세 가지뿐이고 열린 repair ticket은 최대 하나다.
export const PROBLEM_LIST_LIMIT = 100;

const interpretationFields = {
  version: idSchema("ver"),
  section: sectionKeySchema.nullable(),
};
export const interpretationLinkSchema = z.object(interpretationFields);
export const interpretationLinkInputSchema = z.strictObject(
  interpretationFields,
);
export type InterpretationLink = z.infer<typeof interpretationLinkSchema>;

export const problemSchema = z.object({
  id: idSchema("prb"),
  app: idSchema("app"),
  group_key: groupKeySchema,
  status: problemStatusSchema,
  work: idSchema("tkt").nullable(),
  interpretation: interpretationLinkSchema.nullable(),
  closure: closureSchema.nullable(),
  seq: seqSchema,
}).refine(
  (value) =>
    (value.status === "closed") === (value.closure !== null) &&
    (value.status === "fixing") === (value.work !== null),
  { message: "status must match work and closure" },
);
export type Problem = z.infer<typeof problemSchema>;

// 목록은 앱·증상·진행만 준다. claim·기한·연결 식별자는 넣지 않는다(grouping#R11, R12).
export const problemSummarySchema = z.object({
  id: idSchema("prb"),
  app: idSchema("app"),
  status: problemStatusSchema,
  symptom: z.string(),
  next_action: z.string().nullable(),
  seq: seqSchema,
});
export type ProblemSummary = z.infer<typeof problemSummarySchema>;

const readActors = ["user", "coding_agent", "agent", "machine"] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

export const reconcileProblemWorkInputSchema = z.strictObject({
  problem: idSchema("prb"),
  ticket: idSchema("tkt"),
  ticket_event_seq: seqSchema,
});
export const reconcileProblemWorkCompareSchema = z.strictObject({
  problem_seq: seqSchema,
  work: idSchema("tkt").nullable(),
});
export const reconcileProblemWorkOutputSchema = z.object({
  status: problemStatusSchema,
  work: idSchema("tkt").nullable(),
  changed: z.boolean(),
});
export const reconcileProblemWork = defineCommand({
  resource: "problems",
  method: "reconcile-work",
  name: "ReconcileProblemWork",
  input: reconcileProblemWorkInputSchema,
  output: reconcileProblemWorkOutputSchema,
  compare: reconcileProblemWorkCompareSchema,
  actors: ["machine"],
  errors: ["not_found", "conflict", "forbidden"],
});

export const linkProblemInterpretationInputSchema = z.strictObject({
  problem: idSchema("prb"),
  interpretation: interpretationLinkInputSchema.nullable(),
});
export const linkProblemInterpretationCompareSchema = z.strictObject({
  problem_seq: seqSchema,
  previous: interpretationLinkInputSchema.nullable(),
});
export const linkProblemInterpretationOutputSchema = z.object({
  interpretation: interpretationLinkSchema.nullable(),
});
export const linkProblemInterpretation = defineCommand({
  resource: "problems",
  method: "link-interpretation",
  name: "LinkProblemInterpretation",
  input: linkProblemInterpretationInputSchema,
  output: linkProblemInterpretationOutputSchema,
  compare: linkProblemInterpretationCompareSchema,
  actors: ["agent"],
  errors: ["invalid_input", "not_found", "forbidden", "conflict"],
});

export const listProblemsInputSchema = z.strictObject({
  app: idSchema("app").optional(),
  status: problemStatusSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(PROBLEM_LIST_LIMIT).optional(),
});
export const listProblemsOutputSchema = withReadCommon(z.object({
  problems: z.array(problemSummarySchema),
}));
export const listProblems = defineRead({
  resource: "problems",
  method: "list",
  name: "ListProblems",
  input: listProblemsInputSchema,
  output: listProblemsOutputSchema,
  actors: readActors,
  errors: readErrors,
});

export const getProblemInputSchema = z.strictObject({
  problem: idSchema("prb"),
});
export const getProblemOutputSchema = withReadCommon(z.object({
  problem: problemSchema,
  text: z.string().nullable(),
  report_count: z.number().int().nonnegative(),
  first_observed_at: z.string().nullable(),
  last_observed_at: z.string().nullable(),
}));
export const getProblem = defineRead({
  resource: "problems",
  method: "get",
  name: "GetProblem",
  input: getProblemInputSchema,
  output: getProblemOutputSchema,
  actors: readActors,
  errors: readErrors,
});

// grouping domain: claim 해제·만료·완료 보고·취소. connection 회수는 ticket의 해제 사유다.
export const WORK_END_REASONS = [
  "released",
  "expired",
  "completion_reported",
  "cancelled",
] as const;
export const workEndReasonSchema = z.enum(WORK_END_REASONS);

export const problemWorkStarted = defineEvent("ProblemWorkStarted", {
  subject: idSchema("prb"),
  payload: z.object({
    ticket: idSchema("tkt"),
    claim_seq: seqSchema,
    ticket_event_seq: seqSchema,
  }),
});
export const problemWorkEnded = defineEvent("ProblemWorkEnded", {
  subject: idSchema("prb"),
  payload: z.object({
    ticket: idSchema("tkt"),
    reason: workEndReasonSchema,
    ticket_event_seq: seqSchema,
  }),
});
export const problemInterpretationLinked = defineEvent(
  "ProblemInterpretationLinked",
  {
    subject: idSchema("prb"),
    payload: z.object({
      previous: interpretationLinkSchema.nullable(),
      current: interpretationLinkSchema.nullable(),
    }),
  },
);
