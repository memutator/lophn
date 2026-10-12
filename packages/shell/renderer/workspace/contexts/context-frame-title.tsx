// Context 탭 머리의 앞부분: 이름·Context 표시·목적. 틀과 만드는 중 틀이 같이 쓴다.
import type { ReactNode } from "react";
import { t } from "@lophn/wording";

import styles from "./context-frame.module.css";

export interface ContextTitleProps {
  readonly name: string;
  readonly purpose: string;
}

export function ContextTitle({ name, purpose }: ContextTitleProps): ReactNode {
  return (
    <>
      <div className={styles.title}>
        <h1>{name}</h1>
        <span className={styles.chip} data-context-chip="">
          {t("contexts.label.frame-chip")}
        </span>
      </div>
      <p className={styles.purpose} data-purpose="">{purpose}</p>
    </>
  );
}
