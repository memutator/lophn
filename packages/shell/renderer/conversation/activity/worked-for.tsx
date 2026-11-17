import type { ReactElement } from "react";
import { t } from "@lophn/i18n";
import { Tooltip } from "@lophn/ui/overlay";

import { duration } from "./elapsed.ts";
import styles from "./activity.module.css";

interface WorkedForProps {
  /** agent가 일한 시간(사람 기다림 제외). core가 turn 끝에 마감한 값이다. */
  activeMs: number;
  /** 사람을 기다린 시간(wall − active). */
  waitedMs: number;
  stopped?: boolean;
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
