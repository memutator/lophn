// blob 영구 참조 등록과 읽기의 순수 규칙(platform/blob-store#R4, R5, R6, R7,
// platform/identity#R9). IO 없음. 파일 관측과 hash는 worker의 몫이다.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  BLOB_READ_MAX_BYTES,
  type BlobFieldDefinition,
  type BlobReadResult,
  type BlobRefRegistration,
  type PermanentBlobReference,
  type PreparedBlob,
  type RequestContext,
} from "../../contracts/platform/mod.ts";

export type BlobAuthorizer = (
  ctx: RequestContext,
  reference: Pick<PermanentBlobReference, "owner_kind" | "owner_key" | "field">,
) => Result<void>;

// 준비 참조가 요구하는 주체·purpose·hash·크기와 맞는지. 파일은 다시 보지 않는다.
export function preparedMatches(
  prepared: PreparedBlob,
  required: Pick<PreparedBlob, "principal" | "purpose" | "hash"> & {
    size_bytes?: number;
  },
): boolean {
  return prepared.principal === required.principal &&
    prepared.purpose === required.purpose &&
    prepared.hash === required.hash &&
    (required.size_bytes === undefined ||
      prepared.size_bytes === required.size_bytes);
}

// 등록 field가 보존 종류와 일반 읽기 허용을 함께 적었는지(T14 완료 기준).
export function fieldDefined(
  fields: readonly BlobFieldDefinition[],
  ownerKind: string,
  field: string,
): Result<BlobFieldDefinition> {
  const found = fields.find((definition) =>
    definition.owner_kind === ownerKind && definition.field === field
  );
  if (found === undefined) {
    return err({
      code: "invalid_input",
      message: "등록되지 않은 blob field다",
    });
  }
  return ok(found);
}

// 일반 읽기를 막은 field(보호 backup 등)는 어떤 actor도 읽지 못한다.
export function generalReadAllowed(field: BlobFieldDefinition): Result<void> {
  if (!field.general_read) {
    return err({
      code: "forbidden",
      message: "이 blob field는 일반 읽기가 없다",
    });
  }
  return ok(undefined);
}

// 부분 읽기 구간. 요청이 음수이거나 시작이 전체 밖이면 invalid_input이다.
// 실제 반환은 256KiB를 넘지 않고, 넘기면 잘림을 함께 답한다(R7).
export function readWindow(
  sizeBytes: number,
  offsetBytes: number,
  lengthBytes: number,
): Result<{ offset_bytes: number; length_bytes: number; truncated: boolean }> {
  if (
    offsetBytes < 0 || lengthBytes < 0 || !Number.isInteger(offsetBytes) ||
    !Number.isInteger(lengthBytes) || offsetBytes > sizeBytes
  ) {
    return err({
      code: "invalid_input",
      message: "blob 읽기 구간이 올바르지 않다",
    });
  }
  const available = sizeBytes - offsetBytes;
  const wanted = Math.min(lengthBytes, available);
  const length = Math.min(wanted, BLOB_READ_MAX_BYTES);
  return ok({
    offset_bytes: offsetBytes,
    length_bytes: length,
    truncated: length < lengthBytes,
  });
}

// 관측한 바이트가 등록된 hash·크기와 다르면 손상이다. 빈 성공으로 채우지 않는다(R6).
export function observedMatches(
  expected: { hash: string; size_bytes: number },
  observed: { hash: string; sizeBytes: number } | undefined,
): Result<void> {
  if (observed === undefined) {
    return err({ code: "unavailable", message: "참조된 blob이 없다" });
  }
  if (
    observed.hash !== expected.hash ||
    observed.sizeBytes !== expected.size_bytes
  ) {
    return err({ code: "unavailable", message: "참조된 blob의 hash가 다르다" });
  }
  return ok(undefined);
}

export type BlobReadAnswer = {
  result: BlobReadResult;
  // available일 때만 실제 바이트. unavailable은 바이트가 없다.
  bytes?: Uint8Array;
};

// 읽기 결과. hash는 등록된 참조에서만 온다. hash를 안다고 읽을 수 없다(R5).
export function readAnswer(
  reference: { hash: string; size_bytes: number },
  window: { offset_bytes: number; length_bytes: number; truncated: boolean },
  bytes: Uint8Array,
): BlobReadAnswer {
  return {
    result: {
      status: "available",
      hash: reference.hash,
      size_bytes: reference.size_bytes,
      offset_bytes: window.offset_bytes,
      length_bytes: window.length_bytes,
      truncated: window.truncated,
      bytes: encodeBase64(bytes),
    },
    bytes,
  };
}

export function unavailableAnswer(
  reference: { hash: string; size_bytes: number },
  reason: "pruned" | "missing" | "corrupt",
): BlobReadAnswer {
  return {
    result: {
      status: "unavailable",
      hash: reference.hash,
      size_bytes: reference.size_bytes,
      code: "unavailable",
      reason,
    },
  };
}

function encodeBase64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

// 등록 요청이 주장하는 hash. 준비 결과 또는 허용된 기존 참조에서만 온다.
export function claimedHash(reference: BlobRefRegistration): string {
  return reference.source.kind === "prepared"
    ? reference.source.blob.hash
    : reference.source.reference.hash;
}
