import type { ReactElement, ReactNode } from "react";

import styles from "./visually-hidden.module.css";

export interface VisuallyHiddenProps {
  /** 무엇을 알리는 영역인가. 바뀌는 상태를 한 번씩 읽는 status가 기본이다. */
  role?: "status" | "alert";
  children?: ReactNode;
}

/** 화면에는 보이지 않고 화면 낭독기에만 읽히는 한 줄. 바뀐 글만 읽으라고 role과 live를 함께 둔다. */
export function VisuallyHidden({
  role = "status",
  children,
}: VisuallyHiddenProps): ReactElement {
  return (
    <span
      className={styles.hidden}
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
    >
      {children}
    </span>
  );
}
