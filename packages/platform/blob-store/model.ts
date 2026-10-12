// blob 준비·설치의 순수 규칙(platform/blob-store#R1, R2, R12). IO 없음.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  BLOB_PREPARATION_TTL_MS,
  BLOB_PREPARE_MAX_BYTES,
  type PreparedBlob,
  preparedBlobSchema,
} from "../../protocol/platform/mod.ts";
import { BLOB_PREPARE_CHUNK_MAX_BYTES } from "../../protocol/platform/mod.ts";

export const BLOB_STORE_TMP_DIR = "blobs/tmp";
// 완성 blob은 hash 앞 2자 폴더 아래 나머지 62자 파일로 둔다(domain-model "경로").
export const BLOB_STORE_OBJECTS_DIR = "blobs/sha256";
export const PREFIX_CHARS = 2;
export const BLOB_READ_ONLY_MODE = 0o400;

export type PrepareDecision = {
  // 기존 blob이 있으면 파일을 새로 쓰지 않는다(R1).
  action: "install" | "reuse";
};

export function tmpDirFor(root: string): string {
  return `${root}/${BLOB_STORE_TMP_DIR}`;
}

// hash의 앞 2자를 폴더로, 나머지 62자를 파일 이름으로 나눈다.
export function objectPathFor(root: string, hash: string): string {
  return `${root}/${BLOB_STORE_OBJECTS_DIR}/${hash.slice(0, PREFIX_CHARS)}/${
    hash.slice(PREFIX_CHARS)
  }`;
}

// 임시 파일은 아직 내용을 모르므로 고유 이름으로 둔다. 디렉터리 sync 대상의 이름이다.
export function tmpPathFor(
  tmpDir: string,
  suffix: string,
): string {
  return `${tmpDir}/prepare-${suffix}`;
}

export function chunkLimit(): number {
  return BLOB_PREPARE_CHUNK_MAX_BYTES;
}

// 최대 크기 초과는 쓰는 동안 바로 본다. 초과분을 메모리에 쌓지 않는다.
export function sizeVerdict(bytes: number): Result<number> {
  if (bytes > BLOB_PREPARE_MAX_BYTES) {
    return err({
      code: "invalid_input",
      message: "blob 크기가 최대 한도를 넘는다",
    });
  }
  return ok(bytes);
}

// 예상 hash·크기 불일치는 준비 자체가 잘못된 입력이다(R2).
export function expectedMatches(
  actual: { hash: string; sizeBytes: number },
  expected?: { hash?: string; sizeBytes?: number },
): boolean {
  if (
    expected?.hash !== undefined &&
    expected.hash.toLowerCase() !== actual.hash
  ) return false;
  if (
    expected?.sizeBytes !== undefined &&
    expected.sizeBytes !== actual.sizeBytes
  ) return false;
  return true;
}

// 답은 준비 관측 결과다. hash는 계산한 바이트에서 온다.
export function preparedOf(
  observation: { preparation: string; principal: string; purpose: string },
  installed: { hash: string; sizeBytes: number },
): Result<PreparedBlob> {
  const parsed = preparedBlobSchema.safeParse({
    preparation: observation.preparation,
    principal: observation.principal,
    purpose: observation.purpose,
    hash: installed.hash,
    size_bytes: installed.sizeBytes,
  });
  if (!parsed.success) {
    return err({
      code: "invalid_input",
      message: "준비 결과가 schema와 다르다",
    });
  }
  return ok(parsed.data);
}

// 준비 참조 수명. 만기 등록 요청은 invalid_input이다.
export function referenceExpired(
  nowMs: number,
  registeredMs: number,
): boolean {
  return nowMs - registeredMs >= BLOB_PREPARATION_TTL_MS;
}
