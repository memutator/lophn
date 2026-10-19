// exception snapshot 조립.
// raw 문자는 인증된 observer → collector bounded memory에만 있다. 이 조립은
// stack blob 준비 → source map 위치 찾기 → 묶는 key까지를 bounded memory에서 끝내고
// permanent content는 hash뿐이다.
import { err, ok, type Result, sha256Hex } from "../../../base/mod.ts";
import { appBundleCopy } from "../../../protocol/apps/mod.ts";
import type {
  ProblemGroupKey,
  ProblemSnapshotInput,
  SourceFrame,
} from "../../../protocol/problems/mod.ts";
import { type AppLogSource, collectLogEvidence } from "./logs.ts";
import {
  bytesStream,
  type PreparedSnapshotBlob,
  type SnapshotBlobPrepare,
} from "./prepare.ts";
import {
  readBundleManifest,
  readSourceMap,
  type SourceMapFailure,
} from "./source-map.ts";

export type { PreparedSnapshotBlob, SnapshotBlobPrepare };

// contracts REPORTING_LIMITS의 값이다(sdk-report.ts). problems는 platform을
// import하지 않으므로 이 leaf가 상수만 반복한다.
const LIMITS = {
  snapshot_assembly_ms: 2_000,
  snapshot_frames: 32,
  snapshot_large_bytes: 2_359_296,
  log_lines: 30,
  log_bytes: 65_536,
  stack_bytes: 16_384,
} as const;

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

// 당시 release의 읽기 전용 준비 폴더 출처. data root의 apps 부분만 받는다.
type PreparedFolderSource = {
  // `apps` 부모 폴더(abs path). collector 등록 spec의 allow_read와 같다.
  appsRoot: string | null;
};

// stack을 잘라 준비 바이트로 만든다. redaction 대체 문자는 그대로 보존한다.
function stackBytesOf(stack: string, limit: number): {
  bytes: Uint8Array;
  truncated: boolean;
  excludedFrom: number | null;
} {
  const total = new TextEncoder().encode(stack);
  if (total.length <= limit) {
    return { bytes: total, truncated: false, excludedFrom: null };
  }
  // 잘린 경계에서 UTF-8 문자를 자르지 않는다: 마지막 문자를 통째로 뺀다.
  let end = limit;
  while (end > 0 && (total[end - 1]! & 0xc0) === 0x80) end -= 1;
  if (end > 0 && (total[end - 1]! & 0x80) === 0x80 && end < limit) {
    // 시작 바이트를 남겼다: 그 문자를 통째로 뺀다.
    end -= 1;
    while (end > 0 && (total[end - 1]! & 0xc0) === 0x80) end -= 1;
    if (end > 0) end -= 1;
  }
  return {
    bytes: total.slice(0, end),
    truncated: true,
    excludedFrom: end,
  };
}

// prepared 출처의 앱 frame 위치 찾기. 화면 source map으로 stack의
// 생성 위치를 원본 상대 path·줄로 찾는다. 준비 폴더 밖 path는 읽지 않는다.
async function resolveStackFrames(
  folder: PreparedFolderSource,
  evidence: {
    app: string;
    bundle_hash: string | null;
    // raw TS/TSX stack 원문. caller가 redaction을 통과시킨 값이다.
    stack: string | null;
  },
): Promise<SourceFrame[]> {
  if (evidence.stack === null) {
    return [];
  }
  if (folder.appsRoot === null || evidence.bundle_hash === null) {
    return [];
  }
  const copy = bundleCopyPath(
    folder.appsRoot,
    evidence.app,
    evidence.bundle_hash,
  );
  if (!copy.ok) {
    return [];
  }
  // 화면 JS를 가리킨 stack은 그 화면의 map으로 앱 source 위치를 푼다. 사본 안 화면 JS의
  // 생성 위치를 그대로 frame으로 두면 앱 source를 잇지 못하므로 framesInsideBundle보다 먼저 한다.
  const manifest = await readBundleManifest(copy.value);
  const mapped = manifest.ok
    ? await frameFromScreenMap(copy.value, evidence.stack)
    : null;
  if (mapped !== null) {
    return [mapped];
  }
  // 준비 폴더 안 TS stack은 이미 원본 상대 path·함수다. source map을 거치지 않는다.
  return await framesInsideBundle(copy.value, evidence.stack) ?? [];
}

// 화면 JS 파일(`/screens/<key>/main.js`). stack file은 URL이든 path든 이 꼴로 끝난다.
const SCREEN_FILE = /\/screens\/([^/]+)\/main\.js$/;

