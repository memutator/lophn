export type Clock = {
  now(): string;
  nowMs(): number;
};

// 기록 시각은 이 형식만 쓴다(domain-model platform/ledger "시각·기간·seq").
const AT = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;

function pad(n: number, width: number): string {
  return n.toString().padStart(width, "0");
}

export function formatAt(ms: number): string {
  const d = new Date(ms);
  const at = `${pad(d.getUTCFullYear(), 4)}-${pad(d.getUTCMonth() + 1, 2)}-${
    pad(d.getUTCDate(), 2)
  }T${pad(d.getUTCHours(), 2)}:${pad(d.getUTCMinutes(), 2)}:${
    pad(d.getUTCSeconds(), 2)
  }.${pad(d.getUTCMilliseconds(), 3)}Z`;
  if (!AT.test(at)) {
    throw new Error("clock instant is outside YYYY-MM-DDTHH:mm:ss.sssZ");
  }
  return at;
}

export const systemClock: Clock = {
  nowMs: () => Date.now(),
  now() {
    return formatAt(this.nowMs());
  },
};

export type ManualClock = Clock & {
  set(ms: number): void;
  advance(ms: number): void;
};

export function isManualClock(clock: Clock): clock is ManualClock {
  const manual = clock as Partial<ManualClock>;
  return typeof manual.set === "function" &&
    typeof manual.advance === "function";
}

// 기록 시각은 앞으로만 간다. 원본 clock이 뒤로 가도 앞서 본 시각을 유지한다.
export function monotonicClock(source: Clock): Clock {
  let max = -Infinity;
  return {
    nowMs() {
      const now = source.nowMs();
      if (now > max) max = now;
      return max;
    },
    now() {
      return formatAt(this.nowMs());
    },
  };
}

export function manualClock(startMs: number): ManualClock {
  let current = startMs;
  return {
    nowMs: () => current,
    now() {
      return formatAt(this.nowMs());
    },
    set(ms: number) {
      current = ms;
    },
    advance(ms: number) {
      current += ms;
    },
  };
}
