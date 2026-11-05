// 거절 이유 칸. 승인 카드의 [Deny]와 plan 카드의 [Keep planning]이 같이 쓴다. 비워도 된다.
import type { ReactElement, Ref } from "react";
import { t } from "@lophn/i18n";

import styles from "./approval-card.module.css";

export function ReasonRow({
  agent,
  value,
  onChange,
  inputRef,
}: {
  agent: string;
  value: string;
  onChange: (value: string) => void;
  inputRef: Ref<HTMLInputElement>;
}): ReactElement {
  return (
    <div className={styles.reasonRow}>
      <input
        ref={inputRef}
        className={styles.reasonInput}
        aria-label={t("conversation.label.approval-reason")}
        placeholder={t("conversation.label.approval-reason-placeholder", {
          agent,
        })}
        maxLength={500}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </div>
  );
}
