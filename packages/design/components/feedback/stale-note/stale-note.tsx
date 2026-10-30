import { formatRelativeTime, t } from "@lophn/i18n";
import { componentMark } from "../../_shared/shared.ts";
import styles from "./stale-note.module.css";

export interface StaleNoteProps {
  updatedAt: Date;
  // 지금 시각은 호출자의 clock에서 받는다.
  now: Date;
}

// 오래된 값 옆에 마지막 갱신의 나이를 글로 보인다.
export function StaleNote({ updatedAt, now }: StaleNoteProps) {
  return (
    <span
      className={styles.note}
      data-state="stale"
      {...componentMark("StaleNote")}
    >
      {t("common.stale.label", { age: formatRelativeTime(updatedAt, now) })}
    </span>
  );
}
