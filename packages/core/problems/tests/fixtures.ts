import { assert } from "@std/assert";
import type { RequestContext, Tx } from "../../../protocol/server/mod.ts";
import type { BlobRefRegistration } from "../../../protocol/storage/mod.ts";
import type { Verification } from "../../../protocol/problems/mod.ts";
import {
  canonicalRequest,
  type PreparedResultEvidence,
  type TestConnection,
} from "./model.ts";
import { canonicalHash, canonicalJson, hashCanonical } from "./canonical.ts";
import { blobPurpose, requiredBlobs } from "./blobs.ts";
import { ctx } from "./support.ts";
import { appendRequestObservation, handleRequestTest } from "./commands.ts";

export const HASH = "a".repeat(64);
export const HASH_B = "b".repeat(64);
export const APP = "app_01ary8h2z3n4p5q6r7s8t9v0wa";
export const VRF = "vrf_01ary8h2z3n4p5q6r7s8t9v0wx";

export function input(patch: Partial<TestConnection> = {}) {
  return {
    request_key: "key-1",
    kind: "app_test" as const,
    app: APP,
    target: { bundle_hash: HASH, release: null },
    problem: null,
    basis_seq: null,
    reports: [],
    before: null,
    after: null,
    ticket: null,
    test: TEST_HASH,
    ...patch,
  };
}

export function prepared(
  value: ReturnType<typeof input>,
  principal = "user-1",
) {
  const canonical = canonicalRequest({ ...value, before_bundle_hash: null });
  assert(canonical.ok);
  return () => ({
    request_principal: principal,
    request_key: value.request_key,
    app: value.app,
    request_hash: hashCanonical(canonical.value),
    canonical: canonical.value,
    runner_principal: "runner-1",
    before_bundle_hash: null,
    before_target: null,
    app_in_scope: true,
    refs_ok: true,
    unavailable: false,
  });
}

export function proof(phase: "start_attempt" | "recovery" = "start_attempt") {
  return {
    machine_principal: phase === "recovery" ? "runner-2" : "runner-1",
    phase,
    request_principal: "user-1",
    request_key: "key-1",
    request_hash: REQUEST_HASH,
    app: APP,
    current_runner: "runner-1",
    next_runner: phase === "recovery" ? "runner-2" : null,
    operation: phase === "recovery"
      ? "recover_test_request" as const
      : "observe_test_request" as const,
  };
}

export function requester(): RequestContext {
  return ctx({
    principal: "user-1",
    actor: "user",
    scope: { operations: ["RequestTest"], targets: { app: APP } },
    conditions: { app: APP },
  });
}

export function runner(principal = "runner-1"): RequestContext {
  return ctx({
    principal,
    actor: "machine",
    scope: {
      operations: [
        "RecordVerification",
        "observe_test_request",
        "recover_test_request",
      ],
      targets: {
        app: APP,
        request_principal: "user-1",
        request_key: "key-1",
        request_hash: REQUEST_HASH,
      },
    },
    conditions: { app: APP },
  });
}

export const frozen = {
  code: HASH,
  input: HASH,
  expected: HASH,
  method: {
    argv: ["test", "app_test.ts"],
    cwd: ".",
    timeout_ms: 60_000,
    expected_exit_code: 0,
    environment: HASH,
  },
  blueprint: HASH,
  sdk_dependencies: HASH,
  failure_paths: [{ code: "save_failed", test_hash: HASH }],
  symptom: null,
};
export const TEST_HASH = canonicalHash(frozen);
export const executed = {
  side: "single" as const,
  bundle_hash: HASH,
  test_hash: TEST_HASH,
  started_at: "2026-10-04T00:00:02.000Z",
  ended_at: "2026-10-04T00:00:03.000Z",
  exit_code: 0,
  end_reason: "exited" as const,
  runner_version: "1",
  environment: HASH,
  memory_limit_mode: "hard" as const,
  output: HASH,
  output_missing_reason: null,
  truncated: false,
  redaction_notes: [] as string[],
};

export function evidence(): PreparedResultEvidence {
  return {
    request_principal: "user-1",
    request_key: "key-1",
    request_hash: REQUEST_HASH,
    runner_principal: "runner-1",
    verification_canonical: canonicalJson(verification()),
    observations_json: { checked: true },
    test: TEST_HASH,
    execution: EXECUTION_HASH,
    observations: OBSERVATIONS_HASH,
    frozen,
    execution_evidence: [executed],
    actually_started: true,
    evidence_sufficient: true,
    unstarted_side: null,
    unstarted_reason: null,
  };
}

export function verification(patch: Partial<Verification> = {}): Verification {
  return {
    id: VRF,
    request_principal: "user-1",
    request_hash: REQUEST_HASH,
    ...input(),
    execution: EXECUTION_HASH,
    result: "pass",
    reason: "ran",
    observations: OBSERVATIONS_HASH,
    ...patch,
  };
}

export function blob(
  principal = "runner-1",
  value = verification(),
  preparedEvidence = evidence(),
): BlobRefRegistration[] {
  return requiredBlobs(value, preparedEvidence).map((binding) => ({
    owner_kind: binding.owner_kind,
    owner_key: binding.owner_key,
    field: binding.field,
    registered_seq: "1",
    source: {
      kind: "prepared" as const,
      blob: {
        preparation: "prep-1",
        principal,
        purpose: blobPurpose(binding.field),
        hash: binding.hash,
        size_bytes: 12,
      },
    },
  }));
}

export const EXECUTION_HASH = canonicalHash([executed]);
export const OBSERVATIONS_HASH = canonicalHash({ checked: true });
export const REQUEST_HASH = hashCanonical(
  canonicalRequest(input()).ok
    ? (canonicalRequest(input()) as { ok: true; value: string }).value
    : "",
);

export function accept(tx: Tx) {
  return handleRequestTest(tx, requester(), input(), prepared(input()));
}

export function attempt(tx: Tx) {
  return appendRequestObservation(tx, runner(), {
    phase: "start_attempt",
    request_principal: "user-1",
    request_key: "key-1",
    request_hash: REQUEST_HASH,
    at: "2026-10-04T00:00:01.000Z",
    previous_runner: null,
    runner_principal: "runner-1",
    reason: "attempt",
  }, proof());
}
