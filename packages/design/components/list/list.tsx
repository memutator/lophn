import type { ReactNode } from "react";
import styles from "./list.module.css";

export function List({ children }: { children: ReactNode }) {
  return <ul className={styles.list}>{children}</ul>;
}

export interface ListItemProps {
  // 사람이 지은 이름. 메타는 그 아래 2px에 작은 글로 둔다.
  title: string;
  meta?: ReactNode;
  selected?: boolean;
  // 있으면 항목 전체가 버튼이다.
  onSelect?: () => void;
}

export function ListItem({ title, meta, selected, onSelect }: ListItemProps) {
  const body = (
    <>
      <span className={styles.title}>{title}</span>
      {meta !== undefined && <span className={styles.meta}>{meta}</span>}
    </>
  );
  return (
    <li className={styles.item} data-selected={selected || undefined}>
      {onSelect
        ? (
          <button
            type="button"
            className={styles.body}
            aria-current={selected ? "true" : undefined}
            onClick={onSelect}
          >
            {body}
          </button>
        )
        : <div className={styles.body}>{body}</div>}
    </li>
  );
}
