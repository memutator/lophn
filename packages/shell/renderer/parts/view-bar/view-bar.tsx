// card 밖(floated 패널, detached 창, phone)에서 탭 본문 맨 위에 그리는 얇은 view bar. card 안에서는 card 머리 줄(parts/card-head)이
// 대신한다. 파일 탭과 Agent 화면이 쓴다.
import type { ReactNode } from "react";

import styles from "./view-bar.module.css";

interface ViewBarProps {
  /** 왼쪽 한 줄. */
  lead: ReactNode;
  children?: ReactNode;
}

export function ViewBar({ lead, children }: ViewBarProps) {
  return (
    <div className={styles.bar} data-view-bar="">
      <div className={styles.lead}>{lead}</div>
      <div className={styles.actions}>{children}</div>
    </div>
  );
}
