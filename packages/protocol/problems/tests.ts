import { z } from "zod";
import { idempotencyKeySchema, withReadCommon } from "../server/envelope.ts";
import { defineEvent } from "../events/events.ts";
import { idSchema } from "../base/ids.ts";
import { blobRefRegistrationSchema } from "../storage/blob.ts";
import { defineCommand, defineRead } from "../server/route.ts";
import { memoryLimitModeSchema } from "../supervision/supervision.ts";
import { atSchema, seqSchema, sha256Schema } from "../base/values.ts";
import { problemCodeSchema } from "./problem-codes.ts";

export const TEST_KINDS = ["app_test", "reproduction", "test_command"] as const;
export const TEST_RESULTS = ["pass", "fail", "inconclusive"] as const;
export const TEST_SIDES = ["single", "before", "after"] as const;
export const testKindSchema = z.enum(TEST_KINDS);
export const testResultSchema = z.enum(TEST_RESULTS);
export const testSideSchema = z.enum(TEST_SIDES);
export type TestKind = z.infer<typeof testKindSchema>;
export type TestResult = z.infer<typeof testResultSchema>;
export type TestSide = z.infer<typeof testSideSchema>;

export const TEST_EXECUTION_LIMITS = {
  concurrent: 2,
  preparing: 16,
  timeout_ms: 300_000,
  suggested_timeout_ms: 60_000,
  output_bytes_per_side: 1_048_576,
  process_memory_bytes: 536_870_912,
  deno_heap_bytes: 268_435_456,
} as const;
const nonempty = z.string().regex(/\S/);
const integer = z.number().int().min(Number.MIN_SAFE_INTEGER).max(
  Number.MAX_SAFE_INTEGER,
);
const positiveSeq = seqSchema.refine((value) => value !== "0");
const relativePath = z.string().min(1).refine(
  (value) =>
    value === "." ||
    (!/^[\\/]|^[A-Za-z]:|\\/.test(value) && !value.includes("\u0000") &&
      value.split("/").every((part) => part !== ".." && part !== "")),
  { message: "path must stay inside source" },
);

