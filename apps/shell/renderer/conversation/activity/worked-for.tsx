import type { ReactElement } from "react";

import styles from "./activity.module.css";

export interface WorkedForProps {
  /** run이 일한 시간(ms). trace의 times.active_ms다. */
  durationMs: number;
}

function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) return `${seconds}s`;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

// 일이 끝난 뒤 남는 회색 "Worked for 18s" 줄. 1분 이상이면 "1m 15s"로 쓴다.
export function WorkedFor({ durationMs }: WorkedForProps): ReactElement {
  return (
    <p className={styles.worked} data-worked-for="">
      Worked for {duration(durationMs)}
    </p>
  );
}
