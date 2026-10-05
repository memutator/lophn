// process stack의 앱 source frame 위치 찾기(snapshots#R11, R6). 당시 release의
// 읽기 전용 준비 폴더(`apps/<app>/bundles/<hash>/`)의 source map으로 원래
// 상대 path를 찾는다. 준비 폴더 밖 path·symlink는 읽지 않고 이유를 남긴다.
import { err, ok, type Result } from "../../base/mod.ts";

// bundle 사본 안의 고정 이름(releases/bundle/seal.ts와 같다). contracts#T36 경로
// 함수가 problems에서 닿지 않으므로 이 leaf가 문자만 반복한다.
const SOURCE_MAP_COPY = "app.js.map";

// source map 실패 이유. 값은 공백 아닌 누락 이유 하나다(snapshots#R4).
export type SourceMapFailure = {
  code: "invalid_input" | "unavailable";
  message: string;
};

async function readIfInside(
  root: string,
  path: string,
): Promise<Result<string, SourceMapFailure>> {
  // NUL·backslash·".."은 준비 폴더 밖으로 나가는 path다(R6).
  if (path.includes("\u0000") || path.includes("\\")) {
    return err({
      code: "invalid_input",
      message: "path가 준비 폴더 밖을 가리킨다",
    });
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "..")) {
    return err({
      code: "invalid_input",
      message: "path가 준비 폴더 밖을 가리킨다",
    });
  }
  const full = `${root}/${path}`;
  try {
    // symlink는 읽지 않는다: 준비 폴더 밖을 가리킬 수 있다(R6).
    const info = await Deno.lstat(full);
    if (info.isSymlink) {
      return err({
        code: "unavailable",
        message: "path가 symlink라 읽지 않는다",
      });
    }
    if (!info.isFile) {
      return err({
        code: "unavailable",
        message: "path가 파일이 아니다",
      });
    }
    return ok(await Deno.readTextFile(full));
  } catch {
    return err({ code: "unavailable", message: "파일을 읽지 못했다" });
  }
}

export { readIfInside };

// bundle 사본의 source map 파일을 읽는다. map이 없으면 그 이유를 돌려준다(R11).
export async function readSourceMap(
  copyRoot: string,
): Promise<Result<string, SourceMapFailure>> {
  return await readIfInside(copyRoot, SOURCE_MAP_COPY);
}

// bundle 사본의 manifest를 읽고 files 목록을 검사한다.
export type BundledManifest = {
  entrypoint: string;
  files: readonly { path: string; hash: string }[];
  sdk_dependencies: readonly { name: string; version: string }[];
};

export async function readBundleManifest(
  copyRoot: string,
): Promise<Result<BundledManifest, SourceMapFailure>> {
  const text = await readIfInside(copyRoot, "manifest.json");
  if (!text.ok) return text;
  try {
    const parsed: unknown = JSON.parse(text.value);
    if (
      typeof parsed !== "object" || parsed === null || !("files" in parsed)
    ) {
      return err({ code: "invalid_input", message: "manifest 형식이 아니다" });
    }
    const record = parsed as {
      entrypoint?: unknown;
      files?: unknown;
      sdk_dependencies?: unknown;
    };
    if (!Array.isArray(record.files)) {
      return err({ code: "invalid_input", message: "manifest 형식이 아니다" });
    }
    const files: { path: string; hash: string }[] = [];
    for (const entry of record.files) {
      if (
        typeof entry !== "object" || entry === null || !("path" in entry) ||
        !("hash" in entry) ||
        typeof (entry as { path: unknown }).path !== "string" ||
        typeof (entry as { hash: unknown }).hash !== "string"
      ) {
        return err({
          code: "invalid_input",
          message: "manifest 형식이 아니다",
        });
      }
      files.push({
        path: (entry as { path: string }).path,
        hash: (entry as { hash: string }).hash,
      });
    }
    return ok({
      entrypoint: typeof record.entrypoint === "string"
        ? record.entrypoint
        : "",
      files,
      sdk_dependencies: Array.isArray(record.sdk_dependencies)
        ? record.sdk_dependencies
        : [],
    });
  } catch {
    return err({ code: "invalid_input", message: "manifest를 읽지 못했다" });
  }
}

