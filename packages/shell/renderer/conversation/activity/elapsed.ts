import { useEffect, useState } from "react";

import { duration } from "./worked-for.tsx";

/**
 * 다음 정각 초까지 기다린 뒤 1초마다 부른다. 줄마다 따로 시작해도 모든 시간 글이 같은 초에 바뀐다(Claude TUI처럼).
 * 돌려주는 함수가 멈춘다.
 */
export function startSecondTick(
  onTick: () => void,
  now: () => number = Date.now,
): () => void {
  let interval: ReturnType<typeof setInterval> | undefined;
  const timeout = setTimeout(
    () => {
      onTick();
      interval = setInterval(onTick, 1000);
    },
    1000 - (now() % 1000),
  );
  return () => {
    clearTimeout(timeout);
    clearInterval(interval);
  };
}

/** 도는 줄의 시간은 줄이 보이는 동안 매 정각 초마다 다시 센다. */
export function useSecondTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    return startSecondTick(() => setTick((tick) => tick + 1));
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
