// turn 중간의 한 줄 알림(compaction, 재시도, rate limit). 회색 한 줄이고 경고는 StatusMark가 붙으며 3줄이 넘으면 접는다.
import type { ReactElement } from "react";
import { StatusMark } from "@lophn/ui/feedback";
import { t } from "@lophn/i18n";

import { useFold } from "./fold-toggle.tsx";
import styles from "./thread.module.css";

const FOLD_LINES = 3;

export function InfoRow({
  text,
  level,
}: {
  text: string;
  level: "info" | "warning";
}): ReactElement {
  const fold = useFold(text, FOLD_LINES);
  return (
    <div className={styles.info} data-info-row={level}>
      {level === "warning" ? (
        <StatusMark
          tone="warning"
          label={t("conversation.label.info-warning")}
        />
      ) : null}
      <p className={styles.infoText}>{fold.shown}</p>
      {fold.toggle}
    </div>
  );
}
