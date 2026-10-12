// 제출 파일의 검사와 읽기다. coding agent가 명시한 파일만 realpath로
// 다시 풀어 submission root 안인지 보고, 운영 data·backup·다른 앱 source로 이어진
// 경로는 없는 파일과 똑같이 거절한다. 거절 응답에는 해석한 경로도 금지 영역의
// 경로도 넣지 않는다(운영 data 경로가 통로 출력에 나오지 않는다).
import { createHash } from "node:crypto";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";
import {
  err,
  type LophnError,
  ok,
  type Result,
  sha256Hex,
} from "../../base/mod.ts";
import type { DocumentFileInput } from "../../protocol/projects/mod.ts";
import type { PreparedBlob } from "../../protocol/storage/mod.ts";

export type SubmissionScope = {
  // 제출을 허용하는 root다. 연결 source의 작업 폴더(submission root)다.
  root: string;
  // root 안이어도 제출하지 않는 영역이다: 운영 data·backup·다른 앱 source.
  forbidden: readonly string[];
};

export type SubmittedFile = {
  // 문서 안의 상대 경로다. 첫 파일의 폴더 기준이고 밖이면 파일 이름이다.
  path: string;
  media_type: string;
  bytes: number;
  blob_hash: string;
  primary: boolean;
  // 검사한 realpath만 연다. 파일 전체를 메모리에 모으지 않는다.
  open(): ReadableStream<Uint8Array>;
};

// 확장자로 알 수 있는 형식만 이름을 붙인다. 모르면 data 형식(*/*)이 받는다.
const MEDIA_TYPES: Readonly<Record<string, string>> = {
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".html": "text/html",
  ".htm": "text/html",
  ".txt": "text/plain",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".csv": "text/csv",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".toml": "application/toml",
  ".xml": "application/xml",
};
const DEFAULT_MEDIA_TYPE = "application/octet-stream";

export function mediaTypeOf(path: string): string {
  return MEDIA_TYPES[extname(path).toLowerCase()] ?? DEFAULT_MEDIA_TYPE;
}

function denied(path: string): LophnError {
  // 없는 파일·범위 밖·금지 영역·일반 파일이 아닌 것이 모두 같은 답이다.
  return {
    code: "invalid_input",
    message: "제출할 수 없는 파일이다",
    details: { path },
  };
}

function inside(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel === "" ||
    (rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

async function realOrResolved(path: string): Promise<string> {
  try {
    return await Deno.realPath(path);
  } catch {
    // 없는 금지 영역도 이름 그대로 막는다.
    return resolve(path);
  }
}

async function hashAndSize(
  real: string,
): Promise<Result<{ hash: string; bytes: number }, LophnError>> {
  const digest = createHash("sha256");
  let bytes = 0;
  try {
    const file = await Deno.open(real, { read: true });
    try {
      for await (const chunk of file.readable) {
        digest.update(chunk);
        bytes += chunk.byteLength;
      }
    } finally {
      // readable을 끝까지 읽으면 file이 닫힌다. 중간 실패만 직접 닫는다.
      try {
        file.close();
      } catch { /* 이미 닫힘 */ }
    }
  } catch {
    return err({
      code: "unavailable",
      message: "제출 파일을 읽지 못했다",
    });
  }
  return ok({ hash: digest.digest("hex"), bytes });
}

// 검사한 realpath를 읽을 때 연다. 열기도 읽기도 pull마다 비동기다(core module graph에는
// 동기 file API가 없어야 한다).
function openStream(real: string): ReadableStream<Uint8Array> {
  let file: Deno.FsFile | undefined;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      file ??= await Deno.open(real, { read: true });
      const chunk = new Uint8Array(64 * 1024);
      const count = await file.read(chunk);
      if (count === null) {
        file.close();
        controller.close();
        return;
      }
      controller.enqueue(chunk.subarray(0, count));
    },
    cancel() {
      file?.close();
    },
  });
}

