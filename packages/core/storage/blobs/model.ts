// blob 준비·설치의 순수 규칙. IO 없음.

import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type PreparedBlob,
  preparedBlobSchema,
} from "../../../protocol/storage/mod.ts";

export const BLOB_STORE_TMP_DIR = "blobs/tmp";
// 완성 blob은 hash 앞 2자 폴더 아래 나머지 62자 파일로 둔다.
export const BLOB_STORE_OBJECTS_DIR = "blobs/sha256";
const PREFIX_CHARS = 2;
export const BLOB_READ_ONLY_MODE = 0o400;

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

// 최대 크기 초과는 쓰는 동안 바로 본다. 초과분을 메모리에 쌓지 않는다.

// 예상 hash·크기 불일치는 준비 자체가 잘못된 입력이다.

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