// stack에서 화면 JS를 가리킨 첫 site를 그 화면의 source map으로 앱 source 위치로 푼다.
// 같은 줄에서 대상 열 이하 가장 큰 표지 하나만 취한다. stack 열은 1-based, map 열은 0-based다.
async function frameFromScreenMap(
  copy: string,
  stack: string,
): Promise<SourceFrame | null> {
  const site = stackSites(stack).find((candidate) =>
    SCREEN_FILE.test(candidate.file)
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
  // sources를 준비 폴더 안 상대 path로 좁힌다.
  const path = relativeToFolder(found.source);
  if (path === null || found.line < 1 || found.column < 1) return null;
  return {
    path,
    function: site.function,
    line: found.line,
    column: found.column,
  };
}

// 준비 폴더 밖 소스 이름 판정. webpack:/~ / file: / absolute 모양은
// 준비 폴더 안 상대 path가 아니다.
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
    const withName = /^\s*at (?:async )?(.+?) \((.+):(\d+):(\d+)\)\s*$/
      .exec(line);
    const bare = withName === null
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
      return decodeURIComponent(new URL(file).pathname);
    } catch {
      return null;
    }
  }
  if (file.startsWith("/")) return file;
  return null;
}

// stack의 file URL이 당시 bundle 사본 안이면 상대 path와 함수를 앱 frame으로 쓴다.
async function framesInsideBundle(
  copy: string,
  stack: string,
): Promise<SourceFrame[] | null> {
  let info: Deno.FileInfo;
  try {
    info = await Deno.stat(copy);
  } catch {
    return null;
  }
  if (!info.isDirectory) return null;
  const root = copy.endsWith("/") ? copy : `${copy}/`;
  const frames: SourceFrame[] = [];
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
  // Deno가 캐시 경로를 찍어도 사본에 있는 src 파일만 앱 frame으로 쓴다.
  const recovered: SourceFrame[] = [];
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
    const info = await Deno.stat(`${root}${relative}`);
    return info.isFile ? relative : null;
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
function decodeSegment(
  segment: string,
): Result<number[], SourceMapFailure> {
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

// 조립 경계. 관측한 오류 → stack 준비·위치 찾기·로그·묶는 key.
// raw 문자는 bounded memory에서만 있고 결과는 ProblemSnapshotInput(+묶는 key)이다.
type AssemblyDeps = {
  // raw stack blob 준비. platform blob prepare 경계로 간다.
  blobPrepare: SnapshotBlobPrepare;
  // 당시 release의 읽기 전용 준비 폴더 출처.
  folder: PreparedFolderSource;
  // 접수 시각 원문(UTC ISO). 수집 시각은 별도로 둔다.
  nowAt: string;
  // principal은 report 원주체와 같아야 한다(registerBlobs의 원주체 검사).
  principal: string;
  // 조립 기한 재는 단조 시계. 기본은 Date.now다(테스트가 시계를 준다).
  monotonicNow?: () => number;
  // 로그 증거 수집. 없으면 source가 연결되지 않은 것이다.
  logs?: {
    // 진단 상세 수집 설정. 꺼져 있으면 새 로그를 모으지 않는다.
    // null은 설정을 읽지 못한 것이다.
    detailCollection: boolean | null;
    source: AppLogSource | null;
    redact: (text: string) => Promise<string | null>;
  };
};

// redaction을 거친 관측. error가 null이면 오류 정보 없이 관측만 한 것이다(process_exit 등).
type ObservedException = {
  report_id: string;
  observed_at: string;
  observation: string;
  error: {
    name: string;
    message: string | null;
    stack: string | null;
  } | null;
  invocation: ProblemSnapshotInput["invocation"];
};

type AssembledException = {
  // 문제 이름이자 error.name이다. 오류 이름이 없으면 관측 종류다.
  name: string;
  snapshot: ProblemSnapshotInput;
  group_key: ProblemGroupKey;
  // stack blob 준비 결과(blob prepared 출처 바인딩). 실패·stack 없음이면 null이다.
  stack_prepared: PreparedSnapshotBlob | null;
  // 로그 조각 blob 준비 결과. 접수할 때 snapshot_logs blob으로 함께 등록한다.
  logs_prepared: PreparedSnapshotBlob | null;
};

// 문제 이름 규칙(1~120자, 공백 아닌 글자, 제어 문자 없음)에 맞춘다. 맞출 수 없으면 fallback이다.
export function problemNameOf(raw: string | null, fallback: string): string {
  const clean = (raw ?? "").replace(/\p{Cc}/gu, " ").trim();
  let cut = clean.slice(0, 120);
  if (/[\ud800-\udbff]$/.test(cut)) cut = cut.slice(0, -1);
  return /\S/.test(cut) ? cut.trim() : fallback;
}

// 처리되지 않은 오류의 묶는 key. 오류 이름과 앱 source 위치(source map으로 푼 가장 위 앱 frame의
// `path:line`)의 해시다. 위치를 못 풀면(앱 process 종료, view 오류) 관측 종류·오류 이름·메시지·
// bundle hash의 해시라 같은 release에서 같은 이유로 거듭 나는 오류가 한 문제로 묶인다.
// 앱은 문제가 `(app, group_key)`로 찾아 key에 넣지 않는다.
async function observedErrorGroupKey(
  input: ObservedException,
  name: string,
  frames: readonly SourceFrame[],
  bundleHash: string | null,
): Promise<ProblemGroupKey> {
  const top = frames.find((frame) => frame.line !== null);
  return {
    kind: "exception",
    discriminator: await sha256Hex(
      top === undefined
        ? [
          input.observation,
          name,
          input.error?.message ?? "",
          bundleHash ?? "",
        ]
          .join("\n")
        : `${name}\n${top.path}:${top.line}`,
    ),
  };
}

// 관측에서 snapshot과 묶는 key를 조립한다. raw 문자는 결과에 남지 않는다.
export async function assembleException(
  input: ObservedException,
  evidence: {
    app: string;
    bundle_hash: string | null;
  },
  deps: AssemblyDeps,
): Promise<Result<AssembledException>> {
  const monotonicNow = deps.monotonicNow ?? (() => Date.now());
  const startedMs = monotonicNow();
  const rawError = input.error;
  const name = problemNameOf(rawError?.name ?? null, input.observation);
  const collectLogs = (stackBytes: number) =>
    collectLogEvidence(
      // app은 credential에서 온 값이다. 로그 내용이나 observation이 바꾸지 못한다.
      { app: evidence.app, invocation: input.invocation?.id ?? null },
      {
        detailCollection: deps.logs === undefined
          ? true
          : deps.logs.detailCollection,
        source: deps.logs?.source ?? null,
        redact: deps.logs?.redact ?? (() => Promise.resolve(null)),
        blobPrepare: deps.blobPrepare,
        principal: deps.principal,
        nowAt: deps.nowAt,
        // 전체 조립 기한은 2,000ms다. 로그는 남은 시간만 쓴다.
        remainingMs: LIMITS.snapshot_assembly_ms -
          (monotonicNow() - startedMs),
        remainingLargeBytes: LIMITS.snapshot_large_bytes - stackBytes,
      },
    );
  const snapshotId = `snp_${input.report_id.slice("rpt_".length)}`;
  if (rawError === null) {
    const collected = await collectLogs(0);
    return ok({
      name,
      snapshot: {
        id: snapshotId,
        captured_at: deps.nowAt,
        invocation: input.invocation,
        error: null,
        logs: collected.logs,
      },
      group_key: await observedErrorGroupKey(
        input,
        name,
        [],
        evidence.bundle_hash,
      ),
      stack_prepared: null,
      logs_prepared: collected.prepared,
    });
  }
  const stack = rawError.stack;
  const frames = await resolveStackFrames(deps.folder, {
    app: evidence.app,
    bundle_hash: evidence.bundle_hash,
    stack,
  });
  // stack blob 준비. redaction 대체 문자는 그대로 보존하고 크기 한도를 지킨다.
  let stackHash: string | null = null;
  let stackPrepared: AssembledException["stack_prepared"] = null;
  const truncationNotes: string[] = [];
  if (stack !== null) {
    const cut = stackBytesOf(stack, LIMITS.stack_bytes);
    if (cut.truncated && cut.excludedFrom !== null) {
      truncationNotes.push(
        `stack은 최대 ${LIMITS.stack_bytes} bytes만 보존한다; ${cut.excludedFrom} byte 뒤는 제외했다`,
      );
    }
    const prepared = await deps.blobPrepare.prepare(
      {
        principal: deps.principal,
        purpose: "snapshot_stack",
        expectedHash: undefined,
      },
      bytesStream(cut.bytes),
    );
    if (prepared.ok) {
      stackHash = prepared.value.hash;
      stackPrepared = prepared.value;
    } else {
      // blob 저장 실패는 stack 없이 남은 자료로 접수한다.
      truncationNotes.push(
        `stack blob 준비 실패(${prepared.error.message}); stack hash는 남기지 않는다`,
      );
    }
  }
  const collected = await collectLogs(stackPrepared?.size_bytes ?? 0);
  return ok({
    name,
    snapshot: {
      id: snapshotId,
      captured_at: deps.nowAt,
      invocation: input.invocation,
      error: {
        name,
        message: rawError.message,
        frames,
        stack: stackHash,
        truncation_notes: truncationNotes,
      },
      logs: collected.logs,
    },
    group_key: await observedErrorGroupKey(
      input,
      name,
      frames,
      evidence.bundle_hash,
    ),
    stack_prepared: stackPrepared,
    logs_prepared: collected.prepared,
  });
}
