// composer 위 dock의 card 하나. 접힌 요약 한 줄이 기본이고 머리를 누르면 펼친다. 펼친 본문은 최대 높이 안에서 scroll한다.
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import type { LucideIcon } from "lucide-react";
import type { ReactElement, ReactNode } from "react";

import { commonIcons } from "../../icons/mod.ts";
import styles from "./composer-dock.module.css";

interface DockCardProps {
  /** `data-dock-card`. 자동화와 gallery가 card를 찾는 이름이다. */
  id: string;
  icon: LucideIcon;
  summary: ReactNode;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function DockCard({
  id,
  icon,
  summary,
  open,
  onToggle,
  children,
}: DockCardProps): ReactElement {
  return (
    <section className={styles.card} data-dock-card={id} data-open={open}>
      <button
        type="button"
        className={styles.head}
        aria-expanded={open}
        onClick={onToggle}
      >
        <Icon
          icon={icon}
          pixels={iconPixels("small")}
          className={styles.icon}
        />
        <span className={styles.summary}>{summary}</span>
        <Icon
          icon={open ? commonIcons.collapse : commonIcons.expand}
          pixels={iconPixels("small")}
        />
      </button>
      {open ? <div className={styles.body}>{children}</div> : null}
    </section>
  );
}
