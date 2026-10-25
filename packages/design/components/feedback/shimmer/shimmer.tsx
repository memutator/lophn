import type { ReactNode } from "react";
import { componentMark } from "../../_shared/shared.ts";
import styles from "./shimmer.module.css";

export interface ShimmerProps {
  // 지금 도는 일의 짧은 이름. 예: "Working".
  children: ReactNode;
}

// 글 위로 밝은 띠가 지나가 아직 도는 중임을 보인다. 끝나면 부르는 쪽이 지운다.
export function Shimmer({ children }: ShimmerProps) {
  return (
    <span
      className={styles.shimmer}
      role="status"
      {...componentMark("Shimmer")}
    >
      {children}
    </span>
  );
}
