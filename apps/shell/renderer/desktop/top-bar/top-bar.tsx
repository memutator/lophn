import type { ReactNode } from "react";
import { t } from "@lophn/wording";

import styles from "./top-bar.module.css";

export interface TopBarProps {
  /** 바 왼쪽 자리. 런처에서는 비운다. */
  leading?: ReactNode;
  /** lophn 관리 공간으로 가는 고정 진입점. */
  onLophn: () => void;
}

// 48px 끌기 바. 조작 요소만 끌기에서 뺀다(desktop#R23, R25).
export function TopBar({ leading, onLophn }: TopBarProps) {
  return (
    <header className={styles.bar}>
      <div className={styles.leading}>{leading}</div>
      <button
        type="button"
        className={styles.entry}
        data-entry="lophn"
        onClick={onLophn}
      >
        {t("launcher.button.lophn")}
      </button>
    </header>
  );
}
