// 앱 예외 stack을 원래 source 줄로 푼다. 당시 release의 봉인된 bundle 사본
// (`apps/<app>/bundles/<hash>/`)의 source map을 쓴다. 사본 밖 path, symlink, ".."는 읽지 않는다.
// 봉인된 bundle은 agent의 file 범위 밖이라 log에는 풀린 줄만 남는다.
import type { Stats } from "node:fs";
import { lstat, readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { err, ok, type Result } from "../../../../base/mod.ts";
import { appBundleCopy } from "../../../../protocol/apps/mod.ts";

export type StackFrame = {
  path: string;
  function: string | null;
  line: number;
  column: number;
};

const LIMITS = {
  snapshot_frames: 32,
  stack_bytes: 16_384,
} as const;

// 화면 key 규칙(apps/releases/ui-build/app-build.ts의 SCREEN_KEY와 같다). 그 file이
// export하지 않아 규칙만 반복한다.
const SCREEN_KEY = /^[a-z0-9][a-z0-9-]*$/;

// source map 실패 이유. 값은 공백 아닌 누락 이유 하나다.
type SourceMapFailure = {
  code: "invalid_input" | "unavailable";
  message: string;
};

async function readIfInside(
  root: string,
  path: string,
): Promise<Result<string, SourceMapFailure>> {
  // NUL·backslash·".."은 bundle 사본 밖으로 나가는 path다.
  if (path.includes("\u0000") || path.includes("\\")) {
    return err({
      code: "invalid_input",
      message: "path가 bundle 사본 밖을 가리킨다",
    });
  }
  const parts = path.split("/");
  if (parts.some((part) => part === "" || part === "..")) {
    return err({
      code: "invalid_input",
      message: "path가 bundle 사본 밖을 가리킨다",
    });
  }
  const full = `${root}/${path}`;
  try {
    // symlink는 읽지 않는다: bundle 사본 밖을 가리킬 수 있다.
    const info = await lstat(full);
    if (info.isSymbolicLink()) {
      return err({
        code: "unavailable",
        message: "path가 symlink라 읽지 않는다",
      });
    }
    if (!info.isFile()) {
      return err({
        code: "unavailable",
        message: "path가 파일이 아니다",
      });
    }
    return ok(await readFile(full, "utf8"));
  } catch {
    return err({ code: "unavailable", message: "파일을 읽지 못했다" });
  }
}

// bundle 사본에서 화면 하나의 source map(`screens/<key>/main.js.map`)을 읽는다.
// map이 없으면 그 이유를 돌려준다.
async function readSourceMap(
  copyRoot: string,
  screenKey: string,
): Promise<Result<string, SourceMapFailure>> {
  if (!SCREEN_KEY.test(screenKey)) {
    return err({ code: "invalid_input", message: "화면 key가 아니다" });
  }
  return await readIfInside(copyRoot, `screens/${screenKey}/main.js.map`);
}

// bundle 사본의 manifest를 읽고 files 목록을 검사한다.
type BundledManifest = {
  entrypoint: string;
  files: readonly { path: string; hash: string }[];
  sdk_dependencies: readonly { name: string; version: string }[];
};

async function readBundleManifest(
  copyRoot: string,
): Promise<Result<BundledManifest, SourceMapFailure>> {
  const text = await readIfInside(copyRoot, "manifest.json");
  if (!text.ok) return text;
  try {
    const parsed: unknown = JSON.parse(text.value);
    if (typeof parsed !== "object" || parsed === null || !("files" in parsed)) {
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
        typeof entry !== "object" ||
        entry === null ||
        !("path" in entry) ||
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
      entrypoint:
        typeof record.entrypoint === "string" ? record.entrypoint : "",
      files,
      sdk_dependencies: Array.isArray(record.sdk_dependencies)
        ? record.sdk_dependencies
        : [],
    });
  } catch {
    return err({ code: "invalid_input", message: "manifest를 읽지 못했다" });
  }
}

// 당시 release의 읽기 전용 bundle 사본 위치. 경로 규칙은 protocol의 appBundleCopy가 갖고 모양이 틀리면 던진다.
function bundleCopyPath(
  dataRoot: string,
  app: string,
  bundleHash: string,
): Result<string, SourceMapFailure> {
  try {
    return ok(appBundleCopy(dataRoot, app, bundleHash));
  } catch (thrown) {
    return err({
      code: "invalid_input",
      message: thrown instanceof Error ? thrown.message : String(thrown),
    });
  }
}

