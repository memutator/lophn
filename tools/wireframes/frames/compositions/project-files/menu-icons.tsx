// menu와 목록 항목 앞에 붙는 아이콘. 항목마다 종류에 맞는 아이콘을 단다.
import type { ReactNode } from "react";
import { Icon, iconPixels, type IconProps } from "@lophn/design/components";

import styles from "./files.module.css";

/** design 아이콘을 menu 항목 크기로 그린다. */
export function menuIcon(icon: IconProps["icon"]): ReactNode {
  return (
    <span className={styles.menuIcon}>
      <Icon icon={icon} pixels={iconPixels("base")} />
    </span>
  );
}

/** FileIcon 같은 요소를 menu 항목 칸에 맞춰 감싼다. */
export function menuLead(node: ReactNode): ReactNode {
  return <span className={styles.menuIcon}>{node}</span>;
}
