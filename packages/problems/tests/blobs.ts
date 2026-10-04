import { err, ok, type Result } from "../../base/mod.ts";
import type { BlobRefRegistration, Tx } from "../../contracts/platform/mod.ts";
import type { Verification } from "../../contracts/problems/mod.ts";
import type { PreparedResultEvidence } from "./model.ts";

const CONFLICT = "같은 요청의 내용이 다르다";
const FORBIDDEN = "이 credential로는 할 수 없다";
const INVALID = "테스트 요청이 올바르지 않다";

export function requiredBlobs(
  verification: Verification,
  evidence: PreparedResultEvidence,
): Map<string, string> {
  const required = new Map<string, string>([
    ["test", verification.test],
    ["execution", verification.execution],
    ["observations", verification.observations],
    ["frozen_code", evidence.frozen.code],
    ["frozen_input", evidence.frozen.input],
    ["frozen_expected", evidence.frozen.expected],
    ["method_environment", evidence.frozen.method.environment],
  ]);
  evidence.execution_evidence.forEach((item, index) => {
    required.set(`execution_${index}_environment`, item.environment);
    if (item.output) required.set(`execution_${index}_output`, item.output);
  });
  if (evidence.frozen.blueprint) {
    required.set("blueprint", evidence.frozen.blueprint);
  }
  if (evidence.frozen.sdk_dependencies) {
    required.set("sdk_dependencies", evidence.frozen.sdk_dependencies);
  }
  if (evidence.frozen.symptom) required.set("symptom", evidence.frozen.symptom);
  for (const path of evidence.frozen.failure_paths ?? []) {
    required.set(`failure_${path.code}`, path.test_hash);
  }
  return required;
}

export function registerVerificationBlobs(
  tx: Tx,
  principal: string,
  verificationId: string,
  blobs: readonly BlobRefRegistration[],
  required: ReadonlyMap<string, string>,
  eventSeq: string,
): Result<true> {
  if (blobs.length < required.size) {
    return err({ code: "invalid_input", message: INVALID });
  }
  const seen = new Set<string>();
  for (const blob of blobs) {
    if (
      blob.owner_kind !== "verification" || blob.owner_key !== verificationId
    ) {
      return err({ code: "conflict", message: CONFLICT });
    }
    if (blob.source.kind !== "prepared") {
      return err({ code: "forbidden", message: FORBIDDEN });
    }
    const hash = blob.source.blob.hash;
    if (required.get(blob.field) !== hash || seen.has(blob.field)) {
      return err({ code: "conflict", message: CONFLICT });
    }
    if (blob.source.blob.principal !== principal) {
      return err({ code: "forbidden", message: FORBIDDEN });
    }
    seen.add(blob.field);
    const registered = tx.registerBlobRef({
      ...blob,
      registered_seq: eventSeq,
    });
    if (!registered.ok) return registered;
    if (registered.value.hash !== hash) {
      return err({ code: "conflict", message: CONFLICT });
    }
  }
  if (seen.size < required.size) {
    return err({ code: "invalid_input", message: INVALID });
  }
  return ok(true);
}
