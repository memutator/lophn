import { assertEquals } from "@std/assert";
import { ERROR_CODES, fingerprint } from "../../base/mod.ts";
import { routePath } from "../platform/route.ts";
import {
  EVENTS,
  executionEvidenceInputSchema,
  executionEvidenceListSchema,
  executionEvidenceSchema,
  frozenTestInputSchema,
  frozenTestSchema,
  getTestRequest,
  getVerification,
  listVerifications,
  recordVerification,
  requestTest,
  ROUTES,
  TEST_EXECUTION_LIMITS,
  testMethodInputSchema,
  testMethodSchema,
  ticketTestLinkInputSchema,
  verificationRecorded,
  verificationSchema,
} from "./mod.ts";

const hash = "a".repeat(64);
const id = (prefix: string, end = "0") =>
  `${prefix}_0000000000000000000000000${end}`;
const method = {
  argv: ["deno", "test", "tests.ts"],
  cwd: ".",
  timeout_ms: 60_000,
  expected_exit_code: 0,
  environment: hash,
};
const request = {
  request_key: "test-request",
  kind: "app_test",
  app: id("app"),
  target: { bundle_hash: hash, release: null },
  problem: null,
  basis_seq: null,
  reports: [],
  before: null,
  after: null,
  ticket: null,
  test: hash,
};
const verification = {
  id: id("vrf"),
  request_principal: "machine",
  request_hash: hash,
  ...request,
  execution: hash,
  result: "pass",
  reason: "All required checks passed.",
  observations: hash,
};
const execution = {
  side: "single",
  bundle_hash: hash,
  test_hash: hash,
  started_at: "2026-10-04T00:00:00.000Z",
  ended_at: "2026-10-04T00:00:01.000Z",
  exit_code: 0,
  end_reason: "exited",
  runner_version: "1.0",
  environment: hash,
  memory_limit_mode: "hard",
  output: hash,
  output_missing_reason: null,
  truncated: false,
  redaction_notes: [],
};
Deno.test("problems/tests#R2: route and event table matches architecture 5.3 and 5.4", () => {
  assertEquals(
    ROUTES.map((route) => [route.name, routePath(route), route.kind]),
    [
      ["RequestTest", "/v1/problems/request-test", "command"],
      ["RecordVerification", "/v1/problems/record-verification", "command"],
      ["GetTestRequest", "/v1/problems/get-test-request", "read"],
      ["GetVerification", "/v1/problems/get-verification", "read"],
      ["ListVerifications", "/v1/problems/list-verifications", "read"],
    ],
  );
  assertEquals(EVENTS.map((event) => event.type), ["VerificationRecorded"]);
  for (const route of ROUTES) {
    for (const error of route.errors) {
      assertEquals(ERROR_CODES.includes(error), true);
    }
  }
  assertEquals(recordVerification.actors, ["machine"]);
  assertEquals(verificationRecorded.subject.safeParse(id("vrf")).success, true);
  assertEquals(
    verificationRecorded.subject.safeParse(id("app")).success,
    false,
  );
});
Deno.test("problems/tests#R2: fixed inputs and output evidence references pass", () => {
  assertEquals(requestTest.input.safeParse(request).success, true);
  assertEquals(
    recordVerification.input.safeParse({ verification, blobs: [] }).success,
    true,
  );
  assertEquals(
    verificationSchema.safeParse({
      ...verification,
      request_principal: "app:" + id("app"),
    }).success,
    true,
  );
  assertEquals(
    getTestRequest.input.safeParse({ request_key: "test-request" }).success,
    true,
  );
  assertEquals(
    getVerification.input.safeParse({ verification: id("vrf"), detail: true })
      .success,
    true,
  );
  assertEquals(
    listVerifications.input.safeParse({ app: id("app"), kind: "app_test" })
      .success,
    true,
  );
  const appTest = {
    code: hash,
    input: hash,
    expected: hash,
    method,
    blueprint: hash,
    sdk_dependencies: hash,
    failure_paths: [{ code: "account_auth", test_hash: hash }],
    symptom: null,
  };
  assertEquals(frozenTestSchema.safeParse(appTest).success, true);
  assertEquals(
    frozenTestInputSchema.safeParse({ ...appTest, failure_paths: [] }).success,
    true,
  );
  assertEquals(
    frozenTestInputSchema.safeParse({
      ...appTest,
      failure_paths: [
        { code: "account_auth", test_hash: hash },
        { code: "account_auth", test_hash: "b".repeat(64) },
      ],
    }).success,
    true,
  );
  for (
    const value of [
      { ...appTest, unknown: true },
      { ...appTest, method: { ...method, unknown: true } },
      {
        ...appTest,
        failure_paths: [{ ...appTest.failure_paths[0], unknown: true }],
      },
    ]
  ) assertEquals(frozenTestInputSchema.safeParse(value).success, false);
  assertEquals(
    frozenTestSchema.safeParse({
      ...appTest,
      unknown: true,
      method: { ...method, unknown: true },
      failure_paths: [{ ...appTest.failure_paths[0], unknown: true }],
    }).success,
    true,
  );
  assertEquals(
    frozenTestSchema.safeParse({
      ...appTest,
      blueprint: null,
      sdk_dependencies: null,
      failure_paths: null,
      symptom: hash,
    }).success,
    true,
  );
  assertEquals(
    frozenTestSchema.safeParse({
      ...appTest,
      blueprint: null,
      sdk_dependencies: null,
      failure_paths: null,
    }).success,
    true,
  );
  assertEquals(
    frozenTestSchema.safeParse({ ...appTest, blueprint: null }).success,
    false,
  );
  assertEquals(
    frozenTestSchema.safeParse({ ...appTest, symptom: hash }).success,
    false,
  );
  assertEquals(executionEvidenceSchema.safeParse(execution).success, true);
  assertEquals(
    executionEvidenceInputSchema.safeParse({ ...execution, unknown: true })
      .success,
    false,
  );
  assertEquals(
    executionEvidenceSchema.safeParse({ ...execution, unknown: true }).success,
    true,
  );
  assertEquals(
    verificationSchema.parse({ ...verification, extra_output: true }).target
      .bundle_hash,
    hash,
  );
  const event = {
    kind: "app_test",
    app: id("app"),
    target: request.target,
    result: "pass",
    test: hash,
    execution: hash,
  };
  assertEquals(verificationRecorded.payload.safeParse(event).success, true);
});
Deno.test("problems/tests#R2: strict inputs reject unknown fields and wrong IDs or values", () => {
  for (
    const value of [
      { ...request, unknown: true },
      { ...request, app: id("prb") },
      { ...request, target: { ...request.target, unknown: true } },
      { ...request, kind: "health" },
      { ...request, test: "ABC" },
      { ...request, request_principal: "runner:test" },
    ]
  ) assertEquals(requestTest.input.safeParse(value).success, false);
  for (const route of [getTestRequest, getVerification, listVerifications]) {
    const value = route === getTestRequest
      ? { request_key: "x" }
      : route === getVerification
      ? { verification: id("vrf"), detail: true }
      : { app: id("app") };
    assertEquals(
      route.input.safeParse({ ...value, unknown: true }).success,
      false,
    );
  }
  assertEquals(
    recordVerification.input.safeParse({
      verification: { ...verification, unknown: true },
      blobs: [],
    }).success,
    false,
  );
  assertEquals(
    getVerification.input.safeParse({ verification: id("rel"), detail: true })
      .success,
    false,
  );
});
Deno.test("problems/tests#R2: reproduction links after and ticket condition positions", () => {
  const reproduction = {
    ...request,
    kind: "reproduction",
    target: { bundle_hash: hash, release: id("rel", "1") },
    problem: id("prb"),
    basis_seq: "1",
    reports: [id("rpt")],
    before: id("rel"),
    after: id("rel", "1"),
  };
  assertEquals(requestTest.input.safeParse(reproduction).success, true);
  for (
    const value of [
      { ...reproduction, reports: [] },
      { ...reproduction, basis_seq: "0" },
      { ...reproduction, before: reproduction.after },
      { ...reproduction, target: request.target },
    ]
  ) assertEquals(requestTest.input.safeParse(value).success, false);
  const ticket = {
    ticket: id("tkt"),
    check_index: 0,
    check_hash: hash,
    completion_seq: "9223372036854775807",
  };
  assertEquals(
    requestTest.input.safeParse({ ...request, kind: "test_command", ticket })
      .success,
    true,
  );
  assertEquals(
    requestTest.input.safeParse({ ...request, ticket }).success,
    false,
  );
  for (
    const value of [
      { ...ticket, check_index: -1 },
      { ...ticket, completion_seq: 1 },
      { ...ticket, completion_seq: "0" },
      { ...ticket, ticket: id("prb") },
      { ...ticket, check_hash: "bad" },
      { ...ticket, unknown: true },
    ]
  ) assertEquals(ticketTestLinkInputSchema.safeParse(value).success, false);
});
Deno.test("problems/tests#R2: ticket hash uses the fixed canonical acceptance check", async () => {
  const check = {
    kind: "test_command",
    method,
    expected: "Saved record exists.",
  };
  const check_hash = await fingerprint(check);
  assertEquals(
    check_hash,
    await fingerprint({ expected: check.expected, method, kind: check.kind }),
  );
  const link = {
    ticket: id("tkt"),
    check_index: 0,
    check_hash,
    completion_seq: "1",
  };
  assertEquals(ticketTestLinkInputSchema.safeParse(link).success, true);
});
Deno.test("problems/tests#R4: inconclusive and incomplete execution remain explicit", () => {
  assertEquals(
    verificationSchema.safeParse({ ...verification, result: "inconclusive" })
      .success,
    true,
  );
  assertEquals(
    verificationSchema.safeParse({ ...verification, result: "unknown" })
      .success,
    false,
  );
  assertEquals(
    executionEvidenceSchema.safeParse({
      ...execution,
      exit_code: null,
      end_reason: "timeout",
      output: null,
      output_missing_reason: "Output unavailable.",
    }).success,
    true,
  );
  for (
    const value of [
      { ...execution, output: null },
      { ...execution, ended_at: "2026-10-03T00:00:00.000Z" },
      { ...execution, exit_code: null },
      { ...execution, memory_limit_mode: "assumed" },
    ]
  ) assertEquals(executionEvidenceSchema.safeParse(value).success, false);
  assertEquals(
    executionEvidenceListSchema.safeParse([execution, execution]).success,
    false,
  );
});
Deno.test("problems/tests#R16, problems/tests#R19, problems/tests#R20: bounded Deno argv and source cwd", () => {
  assertEquals(testMethodSchema.safeParse(method).success, true);
  assertEquals(
    testMethodSchema.safeParse({
      ...method,
      argv: ["deno", "test", "--allow-read=fixtures", "tests.ts"],
    }).success,
    true,
  );
  for (const timeout_ms of [1, 300_000]) {
    assertEquals(
      testMethodSchema.safeParse({ ...method, timeout_ms }).success,
      true,
    );
  }
  for (
    const value of [
      { ...method, timeout_ms: undefined },
      { ...method, timeout_ms: 0 },
      { ...method, timeout_ms: 300_001 },
      { ...method, timeout_ms: "60000" },
      { ...method, cwd: "../source" },
      { ...method, cwd: "/home" },
      { ...method, cwd: "C:\\home" },
      { ...method, argv: ["sh", "-c", "deno test"] },
      { ...method, argv: ["native-test"] },
      { ...method, argv: ["deno", "test", ""] },
      { ...method, argv: ["deno", "test", "--allow-all", "test.ts"] },
      { ...method, argv: ["deno", "test", "--allow-read", "test.ts"] },
      { ...method, argv: ["deno", "test", "--allow-read=*", "test.ts"] },
      { ...method, argv: ["deno", "test", "--allow-run=deno", "test.ts"] },
      { ...method, argv: ["deno", "test", "tests.ts; cat secret"] },
      { ...method, argv: ["deno", "test", "../test.ts"] },
      { ...method, unknown: true },
    ]
  ) assertEquals(testMethodInputSchema.safeParse(value).success, false);
  assertEquals(TEST_EXECUTION_LIMITS, {
    concurrent: 2,
    preparing: 16,
    timeout_ms: 300_000,
    suggested_timeout_ms: 60_000,
    output_bytes_per_side: 1_048_576,
    process_memory_bytes: 536_870_912,
    deno_heap_bytes: 268_435_456,
  });
});
