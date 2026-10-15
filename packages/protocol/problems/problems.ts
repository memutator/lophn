import { z } from "zod";
import { sectionKeySchema } from "../projects/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { defineEvent } from "../base/event.ts";
import { idSchema } from "../base/ids.ts";
import { seqSchema } from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import { groupKeySchema } from "./reports.ts";
import { closureSchema } from "./closing.ts";
import { problemDetailSchema } from "./problem-detail.ts";

// 지문은 오류 이름과 상위 최대 3개 앱 frame의 상대 위치·함수다.
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

// 진행은 열림·고치는 중·닫힘 세 가지뿐이고 열린 repair ticket은 최대 하나다.
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
    (value.status !== "fixing" || value.work !== null),
  // work는 ticket이 생기면 이어지므로 open도 work를 가질 수 있다. fixing은 work가 있어야 한다.
  { message: "status must match work and closure" },
);
export type Problem = z.infer<typeof problemSchema>;

// 사용자 호출자에게 주는 문제. 내부 `problemSchema`에서 ticket·version
// 연결 식별자(`work`·`interpretation`)와 묶음 키를 뺀 것이다. 담당·수리 상태는 `detail`이 en으로
// 대신한다. strict라 내부 문제를 그대로 넘기면 거부한다. 기존 `getProblem` output은 바꾸지 않는다.
export const userProblemSchema = z.strictObject({
  id: idSchema("prb"),
  app: idSchema("app"),
  status: problemStatusSchema,
  closure: closureSchema.nullable(),
  seq: seqSchema,
}).refine(
  (value) => (value.status === "closed") === (value.closure !== null),
  { message: "status must match closure" },
);
export type UserProblem = z.infer<typeof userProblemSchema>;

/** 내부 문제에서 사용자용 문제를 만든다. 연결 식별자는 옮기지 않는다. */
export function userProblemOf(problem: Problem): UserProblem {
  return {
    id: problem.id,
    app: problem.app,
    status: problem.status,
    closure: problem.closure,
    seq: problem.seq,
  };
}

// 목록은 앱·증상·진행만 준다. claim·기한·연결 식별자는 넣지 않는다.
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
  // 열린 repair ticket을 이미 가진 문제에 다른 열린 ticket을 이으려 하면 invalid_input이다.
  errors: ["not_found", "conflict", "forbidden", "invalid_input"],
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
  // 내부 contract(ticket·version ID 포함)다. 사람에게 보이는 상세는 `detail`이다.
  problem: problemSchema,
  // 사용자용 상세. 식별자·claim·기한이 없다.
  detail: problemDetailSchema.optional(),
  text: z.string().nullable(),
  report_count: z.number().int().nonnegative(),
  first_observed_at: z.string().nullable(),
  last_observed_at: z.string().nullable(),
  // 처음·최근 보고가 당시 실행하던 release다. 보고가 release를 모르면 null이다.
  first_release: idSchema("rel").nullable(),
  last_release: idSchema("rel").nullable(),
}));
// 사용자 화면·CLI가 읽는 GetProblem 모양. `problem`은 ID 없는 사용자용이고 `detail`은
// 반드시 있다. 같은 read의 output에서 `userProblemReadOf`로 만든다(additive: route output은 그대로다).
export const getProblemUserOutputSchema = withReadCommon(z.object({
  problem: userProblemSchema,
  detail: problemDetailSchema,
  text: z.string().nullable(),
  report_count: z.number().int().nonnegative(),
  first_observed_at: z.string().nullable(),
  last_observed_at: z.string().nullable(),
  first_release: idSchema("rel").nullable(),
  last_release: idSchema("rel").nullable(),
}));
export type GetProblemUserOutput = z.infer<typeof getProblemUserOutputSchema>;

/** GetProblem output을 사용자용으로 바꾼다. `detail`이 없는 이전 응답은 null이다. */
export function userProblemReadOf(
  read: z.infer<typeof getProblemOutputSchema>,
): GetProblemUserOutput | null {
  if (read.detail === undefined) return null;
  return { ...read, problem: userProblemOf(read.problem), detail: read.detail };
}

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
  "confirmed",
] as const;
export const workEndReasonSchema = z.enum(WORK_END_REASONS);

export const problemWorkStarted = defineEvent("ProblemWorkStarted", {
  subject: idSchema("prb"),
  payload: z.object({
    ticket: idSchema("tkt"),
    // null이면 ticket만 이은 것이고(open), 값이 있으면 유효 claim으로 고치는 중이 시작됐다.
    claim_seq: seqSchema.nullable(),
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
