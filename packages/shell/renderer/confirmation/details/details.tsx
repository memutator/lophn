import { t } from "@lophn/wording";

import type { DetailFact } from "../display.ts";
import styles from "./details.module.css";

export interface DetailsProps {
  facts: readonly DetailFact[];
}

// 주체·시각·이유·근거·상세 전후는 기본에서 접는다.
// 내부 식별자·hash도 여기로만 온다.
export function Details({ facts }: DetailsProps) {
  if (facts.length === 0) return null;
  return (
    <details className={styles.details} data-section="details">
      <summary className={styles.summary}>
        {t("confirmation-window.label.details")}
      </summary>
      <dl className={styles.list}>
        {facts.map((fact) => (
          <div key={fact.label} className={styles.fact}>
            <dt>{fact.label}</dt>
            <dd className={styles.value}>{fact.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}
