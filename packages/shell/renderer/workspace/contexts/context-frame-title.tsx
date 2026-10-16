// Context 탭 머리의 앞부분: 이름·Context 표시·목적. 오른쪽 끝에 단추를 하나 둘 수 있다.
import type { ReactNode } from "react";
import { t } from "@lophn/wording";

import styles from "./context-frame.module.css";

export interface ContextTitleProps {
  readonly name: string;
  readonly purpose: string;
  /** 이름 줄 오른쪽 끝. */
  readonly children?: ReactNode;
}

export function ContextTitle(
  { name, purpose, children }: ContextTitleProps,
): ReactNode {
  return (
    <>
      <div className={styles.title}>
        <h1>{name}</h1>
        <span className={styles.chip} data-context-chip="">
          {t("contexts.label.frame-chip")}
        </span>
        <span className={styles.spacer} />
        {children}
      </div>
      <p className={styles.purpose} data-purpose="">{purpose}</p>
    </>
  );
}
