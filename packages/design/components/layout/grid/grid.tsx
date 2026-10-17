import type { ReactNode } from "react";
import { componentMark } from "../../_shared/shared.ts";
import styles from "./grid.module.css";

export interface GridProps {
  children: ReactNode;
}

// 카드 폭 240px 이상의 칸을 container 폭에 맞게 채운다. 좁으면 한 줄 한 칸이다.
export function Grid({ children }: GridProps) {
  return (
    <div className={styles.grid} {...componentMark("Grid")}>{children}</div>
  );
}
