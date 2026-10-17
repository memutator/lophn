// 눌러서 탭을 여는 글 링크.
import type { ReactNode } from "react";

import styles from "./compose.module.css";

export function Link(
  { onClick, children }: { onClick: () => void; children: ReactNode },
) {
  return (
    <a
      className={styles.link}
      href="#"
      onClick={(event) => {
        event.preventDefault();
        onClick();
      }}
    >
      {children}
    </a>
  );
}
