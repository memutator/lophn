// snapshot의 로그 증거 수집(snapshots#R4, R5, R6, R7, R12, R14, R18, R19, R20;
// plan problems T17). 로그는 apps/runtime의 임시 buffer(redaction이 이미 적용됨)에서
// 최근 줄만 받는다. 이 모듈은 그 줄을 다시 redaction하고(fail-closed), 크기 상한 안에서
// blob으로 준비해 순수 값(LogEvidence)이나 공백 아닌 이유 하나를 낸다.
import type { Result } from "../../base/mod.ts";
import type { AppLogState } from "../../contracts/apps/mod.ts";
import {
  type LogEvidence,
  type MissingReason,
  REPORTING_LIMITS,
} from "../../contracts/problems/mod.ts";
import {
  bytesStream,
  type PreparedSnapshotBlob,
  type SnapshotBlobPrepare,
} from "./prepare.ts";

// apps.logs read와 같은 입력이다. 앱은 credential에서 온 값만 쓴다(snapshots#R6).
export type AppLogQuery = {
  app: string;
  invocation?: string;
  limit: number;
  max_bytes: number;
};

export type AppLogFeed = {
  state: AppLogState;
  lines: readonly string[];
  collected_at: string | null;
  truncated: boolean;
};

// 앱 runtime log buffer를 읽는 통로. 운영 연결(core → supervisor 조회)은 apps#T10이
// 맡으므로 여기서는 contract 모양의 port로만 받는다. null은 연결 없음이다.
export type AppLogSource = (query: AppLogQuery) => Promise<Result<AppLogFeed>>;

export type LogCollectionDeps = {
  // 진단 상세 수집 설정이 켜져 있는지. 꺼져 있으면 새 수집만 멈춘다(snapshots#R7).
  detailCollection: boolean;
  source: AppLogSource | null;
  blobPrepare: SnapshotBlobPrepare;
  principal: string;
  // 통과하지 못하면 null이다. 원문은 통과시키지 않는다(fail-closed).
  redact: (text: string) => Promise<string | null>;
  // 로그를 얻은 시각이 source에 없을 때만 쓴다.
  nowAt: string;
  // 이 항목에 남은 조립 기한과 큰 자료 준비 예산(snapshots#R18, R20).
  remainingMs: number;
  remainingLargeBytes: number;
};

export type LogCollection = {
  logs: LogEvidence | null;
  logs_missing_reason: MissingReason | null;
  prepared: PreparedSnapshotBlob | null;
};

const REASONS = {
  off: "진단 상세 수집이 꺼져 있어 새 로그를 모으지 않았다",
  noSource: "앱 로그 source가 연결되지 않아 로그를 모으지 못했다",
  deadline: "조립 기한을 넘어 로그를 모으지 못했다",
  budget: "큰 자료 준비 상한을 넘어 로그 조각을 제외했다",
  unavailable: "앱 로그를 읽지 못했다",
  late: "기한 안에 앱 로그를 받지 못했다",
  redaction: "redaction을 통과하지 못해 로그를 제외했다",
  empty: "수집은 성공했고 범위 안에 로그가 0줄이었다",
  evicted: "앱 log buffer에서 밀려나 해당 invocation의 로그를 얻지 못했다",
  fixed: "크기 상한 때문에 로그 줄을 하나도 담지 못했다",
  storage:
    "로그 조각을 저장하지 못했다: 저장 공간이 부족하거나 저장소를 쓸 수 없어 새 상세 수집을 제한했다. 기존 자료는 지우지 않았다; 내보내기나 보존 한도 조정으로 공간을 확보한다",
  store: "로그 조각 blob 저장에 실패했다",
} as const;

