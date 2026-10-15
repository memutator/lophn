import { z } from "zod";
import { atSchema, seqSchema, sha256Schema } from "../base/values.ts";
import { defineCommand } from "../base/route.ts";
import { defineEvent } from "../base/event.ts";
import { idSchema } from "../base/ids.ts";
import { jsonObjectSchema } from "../base/json-values.ts";
import {
  createApprovalRequestInputSchema,
  createApprovalRequestStoredSchema,
} from "../approvals/approvals.ts";
import {
  runElapsedOutputSchema,
  runElapsedSchema,
  runOutcomeOutputSchema,
} from "./run-values.ts";
import {
  createQuestionGroupInputSchema,
  createQuestionGroupSubmissionOutputSchema,
} from "./question-submission.ts";

// 제출 결과는 저장된 모양이다(설명 글은 blob hash).
const approvalSubmissionOutputSchema = z.object({
  ...createApprovalRequestStoredSchema.shape,
  effect: z.object(createApprovalRequestStoredSchema.shape.effect.shape),
  action: z.object({
    ...createApprovalRequestStoredSchema.shape.action.shape,
    input: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("inline"), value: jsonObjectSchema }),
      z.object({ kind: z.literal("blob"), sha256: sha256Schema }),
    ]),
  }),
});

export const WAIT_RESULTS = [
  "resumed",
  "stopped_no_answer",
  "call_started",
  "call_not_executed",
  "ignored_finished",
] as const;

// 결정 값 자체는 입력이 아니다. owner ledger의 decision_seq만 가리킨다.
export const safeReasonSchema = z.string().min(1).max(64).regex(
  /^[a-z][a-z0-9_]*$/,
);

const resolutionFields = {
  run: idSchema("run"),
  request: z.union([idSchema("qgr"), idSchema("apr")]),
  decision_seq: seqSchema,
  tool_call: idSchema("tcl").nullable(),
  result: z.enum(WAIT_RESULTS),
  reason: safeReasonSchema,
};

function resolutionShape(value: {
  request: string;
  tool_call: string | null;
  result: (typeof WAIT_RESULTS)[number];
}): boolean {
  if (value.request.startsWith("apr_") && value.tool_call === null) {
    return false;
  }
  if (value.request.startsWith("qgr_") && value.result === "call_started") {
    return false;
  }
  if (
    value.result === "stopped_no_answer" && value.request.startsWith("apr_")
  ) return false;
  if (value.request.startsWith("apr_") && value.result === "resumed") {
    return false;
  }
  if (
    value.request.startsWith("qgr_") && value.result === "call_not_executed"
  ) return false;
  return true;
}

export const waitResolutionSchema = z.strictObject(resolutionFields).refine(
  resolutionShape,
  { message: "wait resolution does not match the request kind" },
);

export const waitResolutionOutputSchema = z.object(resolutionFields).refine(
  resolutionShape,
  { message: "wait resolution does not match the request kind" },
);

export type WaitResolution = z.infer<typeof waitResolutionSchema>;

// 요청 생성과 waiting_on 연결의 atomic transaction은 runtime이 수행한다.
export const submittedWaitRequestSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("question"),
    input: createQuestionGroupInputSchema,
  }),
  z.strictObject({
    kind: z.literal("approval"),
    tool_call: idSchema("tcl"),
    input: createApprovalRequestInputSchema,
  }),
]);
export const submittedWaitRequestOutputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("question"),
    input: createQuestionGroupSubmissionOutputSchema,
  }),
  z.object({
    kind: z.literal("approval"),
    tool_call: idSchema("tcl"),
    input: approvalSubmissionOutputSchema,
  }),
]);

export const RECOVERY_BOUNDARIES = [
  "accepted",
  "model_started",
  "model_finished",
  "ledger_write",
  "outside_call",
  "waiting",
  "finished",
] as const;

export const RECOVERY_RESOLUTIONS = ["resume", "finish", "audit_only"] as const;

