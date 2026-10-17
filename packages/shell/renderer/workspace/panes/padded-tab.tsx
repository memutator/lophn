import type { ReactNode } from "react";
import styles from "./panes.module.css";

// kind가 그리는 탭 본문은 칸 여백 없이 붙는다. 터미널처럼 칸을 스스로 채우지 않는 탭은 이것으로 감싸
// 칸 본문과 같은 여백을 두고 넘치면 그 안에서 scroll한다.
export function PaddedTab({ children }: { children: ReactNode }) {
  return <div className={styles.padded}>{children}</div>;
}
