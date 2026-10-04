// Document·Version의 순수 규칙. SQL·clock·난수는 없다.
// content_hash는 고정 필드 JSON을 codepoint 순으로 정렬한 UTF-8의 SHA-256이다
// (domain-model/documents/versions "정할 것", architecture/documents 96행).

import { sha256Hex } from "../../base/mod.ts";
import type { ContentFile, FormatRef } from "../../contracts/documents/mod.ts";

const FILE_FIELDS = [
  "blob_hash",
  "bytes",
  "media_type",
  "path",
  "primary",
] as const;

// 고정 필드만, 키는 codepoint 순, 공백 없이. 준비 처리와 검증이 같은 encoder를 쓴다.
export function canonicalFilesJson(files: readonly ContentFile[]): string {
  const ordered = [...files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
  return `[${
    ordered.map((file) => {
      const entries = FILE_FIELDS.map((field) =>
        `${JSON.stringify(field)}:${JSON.stringify(file[field])}`
      );
      return `{${entries.join(",")}}`;
    }).join(",")
  }]`;
}

export async function filesHash(
  files: readonly ContentFile[],
): Promise<string> {
  return await sha256Hex(canonicalFilesJson(files));
}

export function contentUnchanged(
  latest: { content_hash: string; format: FormatRef },
  next: { content_hash: string; format: FormatRef },
): boolean {
  return latest.content_hash === next.content_hash &&
    latest.format.name === next.format.name &&
    latest.format.module_hash === next.format.module_hash &&
    latest.format.explicit === next.format.explicit;
}

// 판 번호는 문서마다 1부터 연속이다. 다음 번호는 현재 최댓값 + 1이다.
export function nextVersionNumber(currentMax: number | null): number {
  return currentMax === null ? 1 : currentMax + 1;
}
