// 메모리 표본. Linux의 /proc/<pid>/status VmRSS를 60000ms마다 비동기로 읽는다
// (R25). 다른 OS는 측정하지 않고 미측정 값을 0으로 채우지 않는다(R25, R29).
// 설정 한도의 85% 초과가 10분 지속될 때만 관측으로 남긴다(R29).

export const MEMORY_SAMPLE_INTERVAL_MS = 60_000;
export const MEMORY_PERSIST_WINDOW_MS = 600_000;
// 실제 RSS가 한도의 85%를 넘는 상태가 지속될 때의 관측 기준이다(R29).
export const MEMORY_LIMIT_RATIO = 0.85;

// 현재 자식 신원. supervisor launch가 채우고 종료 확인 때 비운다.
export type MemoryChild = {
  pid: number;
  processNonce: string;
  release: string;
};

export type MemorySample = {
  app: string;
  child: MemoryChild;
  rss_bytes: number;
  observed_at: string;
};

export type MemoryOverrun = {
  app: string;
  release: string;
  rss_bytes: number;
  limit_bytes: number;
  since: string;
  duration_ms: number;
};

// 다른 OS와 읽기 실패는 측정되지 않음이다. 0으로 채우지 않는다(R25).
export type RssReader = (pid: number) => number | undefined;

export type MemoryDeps = {
  app: string;
  // 설정한 메모리 한도. 없으면 85% 판정도 하지 않는다(R29).
  limitBytes?: number;
  intervalMs?: number;
  now: () => number;
  // VmRSS 리더. 주입하지 않으면 표본이 없다(R25).
  read?: RssReader;
};

export type MemoryObserver = {
  // 현재 자식을 바꾼다. null이면 관측을 멈춘다(단절).
  setChild(child: MemoryChild | null): void;
  // 설정한 간격마다 표본을 읽는다. 리더가 값을 주지 않으면 지속 판정이 끊긴다(R29).
  sample(): MemorySample | undefined;
  sampleOnce(): MemorySample | undefined;
  // 85% 초과 지속 관측. 지속이 끊기면 undefined다(R29).
  overrun(): MemoryOverrun | undefined;
  // 지속 판정이 실제로 진행 중인지. 한도 없음·표본 누락·자식 없음은 false다(R29).
  readonly overrunActive: boolean;
  // Deno heap 옵션은 RSS 제한이 아니다(R25). heap 설정값을 그대로 돌려준다.
  readonly heapLimitBytes: number | undefined;
};

// Linux /proc/<pid>/status의 VmRSS 줄을 kB 단위로 읽는다. 읽기 실패는 없음이다.
// 이 리더는 sync file read를 쓴다. core graph의 임포트가 아니므로 supervisor
// 프로세스에서만 조립한다(responsiveness#R1).
export function procRssReader(statusPath: (pid: number) => string): RssReader {
  return (pid) => {
    let text: string;
    try {
      text = new TextDecoder().decode(Deno.readFileSync(statusPath(pid)));
    } catch {
      return undefined;
    }
    const line = text.split("\n").find((entry) => entry.startsWith("VmRSS:"));
    if (!line) return undefined;
    const fields = line.split(/\s+/).filter((field) => field !== "");
    const kb = Number(fields[1]);
    if (!Number.isFinite(kb) || kb < 0) return undefined;
    return kb * 1024;
  };
}

export function createMemoryObserver(deps: MemoryDeps): MemoryObserver {
  let child: MemoryChild | undefined;
  const reader = deps.read;
  let overrunStartedMs: number | undefined;

  const observer: MemoryObserver = {
    setChild(next) {
      child = next ?? undefined;
      // 자식이 바뀌면 지속 판정도 새 자식 기준이다. 표본 누락과 같다(R29).
      overrunStartedMs = undefined;
    },
    sample() {
      return observer.sampleOnce();
    },
    sampleOnce() {
      // 자식이 없거나 리더가 주지 않으면 표본이 없다(R25).
      if (!child || !reader) {
        overrunStartedMs = undefined;
        return undefined;
      }
      const rss = reader(child.pid);
      if (rss === undefined) {
        // 표본 누락은 지속을 끊는다(R29).
        overrunStartedMs = undefined;
        return undefined;
      }
      return {
        app: deps.app,
        child,
        rss_bytes: rss,
        observed_at: new Date(deps.now()).toISOString(),
      };
    },
    overrun() {
      const sample = observer.sampleOnce();
      if (!sample) return undefined;
      const limit = deps.limitBytes;
      if (limit === undefined) {
        overrunStartedMs = undefined;
        return undefined;
      }
      const threshold = limit * MEMORY_LIMIT_RATIO;
      if (sample.rss_bytes <= threshold) {
        overrunStartedMs = undefined;
        return undefined;
      }
      if (overrunStartedMs === undefined) {
        overrunStartedMs = deps.now();
        return undefined;
      }
      const duration = deps.now() - overrunStartedMs;
      if (duration < MEMORY_PERSIST_WINDOW_MS) return undefined;
      return {
        app: deps.app,
        release: sample.child.release,
        rss_bytes: sample.rss_bytes,
        limit_bytes: limit,
        since: new Date(overrunStartedMs).toISOString(),
        duration_ms: duration,
      };
    },
    get overrunActive() {
      return overrunStartedMs !== undefined;
    },
    get heapLimitBytes() {
      // V8 heap 설정은 전체 RSS 제한이 아니다(R25). 값을 그대로 노출한다.
      return deps.limitBytes;
    },
  };

  return observer;
}