// bundle 내 hash로 준비 폴더의 파일 내용을 읽는다. manifest에 없으면 이유를
// 돌려준다(snapshots#R11).
export async function readBundledFile(
  copyRoot: string,
  manifest: BundledManifest,
  path: string,
): Promise<Result<string, SourceMapFailure>> {
  const found = manifest.files.find((file) => file.path === path);
  if (found === undefined) {
    return err({
      code: "invalid_input",
      message: "bundle manifest에 path가 없다",
    });
  }
  return await readIfInside(copyRoot, path);
}

// 단일 V3 VLQ 문자 디코딩을 위한 기본 64진법 문자표.
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_VALUES: Record<string, number> = {};
for (let index = 0; index < B64.length; index++) {
  B64_VALUES[B64[index]!] = index;
}

// base64 VLQ 숫자 하나를 풀고 다음 위치를 돌려준다.
function decodeVlq(
  source: string,
  start: number,
): Result<{ value: number; next: number }, SourceMapFailure> {
  let result = 0;
  let shift = 0;
  let position = start;
  for (;;) {
    if (position >= source.length) {
      return err({
        code: "invalid_input",
        message: "source map VLQ가 끊겼다",
      });
    }
    const digit = B64_VALUES[source[position]!];
    if (digit === undefined) {
      return err({
        code: "invalid_input",
        message: "source map VLQ 문자가 아니다",
      });
    }
    position += 1;
    const isContinuation = (digit & 32) !== 0;
    result += (digit & 31) * 2 ** shift;
    if (!isContinuation) {
      const negative = (result & 1) === 1;
      const magnitude = result >>> 1;
      // 2^31 부근 가수를 방어한다: 유의미한 값은 32bit 안이다.
      const value = magnitude > 2 ** 31
        ? Number.NaN
        : negative
        ? -magnitude
        : magnitude;
      if (!Number.isFinite(value)) {
        return err({
          code: "invalid_input",
          message: "source map VLQ 값이 크다",
        });
      }
      return ok({ value, next: position });
    }
    shift += 5;
    if (shift > 50) {
      return err({
        code: "invalid_input",
        message: "source map VLQ가 길다",
      });
    }
  }
}

// source map mappings의 첫 segment 표지를 돌려주는 콜백 모양.
export type MappingVisitor = (
  generated: { line: number; column: number },
  original: { path: string; line: number; column: number },
) => void;

// V3 source map mappings를 풀며 원본 위치 segment마다 visitor를 부른다.
// 십여 단위 byte의 map 크기 한도는 호출자가 준다: 여기는 형식만 본다.
export function walkMappings(
  mappings: string,
  visit: MappingVisitor,
): Result<true, SourceMapFailure> {
  const lines = mappings.split(";");
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  for (let generatedLine = 0; generatedLine < lines.length; generatedLine++) {
    const segments = lines[generatedLine]!.split(",");
    let generatedColumn = 0;
    for (const segment of segments) {
      if (segment.length === 0) continue;
      const first = decodeVlq(segment, 0);
      if (!first.ok) return first;
      generatedColumn += first.value.value;
      let cursor = first.value.next;
      let sourceDelta = 0;
      let lineDelta = 0;
      let columnDelta = 0;
      // 1개 segment(생성 위치만)는 원본 위치가 없으므로 건너뛴다.
      const fields: number[] = [first.value.value];
      for (let count = 1; count < 5; count++) {
        if (cursor >= segment.length) break;
        const nextField = decodeVlq(segment, cursor);
        if (!nextField.ok) return nextField;
        cursor = nextField.value.next;
        fields.push(nextField.value.value);
      }
      if (fields.length >= 4) {
        [sourceDelta, lineDelta, columnDelta] = [
          fields[1]!,
          fields[2]!,
          fields[3]!,
        ];
        sourceIndex += sourceDelta;
        originalLine += lineDelta;
        originalColumn += columnDelta;
        visit(
          { line: generatedLine + 1, column: generatedColumn },
          // 경로는 visitor가 source roots·sources로 결정한다.
          { path: "", line: originalLine + 1, column: originalColumn + 1 },
        );
      }
    }
  }
  return ok(true);
}
