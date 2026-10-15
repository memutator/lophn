// `/recap`의 결과. session을 짧게 요약한 줄들을 대화 끝에 보이고 닫을 수 있다. 요약은 이력에 들어가지 않는다.
import type { ReactElement } from "react";
import { Button } from "@lophn/design/components";
import { t } from "@lophn/wording";
import styles from "./recap-card.module.css";

export function RecapCard(
  { lines, onDismiss }: {
    lines: readonly string[];
    onDismiss: () => void;
  },
): ReactElement {
  return (
    <section
      className={styles.recap}
      aria-label={t("conversation.title.recap")}
    >
      <p className={styles.head}>{t("conversation.title.recap")}</p>
      <ul className={styles.list}>
        {lines.map((line, index) => <li key={index}>{line}</li>)}
      </ul>
      <div className={styles.foot}>
        <p className={styles.note}>{t("conversation.notice.recap-local")}</p>
        <Button size="sm" variant="ghost" onClick={onDismiss}>
          {t("conversation.button.recap-dismiss")}
        </Button>
      </div>
    </section>
  );
}
