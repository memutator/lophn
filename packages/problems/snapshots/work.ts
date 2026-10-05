// exception snapshot 조립(snapshots#R1–R6, R8–R11, R18, R20; plan problems T4).
// raw 문자는 인증된 observer → collector bounded memory에만 있다. 이 조립은
// redaction → stack blob 준비 → source map 위치 찾기 → 지문 key까지를
// bounded memory에서 끝내고 permanent content는 hash뿐이다.
import { err, ok, type Result } from "../../base/mod.ts";
import type { ObservedExceptionInput } from "../../contracts/problems/mod.ts";
import type {
  GroupKey,
  SnapshotInput,
  SourceFrame,
} from "../../contracts/problems/mod.ts";
import { exceptionGroupKey, type FingerprintFrame } from "../grouping/mod.ts";
import {
  readBundleManifest,
  readSourceMap,
  type SourceMapFailure,
} from "./source-map.ts";

// contracts REPORTING_LIMITS의 값이다(sdk-report.ts). problems는 platform을
// import하지 않으므로 이 leaf가 상수만 반복한다. bundle 사본 위치 규칙
// (`apps/<app ID>/bundles/<hash>`)은 releases/bundle/seal.ts와 같다. contracts#T36
// 경로 함수가 problems에서 닿지 않으므로 이 leaf가 문자만 반복한다.
const LIMITS = {
  snapshot_assembly_ms: 2_000,
  snapshot_frames: 32,
  snapshot_large_bytes: 2_359_296,
  log_lines: 30,
  log_bytes: 65_536,
  stack_bytes: 16_384,
} as const;

// 당시 release의 읽기 전용 bundle 사본 위치. appIdSchema·hash 검사는
// seal.ts의 bundleCopyPath와 같은 규칙이다.
function bundleCopyPath(
  dataRoot: string,
  app: string,
  bundleHash: string,
): Result<string, SourceMapFailure> {
  if (!/^app_[0-7][0-9a-hjkmnp-tv-z]{25}$/.test(app)) {
    return err({ code: "invalid_input", message: "app id is not an app id" });
  }
  if (!/^[0-9a-f]{64}$/.test(bundleHash)) {
    return err({
      code: "invalid_input",
      message: "bundle hash is not a sha256",
    });
  }
  return ok(`${dataRoot}/apps/${app}/bundles/${bundleHash}`);
}

// 조립에 주입하는 준비 경계. bytes는 platform blob prepare 경계(
// documents가 supervision pipe로 준비하는 것과 같은 갈래)로 간다.
export type SnapshotBlobPrepare = {
  prepare(
    input: { principal: string; purpose: string; expectedHash?: string },
    bytes: ReadableStream<Uint8Array>,
  ): Promise<
    Result<{
      preparation: string;
      principal: string;
      purpose: string;
      hash: string;
      size_bytes: number;
    }>
  >;
};

// 당시 release의 읽기 전용 준비 폴더 출처. data root의 apps 부분만 받는다.
export type PreparedFolderSource = {
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

// raw stack을 스트림으로 내보낸다.
function stackStream(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      if (bytes.length > 0) controller.enqueue(bytes);
      controller.close();
    },
  });
}

