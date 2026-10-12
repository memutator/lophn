import { assert } from "@std/assert";
import type { Verification } from "../../../../protocol/problems/mod.ts";
import { canonicalHash, canonicalJson, hashCanonical } from "../canonical.ts";
import { canonicalRequest, type PreparedResultEvidence } from "../model.ts";
import { fileLedger } from "./mod.ts";
import { ctx } from "../support.ts";
import {
  evidence,
  executed,
  frozen,
  HASH,
  input,
  prepared,
  proof,
  runner,
  verification,
} from "../fixtures.ts";
const beforeRelease = "rel_01ary8h2z3n4p5q6r7s8t9v0wb";
const afterRelease = "rel_01ary8h2z3n4p5q6r7s8t9v0wc";
export const beforeBundle = "b".repeat(64);
const reproductionFrozen = {
  ...frozen,
  blueprint: null,
  sdk_dependencies: null,
  failure_paths: null,
  symptom: HASH,
};
export function reproductionSetup(
  reports = [
    "rpt_01ary8h2z3n4p5q6r7s8t9v0wf",
    "rpt_01ary8h2z3n4p5q6r7s8t9v0we",
  ],
) {
  const ledger = fileLedger();
  const request = input({
    kind: "reproduction",
    target: { bundle_hash: HASH, release: afterRelease },
    problem: "prb_01ary8h2z3n4p5q6r7s8t9v0wd",
    basis_seq: "4",
    reports,
    before: beforeRelease,
    after: afterRelease,
    test: canonicalHash(reproductionFrozen),
  });
  const canonical = canonicalRequest(request);
  assert(canonical.ok);
  const hash = hashCanonical(canonical.value);
  const caller = ctx({
    ...runner(),
    scope: {
      ...runner().scope,
      targets: { ...runner().scope.targets, request_hash: hash },
    },
  });
  const preparedValue = {
    ...prepared(request)(),
    before_bundle_hash: beforeBundle,
    before_target: { release: beforeRelease, bundle_hash: beforeBundle },
  };
  const lifecycleProof = { ...proof(), request_hash: hash };
  const execution = (["before", "after"] as const).map((side) => ({
    ...executed,
    side,
    bundle_hash: side === "before" ? beforeBundle : HASH,
    test_hash: request.test,
  }));
  const result = (
    sides = execution,
    observations: unknown = { checked: true },
    outcome: Verification["result"] = "pass",
  ) => {
    const value = verification({
      ...request,
      request_hash: hash,
      execution: canonicalHash(sides),
      observations: canonicalHash(observations),
      result: outcome,
    });
    const preparedEvidence: PreparedResultEvidence = {
      ...evidence(),
      request_hash: hash,
      verification_canonical: canonicalJson(value),
      test: request.test,
      execution: value.execution,
      observations: value.observations,
      observations_json: observations,
      frozen: reproductionFrozen,
      execution_evidence: sides,
    };
    return { value, preparedEvidence };
  };
  return {
    ledger,
    request,
    hash,
    caller,
    preparedValue,
    lifecycleProof,
    execution,
    result,
  };
}
