import type { ReactNode } from "react";
import { cx, type Timer } from "../shared.ts";
import { useDelayedLoading } from "./delayed-loading.ts";
import styles from "./skeleton.module.css";

export type SkeletonShape = "line" | "control" | "icon";

export interface SkeletonProps {
  // 실제 내용의 자리 모양: 본문 한 줄, md 컨트롤, 20px 아이콘.
  shape?: SkeletonShape;
  // line일 때 줄 수.
  lines?: number;
}

export function Skeleton({ shape = "line", lines = 1 }: SkeletonProps) {
  const count = shape === "line" ? Math.max(1, lines) : 1;
  return (
    <span className={styles.group} data-skeleton={shape}>
      {Array.from(
        { length: count },
        (_, index) => (
          <span key={index} className={cx(styles.bone, styles[shape])} />
        ),
      )}
    </span>
  );
}

export interface LoadingProps {
  loading: boolean;
  // 내용과 같은 자리를 지키는 skeleton.
  placeholder: ReactNode;
  children: ReactNode;
  timer?: Timer;
}

// 첫 조회 300ms 전에는 아무것도 그리지 않고, 그 뒤에는 placeholder를, 끝나면 내용을 그린다.
export function Loading(
  { loading, placeholder, children, timer }: LoadingProps,
) {
  const shown = useDelayedLoading(loading, timer);
  if (!loading) return children;
  return shown ? placeholder : null;
}
