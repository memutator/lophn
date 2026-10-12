// release 준비 상한(apps/releases#R3, R19). 값은 contracts의 상수 하나다.
// 상한 초과는 부분 bundle을 만들지 않고 실패 이유만 남긴다(R19).
import {
  RELEASE_BUNDLE_MAX_BYTES,
  RELEASE_FILE_MAX_COUNT,
  RELEASE_PREPARATION_LIMIT_MS,
  RELEASE_SOURCE_MAX_BYTES,
} from "../../../protocol/apps/mod.ts";
import { err, ok, type Result } from "../../../base/mod.ts";

export {
  RELEASE_BUNDLE_MAX_BYTES,
  RELEASE_FILE_MAX_COUNT,
  RELEASE_PREPARATION_LIMIT_MS,
  RELEASE_SOURCE_MAX_BYTES,
};

export type LimitName =
  | "source_bytes"
  | "bundle_bytes"
  | "file_count"
  | "elapsed_ms";

export type LimitFailure = {
  code: "limit_exceeded";
  reason: LimitName;
  observed: number;
  limit: number;
};

// 준비 도중의 관측값을 상값 하나로 모은다. 상한은 값 하나당 하나만 담는다.
export type PreparationUsage = {
  source_bytes: number;
  bundle_bytes: number;
  file_count: number;
  elapsed_ms: number;
};

export function exceededLimit(
  usage: PreparationUsage,
): LimitFailure | undefined {
  const limits: [LimitName, number, number][] = [
    ["source_bytes", usage.source_bytes, RELEASE_SOURCE_MAX_BYTES],
    ["bundle_bytes", usage.bundle_bytes, RELEASE_BUNDLE_MAX_BYTES],
    ["file_count", usage.file_count, RELEASE_FILE_MAX_COUNT],
    ["elapsed_ms", usage.elapsed_ms, RELEASE_PREPARATION_LIMIT_MS],
  ];
  for (const [reason, observed, limit] of limits) {
    if (observed > limit) {
      return { code: "limit_exceeded", reason, observed, limit };
    }
  }
  return undefined;
}

// 상한 검사에 통과했으면 준비를 계속한다. 넘겼으면 실패 이유를 남긴다.
export function checkLimits(
  usage: PreparationUsage,
): Result<{ usage: PreparationUsage }, LimitFailure> {
  const exceeded = exceededLimit(usage);
  if (exceeded) return err(exceeded);
  return ok({ usage });
}

export type UsageCounter = {
  usage(): PreparationUsage;
  addSource(bytes: number, files: number): LimitFailure | undefined;
  addBundle(bytes: number, files: number): LimitFailure | undefined;
  elapsed(ms: number): LimitFailure | undefined;
};

// 준비 도중 source·bundle byte와 파일 수를 더한다. 넘는 순간 실패 이유를 남긴다.
export function usageCounter(
  startedAt: number,
  now: () => number,
): UsageCounter {
  const usage: PreparationUsage = {
    source_bytes: 0,
    bundle_bytes: 0,
    file_count: 0,
    elapsed_ms: 0,
  };
  function tick(): LimitFailure | undefined {
    usage.elapsed_ms = now() - startedAt;
    return exceededLimit(usage);
  }
  return {
    usage: () => ({ ...usage }),
    addSource(bytes, files) {
      usage.source_bytes += bytes;
      usage.file_count += files;
      return tick();
    },
    addBundle(bytes, files) {
      usage.bundle_bytes += bytes;
      usage.file_count += files;
      return tick();
    },
    elapsed(ms) {
      usage.elapsed_ms = ms;
      return exceededLimit(usage);
    },
  };
}