const recoveryFields = {
  run: idSchema("run"),
  boundary: z.enum(RECOVERY_BOUNDARIES),
  basis_seq: seqSchema,
  call: z.union([idSchema("mcl"), idSchema("tcl")]).nullable(),
  confirmed_results: z.array(z.string().min(1)),
  elapsed: runElapsedSchema,
  resolution: z.enum(RECOVERY_RESOLUTIONS),
  reason: safeReasonSchema,
};

const recoveryOutputFields = {
  ...recoveryFields,
  elapsed: runElapsedOutputSchema,
};

function recoveryShape(value: {
  boundary: (typeof RECOVERY_BOUNDARIES)[number];
  call: string | null;
  resolution: (typeof RECOVERY_RESOLUTIONS)[number];
}): boolean {
  const callRequired = value.boundary === "model_started" ||
    value.boundary === "model_finished" ||
    value.boundary === "ledger_write" ||
    value.boundary === "outside_call";
  if (callRequired && value.call === null) return false;
  if (
    (value.boundary === "model_started" ||
      value.boundary === "model_finished") &&
    !value.call?.startsWith("mcl_")
  ) return false;
  if (
    (value.boundary === "ledger_write" || value.boundary === "outside_call") &&
    !value.call?.startsWith("tcl_")
  ) return false;
  if (value.boundary === "finished") return value.resolution === "audit_only";
  if (value.boundary === "accepted") return value.resolution === "resume";
  if (value.resolution === "audit_only") return false;
  return true;
}

export const recoveryBasisSchema = z.strictObject(recoveryFields).refine(
  recoveryShape,
  { message: "recovery basis does not match the confirmed boundary" },
);

export const recoveryBasisOutputSchema = z.object(recoveryOutputFields).refine(
  recoveryShape,
  { message: "recovery basis does not match the confirmed boundary" },
);

export type RecoveryBasis = z.infer<typeof recoveryBasisSchema>;

const runRef = { run: idSchema("run") };
const stateSeq = { state_seq: seqSchema };

export const waitRunInputSchema = z.strictObject({
  ...runRef,
  request: submittedWaitRequestSchema,
  call: idSchema("tcl").nullable(),
}).refine((value) =>
  value.run === value.request.input.run &&
  (value.request.kind === "question"
    ? true
    : value.call === value.request.tool_call), {
  message: "wait request must match run and fixed call",
});

export const waitRunCompareSchema = z.strictObject(stateSeq);

export const resolveRunWaitInputSchema = z.strictObject({
  ...runRef,
  request: z.union([idSchema("qgr"), idSchema("apr")]),
  decision_seq: seqSchema,
});

export const resolveRunWaitCompareSchema = z.strictObject({
  ...stateSeq,
  waiting_on: z.union([idSchema("qgr"), idSchema("apr")]),
});

export const correctWaitingRunInputSchema = z.strictObject({
  ...runRef,
  message: idSchema("msg"),
  request: z.union([idSchema("qgr"), idSchema("apr")]),
});

export const correctWaitingRunCompareSchema = z.strictObject({
  ...stateSeq,
  waiting_on: z.union([idSchema("qgr"), idSchema("apr")]),
});

export const recoverRunInputSchema = recoveryBasisSchema;

export const recoverRunCompareSchema = z.strictObject(stateSeq);

const runCommandErrors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "unavailable",
  "unauthorized",
] as const;

export const waitRun = defineCommand({
  resource: "runs",
  method: "wait",
  name: "WaitRun",
  input: waitRunInputSchema,
  output: z.object({
    run: idSchema("run"),
    state: z.literal("waiting_user"),
    state_seq: seqSchema,
    waiting_on: z.union([idSchema("qgr"), idSchema("apr")]),
    request: submittedWaitRequestOutputSchema,
  }).refine((value) =>
    value.run === value.request.input.run &&
    value.waiting_on === value.request.input.id, {
    message: "waiting_on must reference the submitted request of this run",
  }),
  compare: waitRunCompareSchema,
  actors: ["machine"],
  errors: [
    "conflict",
    "invalid_input",
    "forbidden",
    "unauthorized",
    "not_found",
  ],
});

