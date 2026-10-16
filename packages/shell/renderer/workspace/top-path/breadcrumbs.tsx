import { t } from "@lophn/wording";

import type { Crumb } from "../model.ts";
import styles from "./breadcrumbs.module.css";

interface BreadcrumbsProps {
  crumbs: readonly Crumb[];
}

// 상단 경로. focus 칸의 활성 탭을 따른다. 마지막 조각이 지금 보는 것이다.
export function Breadcrumbs({ crumbs }: BreadcrumbsProps) {
  return (
    <nav
      className={styles.crumbs}
      data-breadcrumbs=""
      aria-label={t("project-workspace.label.path")}
    >
      <ol className={styles.list}>
        {crumbs.map((crumb, index) => {
          const last = index === crumbs.length - 1;
          return (
            <li key={index} className={styles.item}>
              {index > 0
                ? <span className={styles.sep} aria-hidden="true">/</span>
                : null}
              <span
                className={`${styles.crumb} ${last ? styles.current : ""}`}
                data-crumb=""
                aria-current={last ? "page" : undefined}
              >
                {crumb.label}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
