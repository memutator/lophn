import { useEffect, useState } from "react";

import { duration } from "./worked-for.tsx";

/** 도는 줄의 시간은 줄이 보이는 동안 1초마다 다시 센다. */
export function useSecondTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setTick((tick) => tick + 1), 1000);
    return () => clearInterval(timer);
  }, [active]);
}

/** 도는 줄은 시작부터 지금까지, 끝난 줄은 걸린 시간이다. 모르면 빈 글이다. */
export function elapsedText(
  running: boolean,
  startedAt: string | null,
  durationMs: number | null,
  now: () => number,
): string {
  if (running) {
    if (startedAt === null) return "";
    return duration(Math.max(0, now() - Date.parse(startedAt)));
  }
  return durationMs === null ? "" : duration(durationMs);
}
