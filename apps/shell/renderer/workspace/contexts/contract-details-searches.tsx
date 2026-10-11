// 선언된 검색 목록: 검색마다 제목·이름과 예시 검사 결과(통과·실패 개수).
import type { ReactNode } from "react";
import { t } from "@lophn/wording";

import type { SearchRow } from "./contract-details-model.ts";
import styles from "./contract-details.module.css";

export function DeclaredSearches(
  { rows }: { readonly rows: readonly SearchRow[] },
): ReactNode {
  return (
    <section className={styles.searches} data-declared-searches>
      <h2 className={styles.sectionTitle}>
        {t("contexts.heading.contract-searches")}
      </h2>
      {rows.map((row) => (
        <div key={row.name} className={styles.searchRow} data-declared-search>
          <span data-search-title>{row.title}</span>
          <span className={styles.mono} data-search-name>{row.name}</span>
          <span data-search-examples>
            {row.pass > 0
              ? (
                <span className={styles.good}>
                  {t("contexts.label.contract-examples-pass", {
                    count: row.pass,
                  })}
                </span>
              )
              : null}
            {row.pass > 0 && row.fail > 0 ? " · " : null}
            {row.fail > 0
              ? (
                <span className={styles.bad}>
                  {t("contexts.label.contract-examples-fail", {
                    count: row.fail,
                  })}
                </span>
              )
              : null}
          </span>
        </div>
      ))}
    </section>
  );
}
