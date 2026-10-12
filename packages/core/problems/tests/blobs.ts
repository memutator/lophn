import { err, ok, type Result } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import {
  type BlobRefRegistration,
  defineBlobField,
  defineBlobPurpose,
} from "../../../protocol/storage/mod.ts";
import { idSchema } from "../../../protocol/base/mod.ts";
import type { Verification } from "../../../protocol/problems/mod.ts";
import type { PreparedResultEvidence } from "./model.ts";

const CONFLICT = "같은 요청의 내용이 다르다";
const FORBIDDEN = "이 credential로는 할 수 없다";
const INVALID = "테스트 요청이 올바르지 않다";
const FIELDS = [
  "test",
  "execution",
  "observations",
  "frozen_code",
  "frozen_input",
  "frozen_expected",
  "method_environment",
  "execution_0_environment",
  "execution_0_output",
  "execution_1_environment",
  "execution_1_output",
  "blueprint",
  "sdk_dependencies",
  "symptom",
];
export const TEST_BLOB_PURPOSES = [
  defineBlobPurpose({
    purpose: "frozen_test",
    max_size_bytes: 16 * 1024 * 1024,
  }),
  defineBlobPurpose({ purpose: "test_execution", max_size_bytes: 256 * 1024 }),
  defineBlobPurpose({
    purpose: "test_observations",
    max_size_bytes: 256 * 1024,
  }),
  defineBlobPurpose({
    purpose: "test_environment",
    max_size_bytes: 256 * 1024,
  }),
  defineBlobPurpose({ purpose: "test_output", max_size_bytes: 1024 * 1024 }),
];
export const TEST_BLOB_FIELDS = [
  ...FIELDS.map((field) =>
    defineBlobField({
      owner_kind: "verification",
      field,
      retention: { kind: "permanent" },
      general_read: false,
    })
  ),
  defineBlobField({
    owner_kind: "verification_failure_path",
    field: "test",
    retention: { kind: "permanent" },
    general_read: false,
  }),
];

export function blobPurpose(field: string): string {
  if (field === "execution") return "test_execution";
  if (field === "observations") return "test_observations";
  if (field.startsWith("execution_")) {
    return field.endsWith("_output") ? "test_output" : "test_environment";
  }
  return "frozen_test";
}

export function failurePathOwnerKey(
  verification: string,
  index: number,
): string {
  if (
    !idSchema("vrf").safeParse(verification).success ||
    !Number.isSafeInteger(index) || index < 0
  ) throw new RangeError("invalid failure path key");
  return `${verification}:${index}`;
}

type RequiredBlob = {
  owner_kind: string;
  owner_key: string;
  field: string;
  hash: string;
};
function key(blob: Pick<RequiredBlob, "owner_kind" | "owner_key" | "field">) {
  return JSON.stringify([blob.owner_kind, blob.owner_key, blob.field]);
}
export function requiredBlobs(
  verification: Verification,
  evidence: PreparedResultEvidence,
): RequiredBlob[] {
  const required: RequiredBlob[] = [];
  const add = (field: string, hash: string) =>
    required.push({
      owner_kind: "verification",
      owner_key: verification.id,
      field,
      hash,
    });
  add("test", verification.test);
  add("execution", verification.execution);
  add("observations", verification.observations);
  add("frozen_code", evidence.frozen.code);
  add("frozen_input", evidence.frozen.input);
  add("frozen_expected", evidence.frozen.expected);
  add("method_environment", evidence.frozen.method.environment);
  evidence.execution_evidence.forEach((item, index) => {
    add(`execution_${index}_environment`, item.environment);
    if (item.output) add(`execution_${index}_output`, item.output);
  });
  if (evidence.frozen.blueprint) add("blueprint", evidence.frozen.blueprint);
  if (evidence.frozen.sdk_dependencies) {
    add("sdk_dependencies", evidence.frozen.sdk_dependencies);
  }
  if (evidence.frozen.symptom) add("symptom", evidence.frozen.symptom);
  (evidence.frozen.failure_paths ?? []).forEach((path, index) =>
    required.push({
      owner_kind: "verification_failure_path",
      owner_key: failurePathOwnerKey(verification.id, index),
      field: "test",
      hash: path.test_hash,
    })
  );
  return required;
}

export function registerVerificationBlobs(
  tx: Tx,
  principal: string,
  blobs: readonly BlobRefRegistration[],
  required: readonly RequiredBlob[],
  eventSeq: string,
): Result<true> {
  if (blobs.length < required.length) {
    return err({ code: "invalid_input", message: INVALID });
  }
  const expected = new Map(required.map((blob) => [key(blob), blob.hash]));
  const seen = new Set<string>();
  for (const blob of blobs) {
    const binding = key(blob);
    if (blob.source.kind !== "prepared") {
      return err({ code: "forbidden", message: FORBIDDEN });
    }
    const hash = blob.source.blob.hash;
    if (expected.get(binding) !== hash || seen.has(binding)) {
      return err({ code: "conflict", message: CONFLICT });
    }
    if (
      blob.source.blob.principal !== principal ||
      blob.source.blob.purpose !== blobPurpose(blob.field)
    ) return err({ code: "forbidden", message: FORBIDDEN });
    seen.add(binding);
    const registered = tx.registerBlobRef({
      ...blob,
      registered_seq: eventSeq,
    });
    if (!registered.ok) return registered;
    if (
      registered.value.hash !== hash ||
      registered.value.owner_kind !== blob.owner_kind ||
      registered.value.owner_key !== blob.owner_key ||
      registered.value.field !== blob.field ||
      registered.value.registered_seq !== eventSeq
    ) {
      return err({ code: "conflict", message: CONFLICT });
    }
  }
  if (seen.size !== expected.size) {
    return err({ code: "invalid_input", message: INVALID });
  }
  return ok(true);
}