function absent(reason: string): LogCollection {
  return { logs: null, logs_missing_reason: { reason }, prepared: null };
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

// 가장 최근 줄부터 byte 예산 안에 드는 만큼만 남긴다. 줄 사이 줄바꿈도 센다.
function newestWithin(
  lines: readonly string[],
  maxBytes: number,
): { lines: string[]; dropped: boolean } {
  let used = 0;
  let keep = 0;
  for (let index = lines.length - 1; index >= 0; index--) {
    const next = used + byteLength(lines[index]!) + (keep > 0 ? 1 : 0);
    if (next > maxBytes) break;
    used = next;
    keep += 1;
  }
  return {
    lines: lines.slice(lines.length - keep),
    dropped: keep < lines.length,
  };
}

// 시간이 먼저 지나면 undefined다. 쓰지 않은 timer는 거둔다.
async function within<T>(
  work: Promise<T>,
  ms: number,
): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), ms);
  });
  try {
    return await Promise.race([work, late]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function scopeOf(
  invocation: string | undefined,
  count: number,
  partial: boolean,
): string {
  const where = invocation === undefined
    ? "앱 로그 조각(invocation에 묶이지 않은 최근 줄)"
    : `invocation ${invocation}의 최근 로그`;
  return `${where} ${count}줄(최대 ${REPORTING_LIMITS.log_lines}줄·${REPORTING_LIMITS.log_bytes} bytes)${
    partial ? "; 기한 안에 일부만 받았다" : ""
  }`;
}

// 알려진 invocation으로 좁힌 최근 로그 조각을 모은다. 연결 없는 로그는 앱 로그
// 조각이다. 한 줄 길이의 별도 기본값은 없고 총 bytes로만 제한한다(snapshots#R12).
export async function collectLogEvidence(
  input: { app: string; invocation: string | null },
  deps: LogCollectionDeps,
): Promise<LogCollection> {
  if (!deps.detailCollection) return absent(REASONS.off);
  if (deps.source === null) return absent(REASONS.noSource);
  if (deps.remainingMs <= 0) return absent(REASONS.deadline);
  const maxBytes = Math.min(
    REPORTING_LIMITS.log_bytes,
    deps.remainingLargeBytes,
  );
  if (maxBytes <= 0) return absent(REASONS.budget);
  const invocation = input.invocation ?? undefined;
  const query: AppLogQuery = {
    app: input.app,
    ...(invocation === undefined ? {} : { invocation }),
    limit: REPORTING_LIMITS.log_lines,
    max_bytes: maxBytes,
  };
  let read: Result<AppLogFeed> | undefined;
  try {
    read = await within(deps.source(query), deps.remainingMs);
  } catch {
    return absent(REASONS.unavailable);
  }
  if (read === undefined) return absent(REASONS.late);
  if (!read.ok) return absent(REASONS.unavailable);
  const feed = read.value;
  if (feed.state === "none") return absent(REASONS.noSource);
  if (feed.state === "off") return absent(REASONS.off);
  const partial = feed.state === "timeout";
  // source가 약속보다 많이 주어도 최근 줄만 남긴다.
  const recent = feed.lines.slice(-REPORTING_LIMITS.log_lines);
  let truncated = feed.truncated || partial ||
    feed.lines.length > recent.length;
  if (recent.length === 0) {
    if (partial) return absent(REASONS.late);
    return absent(truncated ? REASONS.evicted : REASONS.empty);
  }
  // redaction 앞에서 메모리를 묶고, 뒤에서 다시 묶는다(대체 문자가 길 수 있다).
  const bounded = newestWithin(recent, maxBytes);
  if (bounded.dropped) truncated = true;
  let safeText: string | null;
  try {
    safeText = await deps.redact(bounded.lines.join("\n"));
  } catch {
    safeText = null;
  }
  if (safeText === null || safeText.length === 0) {
    return absent(REASONS.redaction);
  }
  const safeLines = safeText.split("\n");
  const safe = newestWithin(
    safeLines.slice(-REPORTING_LIMITS.log_lines),
    maxBytes,
  );
  if (safe.dropped || safeLines.length > REPORTING_LIMITS.log_lines) {
    truncated = true;
  }
  if (safe.lines.length === 0) return absent(REASONS.fixed);
  const prepared = await prepare(deps, safe.lines.join("\n"));
  if (!prepared.ok) return absent(prepared.reason);
  const evidence: LogEvidence = {
    blob: prepared.value.hash,
    line_count: safe.lines.length,
    truncated,
    scope: scopeOf(invocation, safe.lines.length, partial),
    // source는 줄마다 시각을 주지 않는다. 범위를 추정하지 않는다.
    from_at: null,
    to_at: null,
    collected_at: feed.collected_at ?? deps.nowAt,
  };
  return {
    logs: evidence,
    logs_missing_reason: null,
    prepared: prepared.value,
  };
}

async function prepare(
  deps: LogCollectionDeps,
  text: string,
): Promise<
  { ok: true; value: PreparedSnapshotBlob } | { ok: false; reason: string }
> {
  try {
    const prepared = await deps.blobPrepare.prepare(
      {
        principal: deps.principal,
        purpose: "snapshot_logs",
        expectedHash: undefined,
      },
      bytesStream(new TextEncoder().encode(text)),
    );
    if (prepared.ok) return { ok: true, value: prepared.value };
    // 저장 공간 부족은 새 수집을 제한하되 기존 자료를 지우지 않는다(R19).
    return {
      ok: false,
      reason: prepared.error.code === "unavailable"
        ? REASONS.storage
        : REASONS.store,
    };
  } catch {
    return { ok: false, reason: REASONS.storage };
  }
}