// Only the runner selects the fixed absolute Deno executable; argv excludes it.
// OS path resolution and granted Deno permission scopes remain runner checks.
const testMethodFields = {
  argv: z.array(
    z.string().refine((value) =>
      value.length > 0 && !value.includes("\u0000") && !/[\r\n]/.test(value)
    ),
  )
    .min(2).refine(
      (argv) =>
        argv[0] === "test" &&
        argv.slice(1).every((arg) =>
          !/^(?:--allow-all|--allow-(?:read|write|net|env|import)|--prompt)$/
            .test(arg) &&
          !/^(?:-A|-[RWNE]|--allow-(?:run|ffi|sys)(?:=|$))/.test(arg) &&
          !/^--allow-(?:read|write|net|env|import)=(?:|\*)$/.test(arg) &&
          !/[;&|`]|\$\(/.test(arg) &&
          !/^[\\/]|^[A-Za-z]:|\\/.test(arg) &&
          !arg.split("/").includes("..")
        ) && argv.slice(1).some((arg) => !arg.startsWith("-")),
      { message: "only fixed Deno test entrypoints are supported" },
    ),
  cwd: relativePath,
  timeout_ms: integer.min(1).max(TEST_EXECUTION_LIMITS.timeout_ms),
  expected_exit_code: integer,
  environment: sha256Schema,
};
export const testMethodSchema = z.object(testMethodFields);
export const testMethodInputSchema = z.strictObject(testMethodFields);
export type TestMethod = z.infer<typeof testMethodSchema>;

const targetFields = {
  bundle_hash: sha256Schema,
  release: idSchema("rel").nullable(),
};
export const testTargetSchema = z.object(targetFields);
export const testTargetInputSchema = z.strictObject(targetFields);
export type TestTarget = z.infer<typeof testTargetSchema>;
const ticketFields = {
  ticket: idSchema("tkt"),
  check_index: integer.min(0),
  check_hash: sha256Schema,
  completion_seq: positiveSeq,
};
// check_hash is the RFC 8785 canonical JSON sha256 of the check at check_index.
export const ticketTestLinkSchema = z.object(ticketFields);
export const ticketTestLinkInputSchema = z.strictObject(ticketFields);
export type TicketTestLink = z.infer<typeof ticketTestLinkSchema>;
const failurePathFields = {
  code: problemCodeSchema,
  test_hash: sha256Schema,
};
const failurePathSchema = z.object(failurePathFields);
const failurePathInputSchema = z.strictObject(failurePathFields);
const frozenTestFields = {
  code: sha256Schema,
  input: sha256Schema,
  expected: sha256Schema,
  method: testMethodSchema,
  blueprint: sha256Schema.nullable(),
  sdk_dependencies: sha256Schema.nullable(),
  failure_paths: z.array(failurePathSchema).nullable(),
  symptom: sha256Schema.nullable(),
};
type FrozenTestValue = z.infer<z.ZodObject<typeof frozenTestFields>>;
// app_test는 blueprint·SDK·실패 경로가, reproduction은 증상 판별이 필수다.
const validFrozenTest = (value: FrozenTestValue) => {
  const appTest = value.blueprint !== null &&
    value.sdk_dependencies !== null && value.failure_paths !== null &&
    value.symptom === null;
  const reproduction = value.symptom !== null && value.blueprint === null &&
    value.sdk_dependencies === null && value.failure_paths === null;
  const command = value.blueprint === null &&
    value.sdk_dependencies === null && value.failure_paths === null &&
    value.symptom === null;
  return appTest || reproduction || command;
};
// Declaration coverage needs the frozen blueprint, so the runner checks it.
export const frozenTestSchema = z.object(frozenTestFields).refine(
  validFrozenTest,
  { message: "invalid frozen test for its kind" },
);
export const frozenTestInputSchema = z.strictObject({
  ...frozenTestFields,
  method: testMethodInputSchema,
  failure_paths: z.array(failurePathInputSchema).nullable(),
}).refine(validFrozenTest, { message: "invalid frozen test for its kind" });
export type FrozenTest = z.infer<typeof frozenTestSchema>;

const executionFields = {
  side: testSideSchema,
  bundle_hash: sha256Schema,
  test_hash: sha256Schema,
  started_at: atSchema,
  ended_at: atSchema,
  exit_code: integer.nullable(),
  end_reason: z.enum([
    "exited",
    "timeout",
    "killed",
    "runner_lost",
    "start_failed",
  ]),
  runner_version: nonempty,
  environment: sha256Schema,
  memory_limit_mode: memoryLimitModeSchema,
  output: sha256Schema.nullable(),
  output_missing_reason: nonempty.nullable(),
  truncated: z.boolean(),
  redaction_notes: z.array(nonempty),
};
export const executionEvidenceSchema = z.object(executionFields).refine(
  (value) => value.ended_at >= value.started_at,
  { message: "execution ends before it starts" },
).refine(
  (value) => (value.output === null) === (value.output_missing_reason !== null),
  { message: "missing output requires a reason" },
).refine(
  (value) => value.end_reason !== "exited" || value.exit_code !== null,
  { message: "exited termination requires an exit code" },
);
export const executionEvidenceInputSchema = z.strictObject(executionFields)
  .refine(
    (value) => value.ended_at >= value.started_at,
    { message: "execution ends before it starts" },
  ).refine(
    (value) =>
      (value.output === null) === (value.output_missing_reason !== null),
    { message: "missing output requires a reason" },
  ).refine(
    (value) => value.end_reason !== "exited" || value.exit_code !== null,
    { message: "exited termination requires an exit code" },
  );
export type ExecutionEvidence = z.infer<typeof executionEvidenceSchema>;
export const executionEvidenceListSchema = z.array(executionEvidenceSchema).min(
  1,
).max(2)
  .refine((values) =>
    new Set(values.map((value) => value.side)).size === values.length
  )
  .refine((values) =>
    values.length === 1 || values.every((value) => value.side !== "single")
  );

const connectionFields = {
  kind: testKindSchema,
  app: idSchema("app"),
  target: testTargetSchema,
  problem: idSchema("prb").nullable(),
  basis_seq: positiveSeq.nullable(),
  reports: z.array(idSchema("rpt")),
  before: idSchema("rel").nullable(),
  after: idSchema("rel").nullable(),
  ticket: ticketTestLinkSchema.nullable(),
  test: sha256Schema,
};
const verificationFields = {
  id: idSchema("vrf"),
  request_key: idempotencyKeySchema,
  // RecordVerification compares this opaque ref with the accepted request record.
  request_principal: nonempty,
  request_hash: sha256Schema,
  ...connectionFields,
  execution: sha256Schema,
  result: testResultSchema,
  reason: nonempty,
  observations: sha256Schema,
};
type Connections = z.infer<z.ZodObject<typeof connectionFields>>;
const validConnections = (value: Connections) => {
  if (value.kind === "reproduction") {
    return value.problem !== null && value.basis_seq !== null &&
      value.reports.length > 0 && value.before !== null &&
      value.after !== null &&
      value.before !== value.after && value.target.release === value.after &&
      value.ticket === null;
  }
  return value.problem === null && value.basis_seq === null &&
    value.reports.length === 0 && value.before === null &&
    value.after === null &&
    (value.kind === "test_command" || value.ticket === null);
};
export const verificationSchema = z.object(verificationFields).refine(
  validConnections,
  {
    message: "invalid kind connections",
  },
);
export type Verification = z.infer<typeof verificationSchema>;
export const verificationInputSchema = z.strictObject({
  ...verificationFields,
  target: testTargetInputSchema,
  ticket: ticketTestLinkInputSchema.nullable(),
}).refine(validConnections, { message: "invalid kind connections" });

export const requestTestInputSchema = z.strictObject({
  request_key: idempotencyKeySchema,
  ...connectionFields,
  target: testTargetInputSchema,
  ticket: ticketTestLinkInputSchema.nullable(),
  // 이 요청의 실행 기한이다. 동결 test method의 timeout_ms보다 길어지지 않는다(runner가 둘 중 짧은
  // 쪽을 쓴다). 생략하면 method의 timeout_ms다. 요청 identity(request hash)에는 들어가지 않는다.
  timeout_ms: integer.min(1).max(TEST_EXECUTION_LIMITS.timeout_ms).optional(),
  // coding agent의 reproduction 요청이 기대는 ticket의 현재 claim이다. core가 접수 때 그 연결의 현재 claim과 맞는지
  // 다시 확인한다(coding-agent/mcp-server#R25, cli#R34). 권한 확인이라 요청 identity(request hash)에는
  // 들어가지 않는다. 사람·machine 요청은 싣지 않는다.
  ticket_source: z.strictObject({
    ticket: idSchema("tkt"),
    claim_seq: positiveSeq,
  }).optional(),
}).refine(validConnections, { message: "invalid kind connections" });
export const requestTestOutputSchema = z.object({
  request_key: idempotencyKeySchema,
  accepted: z.boolean(),
  result_ref: idSchema("vrf").nullable(),
});
export const recordVerificationInputSchema = z.strictObject({
  verification: verificationInputSchema,
  blobs: z.array(blobRefRegistrationSchema),
});
export const recordVerificationOutputSchema = z.object({
  verification: idSchema("vrf"),
  seq: positiveSeq,
});
// GetTestRequest reads by AuthenticatedContext.principal + key, not actor kind.
export const getTestRequestInputSchema = z.strictObject({
  request_key: idempotencyKeySchema,
});
// These are command-record observations, not Verification lifecycle states.
export const testRequestSchema = z.object({
  request_key: idempotencyKeySchema,
  accepted: z.boolean(),
  preparation_failed: z.boolean(),
  start_attempted_at: atSchema.nullable(),
  started_at: atSchema.nullable(),
  start_unknown: z.boolean(),
  result_ref: idSchema("vrf").nullable(),
  reason: nonempty,
});
export type TestRequest = z.infer<typeof testRequestSchema>;
export const getTestRequestOutputSchema = withReadCommon(
  z.object({ request: testRequestSchema }),
);
export const getVerificationInputSchema = z.strictObject({
  verification: idSchema("vrf"),
  detail: z.boolean(),
});
export const getVerificationOutputSchema = withReadCommon(
  z.object({ verification: verificationSchema }),
);
export const listVerificationsInputSchema = z.strictObject({
  app: idSchema("app"),
  problem: idSchema("prb").optional(),
  ticket: idSchema("tkt").optional(),
  kind: testKindSchema.optional(),
  cursor: nonempty.optional(),
}).refine(
  (value) => value.problem === undefined || value.ticket === undefined,
  {
    message: "filter by problem or ticket, not both",
  },
);
export const listVerificationsOutputSchema = withReadCommon(z.object({
  verifications: z.array(verificationSchema),
}));
const readActors = ["user", "coding_agent", "agent", "machine"] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;
export const requestTest = defineCommand({
  resource: "problems",
  method: "request-test",
  name: "RequestTest",
  input: requestTestInputSchema,
  output: requestTestOutputSchema,
  actors: ["user", "coding_agent", "machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});
export const recordVerification = defineCommand({
  resource: "problems",
  method: "record-verification",
  name: "RecordVerification",
  input: recordVerificationInputSchema,
  output: recordVerificationOutputSchema,
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});
// runner가 요청 기록을 이어 붙이는 command다. 사람·agent·앱에는 열리지 않고 요청별 좁은 machine
// credential만 부른다(architecture/problems 2.2). 판정 근거는 owner(problems/tests)가 같은 transaction에서 다시 본다.
const lifecycleProofSchema = z.strictObject({
  machine_principal: nonempty,
  phase: z.enum([
    "preparation_failed",
    "start_attempt",
    "start_unknown",
    "recovery",
  ]),
  request_principal: nonempty,
  request_key: idempotencyKeySchema,
  request_hash: sha256Schema,
  app: idSchema("app"),
  current_runner: z.string(),
  next_runner: nonempty.nullable(),
  operation: z.enum(["observe_test_request", "recover_test_request"]),
});
export const observeTestRequestInputSchema = z.strictObject({
  observation: z.strictObject({
    phase: z.enum([
      "preparation_failed",
      "start_attempt",
      "start_unknown",
      "recovery",
    ]),
    request_principal: nonempty,
    request_key: idempotencyKeySchema,
    request_hash: sha256Schema,
    at: atSchema.nullable(),
    previous_runner: nonempty.nullable(),
    runner_principal: nonempty.nullable(),
    reason: nonempty,
  }),
  proof: lifecycleProofSchema,
});
export const startTestSideInputSchema = z.strictObject({
  start: z.strictObject({
    request_principal: nonempty,
    request_key: idempotencyKeySchema,
    request_hash: sha256Schema,
    side: testSideSchema,
    started_at: atSchema,
    test_hash: sha256Schema,
    bundle_hash: sha256Schema,
  }),
  proof: lifecycleProofSchema,
});
export const lifecycleOutputSchema = z.object({ seq: positiveSeq });
export const observeTestRequest = defineCommand({
  resource: "problems",
  method: "observe-test-request",
  name: "ObserveTestRequest",
  input: observeTestRequestInputSchema,
  output: lifecycleOutputSchema,
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});
export const startTestSide = defineCommand({
  resource: "problems",
  method: "start-test-side",
  name: "StartTestSide",
  input: startTestSideInputSchema,
  output: lifecycleOutputSchema,
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});
// runner가 결과 근거(고정 시험·실행 증거·관측 JSON)를 RecordVerification 앞에 남긴다. 한 요청에 한 번이고
// 같은 내용만 다시 받는다. RecordVerification이 같은 transaction에서 이 기록과 Verification의 hash를 맞춰 본다.
export const stageTestEvidenceInputSchema = z.strictObject({
  request_principal: nonempty,
  request_key: idempotencyKeySchema,
  request_hash: sha256Schema,
  evidence: z.json(),
});
export const stageTestEvidence = defineCommand({
  resource: "problems",
  method: "stage-test-evidence",
  name: "StageTestEvidence",
  input: stageTestEvidenceInputSchema,
  output: z.object({ staged: z.boolean() }),
  actors: ["machine"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});
export const getTestRequest = defineRead({
  resource: "problems",
  method: "get-test-request",
  name: "GetTestRequest",
  input: getTestRequestInputSchema,
  output: getTestRequestOutputSchema,
  actors: readActors,
  errors: readErrors,
});
export const getVerification = defineRead({
  resource: "problems",
  method: "get-verification",
  name: "GetVerification",
  input: getVerificationInputSchema,
  output: getVerificationOutputSchema,
  actors: readActors,
  errors: readErrors,
});
export const listVerifications = defineRead({
  resource: "problems",
  method: "list-verifications",
  name: "ListVerifications",
  input: listVerificationsInputSchema,
  output: listVerificationsOutputSchema,
  actors: readActors,
  errors: readErrors,
});
export const verificationRecordedPayloadSchema = z.object({
  kind: testKindSchema,
  app: idSchema("app"),
  target: testTargetSchema,
  problem: idSchema("prb").optional(),
  basis_seq: positiveSeq.optional(),
  ticket: ticketTestLinkSchema.optional(),
  result: testResultSchema,
  test: sha256Schema,
  execution: sha256Schema,
}).refine(
  (value) =>
    value.kind === "reproduction"
      ? value.problem !== undefined && value.basis_seq !== undefined &&
        value.ticket === undefined
      : value.problem === undefined && value.basis_seq === undefined &&
        (value.kind === "test_command" || value.ticket === undefined),
  {
    message: "invalid kind connections",
  },
);
export const verificationRecorded = defineEvent("VerificationRecorded", {
  subject: idSchema("vrf"),
  payload: verificationRecordedPayloadSchema,
});
