// 처음에는 접혀 있는 세부 묶음. 머리 줄(이름과 지금 값 요약)을 누르면 편다.
import { type ReactNode, useState } from "react";
import { Icon } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";

import { commonIcons } from "../icons/mod.ts";
import styles from "./fold.module.css";

export function Fold({
  title,
  summary,
  defaultOpen = false,
  children,
  ...rest
}: {
  title: string;
  /** 접혀 있을 때도 보이는 한 줄(개수나 지금 값). */
  summary?: string;
  defaultOpen?: boolean;
  children: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section
      className={styles.fold}
      data-open={open ? "" : undefined}
      {...rest}
    >
      <button
        type="button"
        className={styles.head}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon
          icon={open ? commonIcons.collapse : commonIcons.expand}
          pixels={iconPixels("base")}
        />
        <span className={styles.title}>{title}</span>
        {summary === undefined || summary === "" ? null : (
          <span className={styles.summary}>{summary}</span>
        )}
      </button>
      {open ? <div className={styles.body}>{children}</div> : null}
    </section>
  );
}