// 첫 파일이 primary다. 입력 순서를 바꾸지 않는다.
export async function resolveSubmission(
  paths: readonly string[],
  scope: SubmissionScope,
): Promise<Result<SubmittedFile[], LophnError>> {
  if (paths.length === 0) {
    return err({ code: "invalid_input", message: "제출할 파일이 없다" });
  }
  let root: string;
  try {
    root = await Deno.realPath(scope.root);
  } catch {
    return err({
      code: "unavailable",
      message: "제출 root를 열지 못했다",
    });
  }
  const forbidden = await Promise.all(scope.forbidden.map(realOrResolved));
  const reals: string[] = [];
  for (const path of paths) {
    if (!path.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(path)) {
      return err(denied(path));
    }
    let real: string;
    try {
      real = await Deno.realPath(path);
      if (!(await Deno.stat(real)).isFile) return err(denied(path));
    } catch {
      return err(denied(path));
    }
    if (!inside(real, root)) return err(denied(path));
    if (forbidden.some((zone) => inside(real, zone))) return err(denied(path));
    reals.push(real);
  }
  const base = dirname(reals[0]);
  const seen = new Set<string>();
  const files: SubmittedFile[] = [];
  for (const [index, real] of reals.entries()) {
    const name = inside(real, base)
      ? relative(base, real).split(sep).join("/")
      : basename(real);
    if (seen.has(name)) {
      return err({
        code: "invalid_input",
        message: "제출 파일의 이름이 겹친다",
        details: { path: name },
      });
    }
    seen.add(name);
    const measured = await hashAndSize(real);
    if (!measured.ok) return measured;
    files.push({
      path: name,
      media_type: mediaTypeOf(real),
      bytes: measured.value.bytes,
      blob_hash: measured.value.hash,
      primary: index === 0,
      open: () => openStream(real),
    });
  }
  return ok(files);
}

// documents/versions의 content_hash와 같은 규칙이다: 고정 필드 JSON을 path 순으로,
// 키는 codepoint 순으로 공백 없이 만든 UTF-8의 SHA-256. 문서 저장 준비가 낸 hash와
// 같은 값이어야 해서 core의 projects/file-tracking/routes/format-validate_test.ts가 두 정의를 맞대 본다.
const FILE_FIELDS = [
  "blob_hash",
  "bytes",
  "media_type",
  "path",
  "primary",
] as const;

export type HashedFile = {
  path: string;
  blob_hash: string;
  bytes: number;
  media_type: string;
  primary: boolean;
};

export function canonicalFilesJson(files: readonly HashedFile[]): string {
  const ordered = [...files].sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0
  );
  return `[${
    ordered.map((file) =>
      `{${
        FILE_FIELDS.map((field) =>
          `${JSON.stringify(field)}:${JSON.stringify(file[field])}`
        ).join(",")
      }}`
    ).join(",")
  }]`;
}

export function canonicalFilesHash(
  files: readonly HashedFile[],
): Promise<string> {
  return sha256Hex(canonicalFilesJson(files));
}

// 제출 bytes를 core의 blob 준비로 넘기는 통로다. 준비 참조는 core가 정하고
// (principal·purpose·hash·수명), 이 통로는 받은 참조만 문서 파일 입력에 싣는다.
export type PrepareBytes = (
  file: SubmittedFile,
) => Promise<Result<PreparedBlob, LophnError>>;

// 검사를 마친 제출 파일을 document.prepare의 파일 입력으로 바꾼다. 준비된 blob의
// hash·크기가 읽은 bytes와 다르면 파일이 읽는 사이 바뀐 것이라 저장하지 않는다.
export async function toDocumentFiles(
  files: readonly SubmittedFile[],
  prepareBytes: PrepareBytes,
): Promise<Result<DocumentFileInput[], LophnError>> {
  const inputs: DocumentFileInput[] = [];
  for (const file of files) {
    const prepared = await prepareBytes(file);
    if (!prepared.ok) return prepared;
    const blob = prepared.value;
    if (blob.hash !== file.blob_hash || blob.size_bytes !== file.bytes) {
      return err({
        code: "conflict",
        message: "제출 파일이 읽는 사이 바뀌었다. 다시 제출한다",
        details: { path: file.path },
      });
    }
    inputs.push({
      path: file.path,
      media_type: file.media_type,
      bytes: file.bytes,
      blob_hash: file.blob_hash,
      primary: file.primary,
      content: { kind: "prepared", blob },
    });
  }
  return ok(inputs);
}

// 경로를 제출 root 기준으로 읽고(상대 경로는 root 아래, 절대 경로는 그대로) 검사한 파일을
// core의 blob 준비로 넘겨 document.prepare의 파일 입력으로 만든다.
export async function submitPaths(
  paths: readonly string[],
  scope: SubmissionScope,
  prepareBytes: PrepareBytes,
): Promise<Result<DocumentFileInput[], LophnError>> {
  const resolved = await resolveSubmission(
    paths.map((path) => isAbsolute(path) ? path : resolve(scope.root, path)),
    scope,
  );
  if (!resolved.ok) return resolved;
  return await toDocumentFiles(resolved.value, prepareBytes);
}
