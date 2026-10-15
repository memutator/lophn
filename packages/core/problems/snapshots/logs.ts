// snapshot의 로그 증거 수집. 로그는 apps/runtime의 임시 buffer(redaction이 이미 적용됨)에서
// 최근 줄만 받는다. 이 모듈은 그 줄을 다시 redaction하고(fail-closed), 크기 상한 안에서
// blob으로 준비해 LogEvidence를 낸다. 모을 수 없으면 null이고 이유 칸은 없다.
import type { Result } from "../../../base/mod.ts";
import type { AppLogState } from "../../../protocol/apps/mod.ts";
import {
  type LogEvidence,
  REPORTING_LIMITS,
} from "../../../protocol/problems/mod.ts";
import {
  bytesStream,
  type PreparedSnapshotBlob,
  type SnapshotBlobPrepare,
} from "./prepare.ts";

// apps.logs read와 같은 입력이다. 앱은 credential에서 온 값만 쓴다.
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

// 앱 runtime log buffer를 읽는 통로. 운영 연결(core → supervisor 조회)은 apps가
// 맡으므로 여기서는 contract 모양의 port로만 받는다. null은 연결 없음이다.
export type AppLogSource = (query: AppLogQuery) => Promise<Result<AppLogFeed>>;

export type LogCollectionDeps = {
  // 진단 상세 수집 설정. 꺼져 있으면 새 수집만 멈춘다. null은 설정을 읽지 못한 것이다:
  // 사람이 껐을 수 있으므로 모으지 않는다.
  detailCollection: boolean | null;
  source: AppLogSource | null;
  blobPrepare: SnapshotBlobPrepare;
  principal: string;
  // 통과하지 못하면 null이다. 원문은 통과시키지 않는다(fail-closed).
  redact: (text: string) => Promise<string | null>;
  // 로그를 얻은 시각이 source에 없을 때만 쓴다.
  nowAt: string;
  // 이 항목에 남은 조립 기한과 큰 자료 준비 예산.
  remainingMs: number;
  remainingLargeBytes: number;
};

export type LogCollection = {
  logs: LogEvidence | null;
  prepared: PreparedSnapshotBlob | null;
};

const NONE: LogCollection = { logs: null, prepared: null };

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
// 조각이다. 한 줄 길이의 별도 기본값은 없고 총 bytes로만 제한한다.
export async function collectLogEvidence(
  input: { app: string; invocation: string | null },
  deps: LogCollectionDeps,
): Promise<LogCollection> {
  // 설정을 읽지 못했거나 꺼져 있으면 새 로그를 모으지 않는다.
  if (!deps.detailCollection || deps.source === null) return NONE;
  if (deps.remainingMs <= 0) return NONE;
  const maxBytes = Math.min(
    REPORTING_LIMITS.log_bytes,
    deps.remainingLargeBytes,
  );
  if (maxBytes <= 0) return NONE;
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
    return NONE;
  }
  if (read === undefined) return NONE;
  if (!read.ok) return NONE;
  const feed = read.value;
  if (feed.state === "none") return NONE;
  if (feed.state === "off") return NONE;
  const partial = feed.state === "timeout";
  // source가 약속보다 많이 주어도 최근 줄만 남긴다.
  const recent = feed.lines.slice(-REPORTING_LIMITS.log_lines);
  let truncated = feed.truncated || partial ||
    feed.lines.length > recent.length;
  if (recent.length === 0) return NONE;
  // redaction 앞에서 메모리를 묶고, 뒤에서 다시 묶는다(대체 문자가 길 수 있다).
  const bounded = newestWithin(recent, maxBytes);
  if (bounded.dropped) truncated = true;
  let safeText: string | null;
  try {
    safeText = await deps.redact(bounded.lines.join("\n"));
  } catch {
    safeText = null;
  }
  if (safeText === null || safeText.length === 0) return NONE;
  const safeLines = safeText.split("\n");
  const safe = newestWithin(
    safeLines.slice(-REPORTING_LIMITS.log_lines),
    maxBytes,
  );
  if (safe.dropped || safeLines.length > REPORTING_LIMITS.log_lines) {
    truncated = true;
  }
  if (safe.lines.length === 0) return NONE;
  const prepared = await prepare(deps, safe.lines.join("\n"));
  if (!prepared.ok) return NONE;
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
  return { logs: evidence, prepared: prepared.value };
}

async function prepare(
  deps: LogCollectionDeps,
  text: string,
): Promise<{ ok: true; value: PreparedSnapshotBlob } | { ok: false }> {
  try {
    const prepared = await deps.blobPrepare.prepare(
      {
        principal: deps.principal,
        purpose: "snapshot_logs",
        expectedHash: undefined,
      },
      bytesStream(new TextEncoder().encode(text)),
    );
    // 저장하지 못하면 로그 없이 접수한다. 기존 자료는 지우지 않는다.
    return prepared.ok ? { ok: true, value: prepared.value } : { ok: false };
  } catch {
    return { ok: false };
  }
}
