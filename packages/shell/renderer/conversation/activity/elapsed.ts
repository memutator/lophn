// 시간 글과 초 tick. DOM이 없어 폰도 import한다.
import { useEffect, useState } from "react";
import { t } from "@lophn/i18n";

/** 걸린 시간 글. 1분 미만은 "18s", 1시간 미만은 "1m 15s", 그 위는 "1h 5m"다. */
export function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) {
    return minutes === 0
      ? t("conversation.label.duration-hours", { hours })
      : t("conversation.label.duration-hours-minutes", { hours, minutes });
  }
  if (minutes === 0) {
    return t("conversation.label.duration-seconds", { seconds });
  }
  if (seconds === 0) {
    return t("conversation.label.duration-minutes", { minutes });
  }
  return t("conversation.label.duration-minutes-seconds", { minutes, seconds });
}

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
