import { t } from "@lophn/wording";
import type { Crumb } from "../../workspace/model.ts";
import styles from "./breadcrumbs.module.css";

export interface BreadcrumbsProps {
  crumbs: readonly Crumb[];
}

// 상단 경로. focus 칸의 활성 탭을 따른다. 글자만 보이고 링크는 없다.
export function Breadcrumbs({ crumbs }: BreadcrumbsProps) {
  return (
    <nav
      className={styles.crumbs}
      data-breadcrumbs=""
      aria-label={t("project-workspace.sidebar.label")}
    >
      {crumbs.map((crumb, index) => (
        <span key={index} className={styles.part}>
          {index > 0
            ? <span className={styles.sep} aria-hidden="true">/</span>
            : null}
          <span className={styles.crumb} data-crumb="">{crumb.label}</span>
        </span>
      ))}
    </nav>
  );
}
