import type { ReactNode } from "react";

import { currentPlatform, type WindowPlatform } from "./platform.ts";
import styles from "./top-bar.module.css";

export interface TopBarProps {
  /** 바 왼쪽 자리. 런처는 wordmark를 둔다. */
  leading?: ReactNode;
  /** 바 오른쪽 자리. 런처는 lophn 관리 진입점을 둔다. */
  trailing?: ReactNode;
  /** 비울 OS 창 조작 자리. 기본은 지금 renderer의 OS다. */
  platform?: WindowPlatform;
}

// 48px 끌기 바. macOS 신호등 80px·Windows·Linux 창 버튼 138px를 비우고
// 조작 요소만 끌기에서 뺀다(desktop#R23, R25).
export function TopBar(
  { leading, trailing, platform = currentPlatform() }: TopBarProps,
) {
  return (
    <header className={styles.bar} data-platform={platform}>
      <div className={styles.leading}>{leading}</div>
      <div className={styles.trailing}>{trailing}</div>
    </header>
  );
}

/** 바 왼쪽의 제품 이름. */
export function Wordmark({ children }: { children: ReactNode }) {
  return <span className={styles.wordmark}>{children}</span>;
}