// 사본의 봉인된 source map으로 stack의 앱 frame 위치를 찾는다. 풀 수 없으면 빈 목록이다.
export async function resolveStackFrames(input: {
  dataRoot: string;
  app: string;
  bundleHash: string | null;
  stack: string | null;
}): Promise<StackFrame[]> {
  if (input.stack === null || input.bundleHash === null) return [];
  const copy = bundleCopyPath(input.dataRoot, input.app, input.bundleHash);
  if (!copy.ok) return [];
  // 화면 JS를 가리킨 stack은 그 화면의 map으로 앱 source 위치를 푼다. 사본 안 화면 JS의
  // 생성 위치를 그대로 frame으로 두면 앱 source를 잇지 못하므로 framesInsideBundle보다 먼저 한다.
  const manifest = await readBundleManifest(copy.value);
  const mapped = manifest.ok
    ? await frameFromScreenMap(copy.value, input.stack)
    : null;
  if (mapped !== null) {
    return [mapped];
  }
  // bundle 사본 안 TS stack은 이미 원본 상대 path·함수다. source map을 거치지 않는다.
  return (await framesInsideBundle(copy.value, input.stack)) ?? [];
}

// 화면 JS 파일(`/screens/<key>/main.js`). stack file은 URL이든 path든 이 꼴로 끝난다.
const SCREEN_FILE = /\/screens\/([^/]+)\/main\.js$/;

// stack에서 화면 JS를 가리킨 첫 site를 그 화면의 source map으로 앱 source 위치로 푼다.
// 같은 줄에서 대상 열 이하 가장 큰 표지 하나만 취한다. stack 열은 1-based, map 열은 0-based다.
async function frameFromScreenMap(
  copy: string,
  stack: string,
): Promise<StackFrame | null> {
  const site = stackSites(stack).find((candidate) =>
    SCREEN_FILE.test(candidate.file),
  );
  if (site === undefined) return null;
  const map = await readSourceMap(copy, SCREEN_FILE.exec(site.file)![1]!);
  if (!map.ok) return null;
  let parsed: { mappings?: unknown; sources?: unknown };
  try {
    parsed = JSON.parse(map.value) as typeof parsed;
  } catch {
    return null;
  }
  if (typeof parsed.mappings !== "string" || !Array.isArray(parsed.sources)) {
    return null;
  }
  const sources: unknown[] = parsed.sources;
  const target = site.column - 1;
  let chosen: { source: unknown; line: number; column: number } | null = null;
  const walked = walkAllMappings(parsed.mappings, (entry) => {
    if (entry.generatedLine !== site.line) return;
    if (entry.generatedColumn > target) return;
    chosen = {
      source: sources[entry.sourceIndex],
      line: entry.originalLine,
      column: entry.originalColumn,
    };
  });
  if (!walked.ok || chosen === null) return null;
  const found = chosen as { source: unknown; line: number; column: number };
  if (typeof found.source !== "string") return null;
  // sources를 bundle 사본 안 상대 path로 좁힌다.
  const path = relativeToFolder(found.source);
  if (path === null || found.line < 1 || found.column < 1) return null;
  return {
    path,
    function: site.function,
    line: found.line,
    column: found.column,
  };
}

// bundle 사본 밖 소스 이름 판정. webpack:/~ / file: / absolute 모양은
// bundle 사본 안 상대 path가 아니다.
const OUTSIDE_SOURCE = /^[A-Za-z][A-Za-z0-9+.-]*:|^[\\/]|^[A-Za-z]:|\.\.|\\/;

type StackSite = {
  function: string | null;
  file: string;
  line: number;
  column: number;
};

function stackSites(stack: string): StackSite[] {
  const sites: StackSite[] = [];
  for (const line of stack.split("\n")) {
    const withName = /^\s*at (?:async )?(.+?) \((.+):(\d+):(\d+)\)\s*$/.exec(
      line,
    );
    const bare =
      withName === null
        ? /^\s*at (?:async )?(.+):(\d+):(\d+)\s*$/.exec(line)
        : null;
    const file = withName?.[2] ?? bare?.[1];
    const lineNo = Number(withName?.[3] ?? bare?.[2]);
    const column = Number(withName?.[4] ?? bare?.[3]);
    if (file === undefined || !Number.isInteger(lineNo) || lineNo < 1) continue;
    if (!Number.isInteger(column) || column < 1) continue;
    const named = withName?.[1]?.trim();
    sites.push({
      function: named !== undefined && named !== "" ? named : null,
      file,
      line: lineNo,
      column,
    });
  }
  return sites;
}

function filePathOf(file: string): string | null {
  if (file.startsWith("file://")) {
    try {
      return fileURLToPath(file);
    } catch {
      return null;
    }
  }
  if (isAbsolute(file)) return file;
  return null;
}

