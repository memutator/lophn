import type { ReactElement } from "react";
import { t } from "@lophn/wording";

import styles from "./activity.module.css";

interface WorkedForProps {
  /** turn이 일한 시간(ms). trace의 times.active_ms다. */
  durationMs: number;
}

/** 걸린 시간 글. 1분 미만은 "18s", 그 위는 "1m 15s"다. */
export function duration(ms: number): string {
  const total = Math.round(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  if (minutes === 0) {
    return t("conversation.label.duration-seconds", { seconds });
  }
  if (seconds === 0) {
    return t("conversation.label.duration-minutes", { minutes });
  }
  return t("conversation.label.duration-minutes-seconds", { minutes, seconds });
}

// 일이 끝난 뒤 남는 회색 "Worked for 18s" 줄. 1분 이상이면 "1m 15s"로 쓴다. 사람이 멈춘 turn은 같은 모양의
// "Stopped after 3s"다.
export function WorkedFor(
  { durationMs, stopped = false }: WorkedForProps & { stopped?: boolean },
): ReactElement {
  const text = { duration: duration(durationMs) };
  return stopped
    ? (
      <p className={styles.worked} data-turn-stopped="">
        {t("conversation.label.stopped-after", text)}
      </p>
    )
    : (
      <p className={styles.worked} data-worked-for="">
        {t("conversation.label.worked-for", text)}
      </p>
    );
}
