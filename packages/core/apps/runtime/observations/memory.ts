// 앱 자식의 메모리 표본. Linux는 현재 자식 신원을 대조한 /proc/<pid>/status의
// VmRSS를 60000ms마다 비동기로 읽는다. 다른 OS와 읽기 실패는 측정하지 않은 것이고
// 0으로 채우지 않는다. 설정한 RSS 한도의 85% 초과가 10분 지속될 때만
// 수치와 기간을 관측으로 남긴다. V8 heap 설정은 RSS 한도가 아니므로
// 한도로 읽지 않는다. 한도는 호출자가 RSS 한도로 설정한 값만 받는다.
import { readFile } from "node:fs/promises";
import process from "node:process";

const MEMORY_SAMPLE_INTERVAL_MS = 60_000;
const MEMORY_OVERRUN_WINDOW_MS = 600_000;
const MEMORY_OVERRUN_RATIO = 0.85;

// 현재 자식 신원. supervisor launch가 채우고 종료 확인 때 거둔다.
type MemoryChild = {
  pid: number;
  processNonce: string;
  release: string;
};

type MemorySample = {
  app: string;
  child: MemoryChild;
  rss_bytes: number;
  observed_at: string;
};

type MemoryOverrun = {
  app: string;
  release: string;
  process_nonce: string;
  rss_bytes: number;
  limit_bytes: number;
  since: string;
  duration_ms: number;
};

// startTicks는 같은 pid가 다른 프로세스로 재사용됐는지 가르는 값이다.
type RssReading = { rssBytes: number; startTicks: string };
// 측정하지 못했으면 undefined다. 비동기로 읽는다.
export type RssReader = (pid: number) => Promise<RssReading | undefined>;

// /proc/<pid>/stat에서 starttime(22번째 field)을 꺼낸다. comm이 공백·괄호를 가질 수
// 있어 마지막 ')' 뒤부터 센다.
function startTicksOf(stat: string): string | undefined {
  const close = stat.lastIndexOf(")");
  if (close < 0) return undefined;
  const fields = stat
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  // ')' 뒤 첫 field가 state(3번째)이므로 22번째는 인덱스 19다.
  const ticks = fields[19];
  return ticks !== undefined && /^\d+$/.test(ticks) ? ticks : undefined;
}

function rssKbOf(status: string): number | undefined {
  const line = status.split("\n").find((entry) => entry.startsWith("VmRSS:"));
  if (line === undefined) return undefined;
  const kb = Number(line.split(/\s+/).filter((field) => field !== "")[1]);
  return Number.isFinite(kb) && kb >= 0 ? kb : undefined;
}

// Linux만 측정한다. 다른 OS는 reader가 없고 호출자는 표본이 없는 것으로 다룬다.
export function procRssReader(
  os: string = process.platform,
  root = "/proc",
): RssReader | undefined {
  if (os !== "linux") return undefined;
  return async (pid) => {
    try {
      const status = await readFile(`${root}/${pid}/status`, "utf8");
      const stat = await readFile(`${root}/${pid}/stat`, "utf8");
      const kb = rssKbOf(status);
      const startTicks = startTicksOf(stat);
      if (kb === undefined || startTicks === undefined) return undefined;
      return { rssBytes: kb * 1024, startTicks };
    } catch {
      return undefined;
    }
  };
}

type MemoryDeps = {
  app: string;
  // 설정한 RSS 한도. 없으면 85% 판정을 하지 않는다.
  limitBytes?: number;
  intervalMs?: number;
  nowMs: () => number;
  // 없으면 측정하지 않는다.
  read?: RssReader;
  // 지속 관측을 남긴다.
  onOverrun?: (overrun: MemoryOverrun) => void;
  // 반복 실행. 돌려주는 함수가 취소다. 기본은 setInterval이다.
  schedule?: (run: () => void, ms: number) => () => void;
};

export type MemoryObserver = {
  setChild(child: MemoryChild | null): void;
  // 지금 한 번 측정한다. 측정하지 못했으면 undefined다.
  sample(): Promise<MemorySample | undefined>;
  // 설정한 간격마다 표본을 읽는다.
  start(): void;
  stop(): void;
  // 85% 초과가 지금 이어지는 중인지(10분 전이라도). 끊기면 false다.
  readonly overrunning: boolean;
};

export function createMemoryObserver(deps: MemoryDeps): MemoryObserver {
  const interval = deps.intervalMs ?? MEMORY_SAMPLE_INTERVAL_MS;
  let child: MemoryChild | undefined;
  let startTicks: string | undefined;
  let since: number | undefined;
  let reported = false;
  let cancel: (() => void) | undefined;

  function breakRun(): void {
    since = undefined;
    reported = false;
  }

  function judge(sample: MemorySample): void {
    const limit = deps.limitBytes;
    if (limit === undefined || limit <= 0) return breakRun();
    if (sample.rss_bytes <= limit * MEMORY_OVERRUN_RATIO) return breakRun();
    const now = deps.nowMs();
    since ??= now;
    if (!reported && now - since >= MEMORY_OVERRUN_WINDOW_MS) {
      reported = true;
      deps.onOverrun?.({
        app: deps.app,
        release: sample.child.release,
        process_nonce: sample.child.processNonce,
        rss_bytes: sample.rss_bytes,
        limit_bytes: limit,
        since: new Date(since).toISOString(),
        duration_ms: now - since,
      });
    }
  }

  const observer: MemoryObserver = {
    setChild(next) {
      child = next ?? undefined;
      startTicks = undefined;
      breakRun();
    },
    async sample() {
      const current = child;
      if (current === undefined || deps.read === undefined) {
        breakRun();
        return undefined;
      }
      const reading = await deps.read(current.pid);
      // 읽는 사이 자식이 바뀌었으면 이 값은 현재 자식의 것이 아니다.
      if (child !== current) return undefined;
      if (reading === undefined) {
        // 표본 누락은 지속을 끊는다.
        breakRun();
        return undefined;
      }
      if (startTicks === undefined) startTicks = reading.startTicks;
      else if (startTicks !== reading.startTicks) {
        // 같은 pid의 다른 프로세스다. PID만으로 자식을 판정하지 않는다.
        breakRun();
        return undefined;
      }
      const sample: MemorySample = {
        app: deps.app,
        child: current,
        rss_bytes: reading.rssBytes,
        observed_at: new Date(deps.nowMs()).toISOString(),
      };
      judge(sample);
      return sample;
    },
    start() {
      if (cancel !== undefined) return;
      const run = () => void observer.sample();
      if (deps.schedule) {
        cancel = deps.schedule(run, interval);
      } else {
        const id = setInterval(run, interval);
        cancel = () => clearInterval(id);
      }
    },
    stop() {
      cancel?.();
      cancel = undefined;
    },
    get overrunning() {
      return since !== undefined;
    },
  };
  return observer;
}