export const resolveRunWait = defineCommand({
  resource: "runs",
  method: "resolve-wait",
  name: "ResolveRunWait",
  input: resolveRunWaitInputSchema,
  output: z.object({
    run: idSchema("run"),
    state: z.enum(["running", "finished"]),
    state_seq: seqSchema,
    resolution: waitResolutionOutputSchema,
    outcome: runOutcomeOutputSchema.nullable(),
  }).refine((value) => {
    if (value.run !== value.resolution.run) return false;
    const terminal = value.state === "finished";
    if ((value.outcome !== null) !== terminal) return false;
    if (value.resolution.result === "ignored_finished") return terminal;
    if (value.resolution.result === "stopped_no_answer") {
      return terminal && value.outcome?.kind === "stopped" &&
        value.outcome.reason === "no_answer";
    }
    return !terminal;
  }, { message: "resolution and resulting run state disagree" }),
  compare: resolveRunWaitCompareSchema,
  actors: ["machine"],
  errors: [
    "conflict",
    "invalid_input",
    "forbidden",
    "unauthorized",
    "not_found",
  ],
});

export const correctWaitingRun = defineCommand({
  resource: "runs",
  method: "correct-waiting",
  name: "CorrectWaitingRun",
  input: correctWaitingRunInputSchema,
  output: z.object({
    run: idSchema("run"),
    state: z.enum(["running", "finished"]),
    state_seq: seqSchema,
    request: z.union([idSchema("qgr"), idSchema("apr")]),
  }),
  compare: correctWaitingRunCompareSchema,
  actors: ["user", "machine"],
  errors: [
    "conflict",
    "forbidden",
    "unauthorized",
    "invalid_input",
    "not_found",
  ],
});

export const recoverRun = defineCommand({
  resource: "runs",
  method: "recover",
  name: "RecoverRun",
  input: recoverRunInputSchema,
  output: z.object({
    run: idSchema("run"),
    state_seq: seqSchema,
    basis: recoveryBasisOutputSchema,
    outcome: runOutcomeOutputSchema.nullable(),
  }).refine((value) =>
    value.run === value.basis.run &&
    (value.basis.resolution === "resume"
      ? value.outcome === null
      : value.basis.resolution !== "finish" || value.outcome !== null), {
    message: "recovery result must match its basis",
  }),
  compare: recoverRunCompareSchema,
  actors: ["machine"],
  errors: [...runCommandErrors],
});

const runSubject = idSchema("run");

export const runWaited = defineEvent("RunWaited", {
  subject: runSubject,
  payload: z.object({
    request: z.union([idSchema("qgr"), idSchema("apr")]),
    call: idSchema("tcl").nullable(),
    waited_at: atSchema,
  }),
});

export const runResumed = defineEvent("RunResumed", {
  subject: runSubject,
  payload: z.object({
    request: z.union([idSchema("qgr"), idSchema("apr")]),
    decision_seq: seqSchema,
    resolution: waitResolutionOutputSchema,
  }).refine((value) =>
    value.request === value.resolution.request &&
    value.decision_seq === value.resolution.decision_seq &&
    ["resumed", "call_started", "call_not_executed"].includes(
      value.resolution.result,
    ), {
    message: "resume event must match a running resolution",
  }),
});

export const runRecovered = defineEvent("RunRecovered", {
  subject: runSubject,
  payload: recoveryBasisOutputSchema,
});

export const RUN_WAIT_COMMANDS = [
  waitRun,
  resolveRunWait,
  correctWaitingRun,
  recoverRun,
] as const;

export const RUN_WAIT_EVENTS = [runWaited, runResumed, runRecovered] as const;