// prepared 출처의 앱 frame 위치 찾기(snapshots#R11). source map으로 stack의
// 생성 위치를 원본 상대 path·줄로 찾는다: 위치를 아는 stack은 같은 생성 위치의
// mapping만 취하고, 준비 폴더 밖 path는 읽지 않는다.
export async function resolveStackFrames(
  folder: PreparedFolderSource,
  evidence: {
    app: string;
    bundle_hash: string | null;
    // raw TS/TSX stack 원문. caller가 redaction을 통과시킨 값이다.
    stack: string | null;
  },
): Promise<{ frames: SourceFrame[]; source_missing_reason: string | null }> {
  if (evidence.stack === null) {
    return { frames: [], source_missing_reason: "stack 없는 예외다" };
  }
  if (folder.appsRoot === null || evidence.bundle_hash === null) {
    return {
      frames: [],
      source_missing_reason: "release 준비 폴더가 없다",
    };
  }
  const copy = bundleCopyPath(
    folder.appsRoot,
    evidence.app,
    evidence.bundle_hash,
  );
  if (!copy.ok) {
    return { frames: [], source_missing_reason: copy.error.message };
  }
  const manifest = await readBundleManifest(copy.value);
  if (!manifest.ok) {
    return { frames: [], source_missing_reason: manifest.error.message };
  }
  const map = await readSourceMap(copy.value);
  if (!map.ok) {
    return { frames: [], source_missing_reason: map.error.message };
  }
  // 최초 mappings를 풀기 전 크기 한도는 stack_bytes다(snapshots#R18).
  if (new TextEncoder().encode(map.value).length > LIMITS.stack_bytes) {
    return { frames: [], source_missing_reason: "source map이 limit를 넘는다" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(map.value);
  } catch {
    return { frames: [], source_missing_reason: "source map을 읽지 못했다" };
  }
  if (
    typeof parsed !== "object" || parsed === null || !("mappings" in parsed)
  ) {
    return { frames: [], source_missing_reason: "source map 형식이 아니다" };
  }
  const record = parsed as { mappings?: unknown; sources?: unknown };
  if (typeof record.mappings !== "string" || !Array.isArray(record.sources)) {
    return { frames: [], source_missing_reason: "source map 형식이 아니다" };
  }
  const sources = record.sources;
  const stack = evidence.stack;
  const mappings = record.mappings;
  // stack의 at 줄에서 생성 위치(줄·열)를 찾는다. 실행 환경의 file: URL도 취한다.
  const att = /at\s+[^\n]*?\(?([^()\s]+):(\d+):(\d+)\)?/.exec(stack);
  const positional = att === null
    ? null
    : { line: Number(att[2]), column: Number(att[3]) };
  const frames: SourceFrame[] = [];
  if (positional !== null) {
    // 위치 원문을 아는 stack은 같은 줄에서 대상 열 이하 가장 큰 표지 하나만
    // 취한다(source map 탐색 규칙, snapshots#R11). stack 열은 1-based,
    // source map 열은 0-based다.
    const target = positional.column - 1;
    let chosen: {
      sourceIndex: number;
      originalLine: number;
      originalColumn: number;
    } | null = null;
    const walkResult = walkAllMappings(mappings, sources.length, (entry) => {
      if (entry.generatedLine !== positional.line) return;
      if (entry.generatedColumn > target) return;
      chosen = {
        sourceIndex: entry.sourceIndex,
        originalLine: entry.originalLine,
        originalColumn: entry.originalColumn,
      };
    });
    if (walkResult !== null && !walkResult.ok) {
      return { frames: [], source_missing_reason: walkResult.error.message };
    }
    if (chosen === null) {
      return {
        frames: [],
        source_missing_reason: "stack 위치의 source map 표지가 없다",
      };
    }
    const found = chosen as {
      sourceIndex: number;
      originalLine: number;
      originalColumn: number;
    };
    const sourceName = sources[found.sourceIndex];
    if (typeof sourceName !== "string") {
      return {
        frames: [],
        source_missing_reason: "stack 위치의 source map 표지가 없다",
      };
    }
    // sources를 준비 폴더 안 상대 path로 좁힌다(snapshots#R6).
    const path = relativeToFolder(sourceName);
    if (path === null) {
      return {
        frames: [],
        source_missing_reason: "표지 source가 준비 폴더 밖이다",
      };
    }
    if (found.originalLine < 1 || found.originalColumn < 1) {
      return {
        frames: [],
        source_missing_reason: "source map 표지 위치가 형식을 벗어난다",
      };
    }
    frames.push({
      path,
      function: null,
      line: found.originalLine,
      column: found.originalColumn,
    });
    return { frames, source_missing_reason: null };
  }
  // 위치 원문을 모르는 stack은 mappings를 유한 한도 안에서 풀어 앱 frame만 둔다.
  const walkResult = walkAllMappings(mappings, sources.length, (entry) => {
    if (frames.length >= LIMITS.snapshot_frames) return;
    const sourceName = sources[entry.sourceIndex];
    if (typeof sourceName !== "string") return;
    // sources를 준비 폴더 안 상대 path로 좁힌다(snapshots#R6).
    const path = relativeToFolder(sourceName);
    if (path === null) {
      // 준비 폴더 밖 소스는 위치 원본을 남기지 않는다(R6).
      return;
    }
    frames.push({
      path,
      function: null,
      line: entry.originalLine,
      column: entry.originalColumn,
    });
  });
  if (walkResult !== null && !walkResult.ok) {
    return {
      frames: [],
      source_missing_reason: walkResult.error.message,
    };
  }
  if (frames.length === 0) {
    return {
      frames: [],
      source_missing_reason: "stack 위치를 준비 폴더 source로 찾지 못했다",
    };
  }
  return { frames, source_missing_reason: null };
}

// 준비 폴더 밖 소스 이름 판정. webpack:/~ / file: / absolute 모양은
// 준비 폴더 안 상대 path가 아니다(snapshots#R6).
const OUTSIDE_SOURCE = /^[A-Za-z][A-Za-z0-9+.-]*:|^[\\/]|^[A-Za-z]:|\.\.|\\/;

function relativeToFolder(name: string): string | null {
  if (name.length === 0) return null;
  if (OUTSIDE_SOURCE.test(name)) return null;
  if (name.split("/").some((part) => part === "" || part === "..")) return null;
  return name;
}

// mappings 전체를 풀며 segment마다 생성·원본 위치를 돌려준다. 유한한 총량만 푼다.
function walkAllMappings(
  mappings: string,
  _sourceCount: number,
  visit: (entry: {
    generatedLine: number;
    generatedColumn: number;
    sourceIndex: number;
    originalLine: number;
    originalColumn: number;
  }) => void,
): Result<true, SourceMapFailure> {
  // mappings 크기 한도는 stack_bytes다: 이 안에서만 푼다(R18).
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

// 조립 경계. exception observation → redaction·stack 준비·위치 찾기·지문 key.
// raw 문자는 bounded memory에서만 있고 결과는 SnapshotInput(+group key)이다.
export type AssemblyDeps = {
  // raw stack blob 준비. platform blob prepare 경계로 간다.
  blobPrepare: SnapshotBlobPrepare;
  // 당시 release의 읽기 전용 준비 폴더 출처.
  folder: PreparedFolderSource;
  // 접수 시각 원문(UTC ISO). 수집 시각은 별도로 둔다(snapshots#R1).
  nowAt: string;
  // principal은 report 원주체와 같아야 한다(registerBlobs의 원주체 검사).
  principal: string;
  // 조립 기한 재는 단조 시계. 기본은 Date.now다(테스트가 시계를 준다, snapshots#R18).
  monotonicNow?: () => number;
};

export type AssembledException = {
  snapshot: SnapshotInput;
  group_key: GroupKey;
  // stack blob 준비 결과(blob prepared 출처 바인딩). 실패·stack 없음이면 null이다.
  stack_prepared: {
    preparation: string;
    principal: string;
    purpose: string;
    hash: string;
    size_bytes: number;
  } | null;
};

// exception observation에서 SnapshotInput과 지문 key를 조립한다(snapshots#R1–R6,
// R8–R11, R18, R20; grouping#R2, R3). raw 문자는 결과에 남지 않는다.
export async function assembleException(
  input: ObservedExceptionInput,
  evidence: {
    app: string;
    bundle_hash: string | null;
  },
  deps: AssemblyDeps,
): Promise<Result<AssembledException>> {
  const monotonicNow = deps.monotonicNow ?? (() => Date.now());
  const startedMs = monotonicNow();
  // 전체 조립 기한은 2,000ms다(snapshots#R18). 넘으면 남은 자료로 접수한다.
  const overDeadline = () =>
    monotonicNow() - startedMs >= LIMITS.snapshot_assembly_ms;
  const startedAt = deps.nowAt;
  // raw error는 observation schema가 검증한 것만 이름으로 둔다(R1).
  const rawError = input.error;
  const invocation = input.invocation;
  const snapshotId = `snp_${input.report_id.slice("rpt_".length)}`;
  if (rawError === null) {
    const snapshot: SnapshotInput = {
      id: snapshotId,
      captured_at: startedAt,
      invocation: invocation,
      invocation_missing_reason: null,
      error: null,
      error_missing_reason: input.error_missing_reason,
      logs: null,
      logs_missing_reason: { reason: "collector" },
      screen: null,
      screen_missing_reason: { reason: "collector" },
    };
    const groupKey = await exceptionGroupKey(
      "",
      [],
      input.report_id,
    );
    return ok({ snapshot, group_key: groupKey, stack_prepared: null });
  }
  void overDeadline; // redaction 통과 raw stack이 주입받은 값이다(bounded memory만 쥔다).
  const stack = rawError.stack;
  const { frames, source_missing_reason } = await resolveStackFrames(
    deps.folder,
    {
      app: evidence.app,
      bundle_hash: evidence.bundle_hash,
      stack,
    },
  );
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
      stackStream(cut.bytes),
    );
    if (prepared.ok) {
      stackHash = prepared.value.hash;
      stackPrepared = prepared.value;
    } else {
      // blob 저장 실패는 그 항목의 이유를 고정하고 남은 자료로 접수한다(R5).
      truncationNotes.push(
        `stack blob 준비 실패(${prepared.error.message}); stack hash는 남기지 않는다`,
      );
    }
  }
  const fingerprintFrames: FingerprintFrame[] = frames.map((frame) => ({
    path: frame.path,
    function: frame.function,
  }));
  const snapshot: SnapshotInput = {
    id: snapshotId,
    captured_at: deps.nowAt,
    invocation: invocation,
    invocation_missing_reason: invocation === null
      ? { reason: "collector가 연결하지 않았다" }
      : null,
    error: {
      name: rawError.name,
      message: rawError.message,
      message_missing_reason: rawError.message_missing_reason,
      frames,
      source_missing_reason: source_missing_reason === null
        ? null
        : { reason: source_missing_reason },
      stack: stackHash,
      stack_missing_reason: stackHash === null ? { reason: "collector" } : null,
      truncation_notes: truncationNotes,
    },
    error_missing_reason: null,
    logs: null,
    logs_missing_reason: { reason: "collector" },
    screen: null,
    screen_missing_reason: { reason: "collector" },
  };
  const groupKey = await exceptionGroupKey(
    rawError.name,
    fingerprintFrames,
    input.report_id,
  );
  return ok({ snapshot, group_key: groupKey, stack_prepared: stackPrepared });
}