// stack의 file URL이 당시 bundle 사본 안이면 상대 path와 함수를 앱 frame으로 쓴다.
async function framesInsideBundle(
  copy: string,
  stack: string,
): Promise<StackFrame[] | null> {
  let info: Stats;
  try {
    info = await stat(copy);
  } catch {
    return null;
  }
  if (!info.isDirectory()) return null;
  const root = copy.endsWith("/") ? copy : `${copy}/`;
  const frames: StackFrame[] = [];
  const sites = stackSites(stack);
  for (const site of sites) {
    const path = filePathOf(site.file);
    if (path === null || !path.startsWith(root)) continue;
    const relative = relativeToFolder(path.slice(root.length));
    if (relative === null) continue;
    frames.push({
      path: relative,
      function: site.function,
      line: site.line,
      column: site.column,
    });
    if (frames.length >= LIMITS.snapshot_frames) break;
  }
  if (frames.length > 0) return frames;
  // stack이 symlink를 푼 실제 경로를 찍어도 사본에 있는 src 파일만 앱 frame으로 쓴다.
  const recovered: StackFrame[] = [];
  for (const site of sites) {
    const marker = site.file.lastIndexOf("/src/");
    if (marker < 0) continue;
    const named = site.file.slice(marker + 1).split(":")[0] ?? "";
    let relative = await bundledSource(root, named);
    if (relative === null && named.endsWith(".js")) {
      relative = await bundledSource(root, named.slice(0, -3));
    }
    if (relative === null) continue;
    recovered.push({
      path: relative,
      function: site.function,
      line: site.line,
      column: site.column,
    });
    if (recovered.length >= LIMITS.snapshot_frames) break;
  }
  return recovered.length > 0 ? recovered : null;
}

async function bundledSource(
  root: string,
  name: string,
): Promise<string | null> {
  const relative = relativeToFolder(name);
  if (relative === null) return null;
  try {
    const info = await stat(`${root}${relative}`);
    return info.isFile() ? relative : null;
  } catch {
    return null;
  }
}

function relativeToFolder(name: string): string | null {
  if (name.length === 0) return null;
  if (OUTSIDE_SOURCE.test(name)) return null;
  if (name.split("/").some((part) => part === "" || part === "..")) return null;
  return name;
}

// mappings 전체를 풀며 segment마다 생성·원본 위치를 돌려준다. 유한한 총량만 푼다.
function walkAllMappings(
  mappings: string,
  visit: (entry: {
    generatedLine: number;
    generatedColumn: number;
    sourceIndex: number;
    originalLine: number;
    originalColumn: number;
  }) => void,
): Result<true, SourceMapFailure> {
  // mappings 크기 한도는 stack_bytes다: 이 안에서만 푼다.
  if (new TextEncoder().encode(mappings).length > LIMITS.stack_bytes) {
    return err({ code: "unavailable", message: "source map이 limit를 넘는다" });
  }
  const lines = mappings.split(";");
  let sourceIndex = 0;
  let originalLine = 0;
  let originalColumn = 0;
  for (let line = 0; line < lines.length; line++) {
    const segments = lines[line]!.split(",");
    let generatedColumn = 0;
    for (const segment of segments) {
      if (segment.length === 0) continue;
      const decoded = decodeSegment(segment);
      if (!decoded.ok) return decoded;
      generatedColumn += decoded.value[0]!;
      if (decoded.value.length >= 4) {
        sourceIndex += decoded.value[1]!;
        originalLine += decoded.value[2]!;
        originalColumn += decoded.value[3]!;
        visit({
          generatedLine: line + 1,
          generatedColumn,
          sourceIndex,
          originalLine: originalLine + 1,
          originalColumn: originalColumn + 1,
        });
      }
    }
  }
  return ok(true);
}

// segment VLQ fields를 모두 푼다. 필드 수는 segment마다 1·4·5다.
function decodeSegment(segment: string): Result<number[], SourceMapFailure> {
  const fields: number[] = [];
  let position = 0;
  while (position < segment.length) {
    const field = decodeField(segment, position);
    if (!field.ok) return field;
    fields.push(field.value.value);
    position = field.value.next;
  }
  return ok(fields);
}

// base64 VLQ field 하나를 푼다.
function decodeField(
  source: string,
  start: number,
): Result<{ value: number; next: number }, SourceMapFailure> {
  const DIGITS =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = 0;
  let shift = 0;
  let position = start;
  for (;;) {
    if (position >= source.length) {
      return err({ code: "invalid_input", message: "source map VLQ가 끊겼다" });
    }
    const index = DIGITS.indexOf(source[position]!);
    if (index < 0) {
      return err({
        code: "invalid_input",
        message: "source map VLQ 문자가 아니다",
      });
    }
    position += 1;
    result += (index & 31) * 2 ** shift;
    if ((index & 32) === 0) {
      const negative = (result & 1) === 1;
      const magnitude = Math.floor(result / 2);
      if (magnitude > 2 ** 31) {
        return err({
          code: "invalid_input",
          message: "source map VLQ 값이 크다",
        });
      }
      return ok({ value: negative ? -magnitude : magnitude, next: position });
    }
    shift += 5;
    if (shift > 50) {
      return err({ code: "invalid_input", message: "source map VLQ가 길다" });
    }
  }
}
