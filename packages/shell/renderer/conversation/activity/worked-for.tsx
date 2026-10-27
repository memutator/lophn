import type { ReactElement } from "react";
import { t } from "@lophn/wording";
import { Tooltip } from "@lophn/ui/overlay";

import styles from "./activity.module.css";

interface WorkedForProps {
  /** agent가 일한 시간(사람 기다림 제외). core가 turn 끝에 마감한 값이다. */
  activeMs: number;
  /** 사람을 기다린 시간(wall − active). */
  waitedMs: number;
  stopped?: boolean;
}

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

// 일이 끝난 뒤 남는 회색 "Worked for 1m 15s" 줄. 1시간 이상은 "1h 5m"로 쓴다. 사람이 멈춘 turn은 같은 모양의
// "Stopped after 1m 15s"다. 사람을 1초 넘게 기다린 turn은 줄에 마우스를 올리면 기다린 시간이 보인다.
export function WorkedFor({
  activeMs,
  waitedMs,
  stopped = false,
}: WorkedForProps): ReactElement {
  const text = { duration: duration(activeMs) };
  const line = stopped ? (
    <p className={styles.worked} data-turn-stopped="">
      {t("conversation.label.stopped-after", text)}
    </p>
  ) : (
    <p className={styles.worked} data-worked-for="">
      {t("conversation.label.worked-for", text)}
    </p>
  );
  if (waitedMs < 1000) return line;
  return (
    <Tooltip
      content={t("conversation.label.waited-for", {
        duration: duration(waitedMs),
      })}
    >
      {line}
    </Tooltip>
  );
}
